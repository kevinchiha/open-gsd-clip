/**
 * PipelineRunner -- the orchestration core.
 *
 * Drives execution by reacting to agent completion events. Supports both
 * sequential and parallel execution: when the execution plan contains
 * groups with multiple phases, all phases in a group start simultaneously,
 * each in its own git worktree. Completed results merge in roadmap order
 * via MergeQueue. Sequential plans (groups of size 1) behave identically
 * to pre-parallel behavior.
 *
 * The full per-phase loop:
 *   discussing -> reviewing -> planning -> executing -> verifying -> done
 *
 * CEO quality gates sit between discussing and planning. Failed
 * verification can trigger re-execution. Phase-level retry resets
 * to pending. Re-planning is capped at maxReplans=2.
 */

import { randomUUID } from 'node:crypto';

import { ensureAgentsExist } from '../agents/factory.js';
import { mapSignalToPhaseEvent, spawnAgent } from '../agents/invoker.js';
import type {
  AgentDefinition,
  AgentRole,
  HostServices,
} from '../agents/types.js';
import type { NotificationService } from '../notifications/notification-service.js';
import {
  cascadeFailure,
  createInitialPipelineState,
  pipelineTransition,
} from '../pipeline/fsm.js';
import {
  createInitialPhaseState,
  phaseTransition,
} from '../pipeline/phase-machine.js';
import { buildExecutionPlan } from '../pipeline/resolver.js';
import { serialize } from '../pipeline/serialization.js';
import type {
  PhaseEvent,
  PhaseInput,
  PhaseState,
  PipelineState,
} from '../pipeline/types.js';
import { createChildLogger } from '../shared/logger.js';
import { parseSignal } from '../signals/parser.js';
import type { DecisionNeededSignal, GsdSignal } from '../signals/types.js';

import { AuditLog } from './audit-log.js';
import { classifyError, retryWithBackoff } from './error-handler.js';
import { SerialEventQueue } from './event-queue.js';
import { HealthMonitor } from './health-monitor.js';
import { MergeQueue } from './merge-queue.js';
import {
  buildRevisionIssueDescription,
} from './quality-gate.js';
import { TokenTracker } from './token-tracker.js';
import type { EscalationRecord, OrchestratorConfig } from './types.js';
import { WorktreeManager } from './worktree-manager.js';

const log = createChildLogger('pipeline-runner');

export class PipelineRunner {
  private state: PipelineState | null = null;
  private readonly services: HostServices;
  private readonly config: OrchestratorConfig;
  private companyId: string;
  private auditLog: AuditLog;
  private readonly healthMonitor: HealthMonitor;
  private readonly eventQueue: SerialEventQueue;
  private agents: Record<AgentRole, AgentDefinition> | null = null;

  /** Track revision count per phase number. */
  private readonly revisionCounts = new Map<number, number>();

  /** Optional notification service for posting pipeline activity. */
  private notificationService: NotificationService | null = null;
  /** Token usage tracker for observability. */
  private readonly tokenTracker = new TokenTracker();
  /** Pending escalations awaiting user resolution. */
  private readonly pendingEscalations = new Map<string, EscalationRecord>();

  /** Worktree manager for parallel phase isolation. */
  private worktreeManager: WorktreeManager | null = null;
  /** Merge queue for ordered merging of completed phases. */
  private mergeQueue: MergeQueue | null = null;
  /** Phase dependency inputs for findReadyPhases. */
  private phaseInputs: PhaseInput[] = [];

  constructor(services: HostServices, config: OrchestratorConfig) {
    this.services = services;
    this.config = config;
    this.companyId = config.companyId;

    // AuditLog needs a project path -- set lazily when start() is called
    this.auditLog = new AuditLog('.');
    this.eventQueue = new SerialEventQueue();

    // HealthMonitor: stale agents get classified and handled as STEP_FAILED
    this.healthMonitor = new HealthMonitor(config.health, (issueId, reason) => {
      log.warn({ issueId, reason }, 'Stale agent detected');
      void this.handleAgentCompletion({
        status: 'failed',
        agentId: 'unknown',
        runId: 'unknown',
        issueId,
      });
    });
  }

  // ── Public API ──────────────────────────────────────────────────

  /**
   * Start the pipeline: create initial state, ensure agents, spawn CEO.
   */
  async start(projectPath: string, brief: string): Promise<void> {
    // Guard: reject if pipeline is already running
    if (this.state && this.state.status !== 'idle' && this.state.status !== 'completed' && this.state.status !== 'failed') {
      throw new Error(`Pipeline already running (status: ${this.state.status})`);
    }

    // Auto-detect companyId if still empty
    if (!this.companyId) {
      const port = process.env.PAPERCLIP_PORT || '3100';
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/companies`);
        if (res.ok) {
          const companies = (await res.json()) as Array<{ id: string }>;
          if (companies.length > 0) {
            this.companyId = companies[0].id;
          }
        }
      } catch { /* will fail later with better error */ }
      if (!this.companyId) {
        throw new Error('No companyId configured and auto-detection failed');
      }
    }

    // Create initial state
    const initial = createInitialPipelineState(projectPath, brief);

    // Transition idle -> initializing
    const result = pipelineTransition(initial, { type: 'START_PIPELINE' });
    if (!result.valid) {
      throw new Error(`Failed to start pipeline: ${result.description}`);
    }
    this.state = result.state;

    // Re-initialize audit log with actual project path
    this.auditLog = new AuditLog(projectPath);

    // Ensure all GSD agents exist
    this.agents = await ensureAgentsExist(
      this.services,
      projectPath,
      this.companyId,
      this.config.model,
    );

    // Spawn CEO with /gsd:new-project --auto
    const ceoAgentId = this.agents.ceo.agentId;
    const spawn = await retryWithBackoff(
      () =>
        spawnAgent(this.services, this.companyId, ceoAgentId, {
          role: 'ceo',
          projectPath,
          gsdCommand: '/gsd:new-project --auto',
          brief,
        }),
      this.config.retry,
    );

    // Track CEO agent health and poll for completion
    this.healthMonitor.trackAgent(spawn.issueId, spawn.runId);
    this.trackRunForPolling(ceoAgentId, spawn.issueId, spawn.runId);

    // Store issue on pipeline state (no phase yet -- CEO is pipeline-level)
    await this.persistState();

    await this.notificationService?.notify({
      type: 'pipeline_started',
      projectPath,
      brief,
    });

    log.info(
      { projectPath, issueId: spawn.issueId, runId: spawn.runId },
      'Pipeline started, CEO spawned',
    );
  }

  /**
   * Handle an agent completion event (from heartbeat.run.status).
   *
   * Enqueued in the SerialEventQueue to prevent race conditions.
   */
  async handleAgentCompletion(run: {
    status: string;
    agentId: string;
    runId: string;
    issueId?: string;
  }): Promise<void> {
    await this.eventQueue.enqueue(async () => {
      await this.processAgentCompletion(run);
    });
  }

  /**
   * Record activity for a tracked agent (delegate to health monitor).
   */
  recordActivity(issueId: string): void {
    this.healthMonitor.recordActivity(issueId);
  }

  /**
   * Returns current pipeline state (or null if not started).
   */
  getState(): PipelineState | null {
    return this.state;
  }

  /**
   * Clean up resources (health monitor timers, worktrees).
   */
  private completionPoller: ReturnType<typeof setInterval> | null = null;
  /** Map of issueId → { agentId, runId } for active agent runs being polled. */
  private trackedRuns = new Map<string, { agentId: string; runId: string }>();

  destroy(): void {
    this.healthMonitor.destroy();
    if (this.completionPoller) clearInterval(this.completionPoller);
    void this.worktreeManager?.cleanupAll().catch(() => {});
  }

  /**
   * Track an agent run for completion polling.
   * The background poller checks all tracked issues every 10s.
   */
  private trackRunForPolling(agentId: string, issueId: string, runId: string): void {
    log.info({ agentId, issueId, runId }, 'Tracking run for completion polling');
    this.trackedRuns.set(issueId, { agentId, runId });

    // Start the background poller if not already running
    if (!this.completionPoller) {
      const pollFn = () => void this.checkTrackedRuns();
      // Immediate first check after 5s (agent may already be done)
      setTimeout(pollFn, 5_000);
      // Then every 10s
      this.completionPoller = setInterval(pollFn, 10_000);
    }
  }

  /**
   * Check all tracked runs for completion by querying agent status.
   */
  private async checkTrackedRuns(): Promise<void> {
    if (this.trackedRuns.size === 0) return;

    const port = process.env.PAPERCLIP_PORT || '3100';
    log.debug({ trackedCount: this.trackedRuns.size }, 'Polling tracked runs');

    for (const [issueId, { agentId, runId }] of this.trackedRuns) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/agents/${agentId}`);
        if (!res.ok) {
          log.warn({ agentId, status: res.status }, 'Agent status check failed');
          continue;
        }
        const agent = (await res.json()) as { status: string };
        log.debug({ agentId, agentStatus: agent.status, issueId }, 'Polled agent status');

        if (agent.status === 'idle') {
          log.info({ agentId, runId, issueId }, 'Agent completed (detected via polling)');
          this.trackedRuns.delete(issueId);
          void this.handleAgentCompletion({
            status: 'succeeded',
            agentId,
            runId,
            issueId,
          });
        }
      } catch (err) {
        log.warn({ agentId, error: (err as Error).message }, 'Poll fetch failed');
      }
    }
  }

  /**
   * Set the notification service for pipeline activity posting.
   * Called after construction, before start().
   */
  setNotificationService(service: NotificationService): void {
    this.notificationService = service;
  }

  setCompanyId(companyId: string): void {
    this.companyId = companyId;
  }

  /**
   * Pause the pipeline. Only valid when status is 'running'.
   * Prevents new agents from being spawned. In-flight agents continue.
   */
  async pause(): Promise<void> {
    if (!this.state) {
      throw new Error('Pipeline not started');
    }
    const result = pipelineTransition(this.state, {
      type: 'PAUSE_REQUESTED',
    });
    if (!result.valid) {
      throw new Error(
        `Cannot pause pipeline: ${result.description}`,
      );
    }
    this.state = result.state;
    await this.persistState();
    await this.notificationService?.notify({
      type: 'pipeline_paused',
      reason: 'User requested pause',
    });
    log.info('Pipeline paused');
  }

  /**
   * Resume the pipeline. Only valid when status is 'paused'.
   * Restarts pending phases whose dependencies are met.
   */
  async resume(): Promise<void> {
    if (!this.state) {
      throw new Error('Pipeline not started');
    }
    const result = pipelineTransition(this.state, {
      type: 'RESUME_REQUESTED',
    });
    if (!result.valid) {
      throw new Error(
        `Cannot resume pipeline: ${result.description}`,
      );
    }
    this.state = result.state;

    // Restart pending phases whose dependencies are met
    const readyPhases = this.findReadyPhases();
    for (const phaseNumber of readyPhases) {
      await this.startPhase(phaseNumber);
    }

    await this.persistState();
    await this.notificationService?.notify({ type: 'pipeline_resumed' });
    log.info('Pipeline resumed');
  }

  /**
   * Retry a failed phase. Resets the phase to pending and dispatches
   * DEPENDENCIES_MET to restart it.
   *
   * @param phaseNumber - The phase to retry
   * @param _fromStep - Optional step to retry from (reserved for future use)
   */
  async retryPhase(phaseNumber: number, _fromStep?: string): Promise<void> {
    if (!this.state) {
      throw new Error('Pipeline not started');
    }

    const phase = this.state.phases.find((p) => p.phaseNumber === phaseNumber);
    if (!phase) {
      throw new Error(`Phase ${phaseNumber} not found`);
    }
    if (phase.status !== 'failed') {
      throw new Error(
        `Phase ${phaseNumber} is not failed (current: ${phase.status})`,
      );
    }

    // Reset phase to pending via RETRY_PHASE
    await this.handlePhaseEvent(phaseNumber, { type: 'RETRY_PHASE' });
    // Start it again
    await this.handlePhaseEvent(phaseNumber, { type: 'DEPENDENCIES_MET' });
  }

  /**
   * Resolve a pending escalation. Records the decision in the audit log
   * and advances the phase.
   *
   * @param escalationId - The escalation record ID
   * @param decision - The user's decision string
   */
  async resolveEscalation(
    escalationId: string,
    decision: string,
  ): Promise<void> {
    const escalation = this.pendingEscalations.get(escalationId);
    if (!escalation) {
      throw new Error(`Escalation ${escalationId} not found`);
    }

    escalation.resolvedAt = new Date().toISOString();
    escalation.resolution = decision;
    this.pendingEscalations.delete(escalationId);

    await this.auditLog.record({
      phase: escalation.phaseNumber,
      decisionType: 'quality_gate',
      context: escalation.context,
      optionsConsidered: escalation.options,
      choice: decision,
      reasoning: `User resolved escalation ${escalationId}`,
    });

    await this.advancePhaseAfterDecision(escalation.phaseNumber, decision);
  }

  /**
   * Get per-phase token usage summary.
   */
  getTokenSummary() {
    return this.tokenTracker.getSummary();
  }

  /**
   * Get all pending escalations awaiting user resolution.
   */
  getPendingEscalations(): EscalationRecord[] {
    return Array.from(this.pendingEscalations.values());
  }

  // ── Private: Agent completion processing ────────────────────────

  private async processAgentCompletion(run: {
    status: string;
    agentId: string;
    runId: string;
    issueId?: string;
  }): Promise<void> {
    if (!this.state) {
      log.warn('Agent completion received but pipeline not started');
      return;
    }

    // Untrack from health monitor
    if (run.issueId) {
      this.healthMonitor.untrackAgent(run.issueId);
    }

    // Find which phase has this issueId as activeAgentIssueId
    const phase = run.issueId
      ? this.state.phases.find((p) => p.activeAgentIssueId === run.issueId)
      : null;

    // Clear agent on that phase
    if (phase) {
      const clearResult = phaseTransition(phase, { type: 'CLEAR_AGENT' });
      if (clearResult.valid) {
        this.updatePhase(phase.phaseNumber, clearResult.state);
      }
    }

    // Determine the signal/event
    if (run.status === 'succeeded' && run.issueId) {
      // Fetch comments and find signal
      const commentsResult = await this.services.issues.listComments({
        companyId: this.companyId,
        issueId: run.issueId,
      });

      if (!commentsResult.ok) {
        log.error({ issueId: run.issueId }, 'Failed to fetch issue comments');
        if (phase) {
          await this.handlePhaseEvent(phase.phaseNumber, {
            type: 'STEP_FAILED',
            errorType: 'fatal',
            message: 'Failed to fetch issue comments',
          });
        }
        return;
      }

      // Parse signal from last comment containing one
      let signal: GsdSignal | null = null;
      const comments = commentsResult.value;
      for (let i = comments.length - 1; i >= 0; i--) {
        const parsed = parseSignal(comments[i]?.body);
        if (parsed) {
          signal = parsed;
          break;
        }
      }

      if (!signal) {
        log.warn({ issueId: run.issueId }, 'No GSD signal found in comments');
        if (phase) {
          await this.handlePhaseEvent(phase.phaseNumber, {
            type: 'STEP_FAILED',
            errorType: 'fatal',
            message: 'Agent completed but no GSD signal found',
          });
        }
        return;
      }

      // Special case: PROJECT_READY -> pipeline-level handling
      if (signal.type === 'PROJECT_READY') {
        await this.handleProjectReady();
        return;
      }

      // Special case: DECISION_NEEDED -> create escalation, notify, do NOT advance
      if (signal.type === 'DECISION_NEEDED') {
        const phaseNumber = signal.phase || (phase?.phaseNumber ?? 0);
        if (phaseNumber > 0) {
          await this.handleDecisionNeeded(
            phaseNumber,
            signal as DecisionNeededSignal,
          );
        }
        return;
      }

      // Map signal to phase event
      const phaseEvent = mapSignalToPhaseEvent(signal);
      if (!phaseEvent) {
        log.debug(
          { signalType: signal.type },
          'Signal does not map to phase event',
        );
        return;
      }

      // Determine phase number from signal or active phase
      const phaseNumber = signal.phase || (phase?.phaseNumber ?? 0);
      if (phaseNumber === 0) {
        log.warn({ signal }, 'Cannot determine phase number for signal');
        return;
      }

      // Handle REVISION_NEEDED specially for revision counting
      if (signal.type === 'REVISION_NEEDED') {
        await this.handleRevisionNeeded(
          phaseNumber,
          (signal as { feedback?: string }).feedback ?? 'No feedback provided',
        );
        return;
      }

      await this.handlePhaseEvent(phaseNumber, phaseEvent);
    } else if (run.status === 'failed') {
      // Agent failed
      if (phase) {
        await this.handlePhaseEvent(phase.phaseNumber, {
          type: 'STEP_FAILED',
          errorType: 'fatal',
          message: `Agent run failed: ${run.runId}`,
        });
      }
    }
  }

  // ── Private: Pipeline lifecycle ─────────────────────────────────

  /**
   * Handle PROJECT_READY: transition to analyzing, build execution plan,
   * create phase states, transition to running, start first phase.
   */
  private async handleProjectReady(): Promise<void> {
    if (!this.state) return;

    // Transition: initializing -> analyzing
    const analyzeResult = pipelineTransition(this.state, {
      type: 'PROJECT_READY',
    });
    if (!analyzeResult.valid) {
      log.error(
        { description: analyzeResult.description },
        'PROJECT_READY transition failed',
      );
      return;
    }
    this.state = analyzeResult.state;

    // Build execution plan from roadmap phases
    // For now, use a simple sequential plan with 6 phases (from PROJECT.md)
    // In production, this would read the roadmap via gsd-tools bridge
    const phaseInputs: PhaseInput[] = Array.from({ length: 6 }, (_, i) => ({
      phaseNumber: i + 1,
      dependsOn: i === 0 ? [] : [i],
    }));

    const planResult = buildExecutionPlan(phaseInputs);
    if (!planResult.ok) {
      log.error({ error: planResult.error }, 'Failed to build execution plan');
      return;
    }

    const executionPlan = planResult.value;

    // Derive phaseInputs from execution plan groups for dependency tracking.
    // Each phase in group N depends on all phases in preceding groups.
    // This ensures findReadyPhases matches the actual execution plan.
    this.phaseInputs = this.derivePhaseInputs(executionPlan.groups);

    // Initialize WorktreeManager and prune stale worktrees
    this.worktreeManager = new WorktreeManager(this.state.projectPath);
    await this.worktreeManager.pruneStaleWorktrees();

    // Initialize MergeQueue with ordered merge and worktree cleanup callback
    this.mergeQueue = new MergeQueue(
      executionPlan.phaseOrder,
      async (phaseNumber: number) => {
        await this.worktreeManager?.mergePhase(phaseNumber);
        await this.worktreeManager?.removeWorktree(phaseNumber);
      },
    );

    // Create PhaseState for each phase
    const phases = executionPlan.phaseOrder.map((num) =>
      createInitialPhaseState(num),
    );
    this.state = { ...this.state, phases };

    // Transition: analyzing -> running
    const runResult = pipelineTransition(this.state, {
      type: 'ANALYSIS_COMPLETE',
      executionPlan,
    });
    if (!runResult.valid) {
      log.error(
        { description: runResult.description },
        'ANALYSIS_COMPLETE transition failed',
      );
      return;
    }
    this.state = runResult.state;

    // Start ALL phases in first execution group
    const firstGroup = executionPlan.groups[0] ?? [];
    for (const phaseNumber of firstGroup) {
      await this.startPhase(phaseNumber);
    }

    await this.persistState();

    log.info(
      { phaseCount: phases.length, executionOrder: executionPlan.phaseOrder },
      'Pipeline analyzing complete, running',
    );
  }

  /**
   * Handle a phase event: transition phase FSM and advance.
   */
  private async handlePhaseEvent(
    phaseNumber: number,
    event: PhaseEvent,
  ): Promise<void> {
    if (!this.state) return;

    const phase = this.state.phases.find((p) => p.phaseNumber === phaseNumber);
    if (!phase) {
      log.warn({ phaseNumber }, 'Phase not found');
      return;
    }

    const result = phaseTransition(phase, event);
    if (!result.valid) {
      log.warn(
        { phaseNumber, event: event.type, description: result.description },
        'Phase transition invalid',
      );
      return;
    }

    this.updatePhase(phaseNumber, result.state);
    await this.persistState();
    await this.advancePhase(phaseNumber, result.state);
  }

  /**
   * Advance a phase based on its new status: spawn the appropriate agent.
   */
  private async advancePhase(
    phaseNumber: number,
    phase: PhaseState,
  ): Promise<void> {
    // Do not spawn new agents while pipeline is paused (Pitfall 5)
    if (this.state?.status === 'paused') {
      log.info({ phaseNumber }, 'Pipeline paused, deferring agent spawn');
      return;
    }

    switch (phase.status) {
      case 'discussing':
        // Skip interactive discussion in autonomous mode — advance directly
        log.info({ phaseNumber }, 'Autonomous mode: skipping discuss, advancing to ui_designing');
        await this.handlePhaseEvent(phaseNumber, { type: 'STEP_COMPLETED' });
        break;
      case 'reviewing':
        // Skip CEO review in autonomous mode — advance to ui_designing
        log.info({ phaseNumber }, 'Autonomous mode: skipping review, advancing to ui_designing');
        await this.handlePhaseEvent(phaseNumber, { type: 'APPROVED' });
        break;
      case 'ui_designing':
        await this.spawnUiDesigner(phaseNumber);
        break;
      case 'planning':
        await this.spawnPlanner(phaseNumber);
        break;
      case 'executing':
        await this.spawnExecutor(phaseNumber);
        break;
      case 'ui_reviewing':
        await this.spawnUiReviewer(phaseNumber);
        break;
      case 'verifying':
        await this.spawnVerifier(phaseNumber);
        break;
      case 'done':
        await this.onPhaseComplete(phaseNumber);
        break;
      case 'failed':
        await this.onPhaseFailed(phaseNumber, phase);
        break;
      default:
        break;
    }
  }

  // ── Private: Phase start / dependency resolution ─────────────────

  /**
   * Start a phase: create worktree (for isolation) and send DEPENDENCIES_MET.
   */
  private async startPhase(phaseNumber: number): Promise<void> {
    if (this.worktreeManager) {
      await this.worktreeManager.createWorktree(phaseNumber);
    }
    await this.handlePhaseEvent(phaseNumber, { type: 'DEPENDENCIES_MET' });
  }

  /**
   * Find all pending phases whose dependencies are now fully met.
   * Returns sorted array of phase numbers ready to start.
   */
  private findReadyPhases(): number[] {
    if (!this.state) return [];

    const ready: number[] = [];
    const donePhases = new Set(
      this.state.phases
        .filter((p) => p.status === 'done')
        .map((p) => p.phaseNumber),
    );

    for (const phase of this.state.phases) {
      if (phase.status !== 'pending') continue;

      const input = this.phaseInputs.find(
        (p) => p.phaseNumber === phase.phaseNumber,
      );
      if (!input) continue;

      const allDepsMet = input.dependsOn.every((dep) => donePhases.has(dep));
      if (allDepsMet) {
        ready.push(phase.phaseNumber);
      }
    }

    return ready.sort((a, b) => a - b);
  }

  // ── Private: Phase completion / failure ─────────────────────────

  /**
   * Handle phase completion: enqueue in merge queue, check if all done,
   * find and start newly-unblocked phases.
   */
  private async onPhaseComplete(phaseNumber: number): Promise<void> {
    if (!this.state) return;

    log.info({ phaseNumber }, 'Phase completed');

    await this.notificationService?.notify({
      type: 'phase_completed',
      phaseNumber,
      phaseName: `Phase ${phaseNumber}`,
    });

    // Enqueue completed phase in merge queue for ordered merging
    await this.mergeQueue?.enqueue(phaseNumber);

    const allSucceeded = this.state.phases.every((p) => p.status === 'done');

    if (allSucceeded) {
      const doneResult = pipelineTransition(this.state, {
        type: 'ALL_PHASES_DONE',
      });
      if (doneResult.valid) {
        this.state = doneResult.state;
      }
      await this.notificationService?.notify({
        type: 'pipeline_completed',
        totalPhases: this.state.phases.length,
      });
      await this.persistState();
      log.info('All phases completed successfully');
      return;
    }

    // Find all pending phases whose dependencies are now met
    const readyPhases = this.findReadyPhases();
    for (const ready of readyPhases) {
      await this.startPhase(ready);
    }

    await this.persistState();
  }

  /**
   * Handle phase failure: classify error, retry if possible, cascade otherwise.
   */
  private async onPhaseFailed(
    phaseNumber: number,
    phase: PhaseState,
  ): Promise<void> {
    if (!this.state) return;

    const errorMessage = phase.error?.message ?? 'Unknown error';

    await this.notificationService?.notify({
      type: 'phase_failed',
      phaseNumber,
      phaseName: `Phase ${phaseNumber}`,
      error: errorMessage,
    });

    const classified = classifyError(errorMessage);

    log.info(
      {
        phaseNumber,
        errorType: classified.type,
        retryable: classified.retryable,
      },
      'Phase failed, evaluating recovery',
    );

    if (
      classified.retryable &&
      (phase.error?.retryCount ?? 0) < classified.maxRetries
    ) {
      // Record retry decision
      await this.auditLog.record({
        phase: phaseNumber,
        decisionType: 'error_recovery',
        context: `Phase ${phaseNumber} failed with ${classified.type}`,
        optionsConsidered: ['retry', 'fail'],
        choice: 'retry',
        reasoning: `Error is ${classified.type} (retryable), attempt ${(phase.error?.retryCount ?? 0) + 1}/${classified.maxRetries}`,
      });

      // Send RETRY_PHASE to reset
      await this.handlePhaseEvent(phaseNumber, { type: 'RETRY_PHASE' });

      // After retry, phase goes to pending. Start it again.
      await this.handlePhaseEvent(phaseNumber, { type: 'DEPENDENCIES_MET' });
      return;
    }

    // Not retryable or exhausted retries
    await this.auditLog.record({
      phase: phaseNumber,
      decisionType: 'error_recovery',
      context: `Phase ${phaseNumber} failed with ${classified.type}`,
      optionsConsidered: ['retry', 'cascade_failure'],
      choice: 'cascade_failure',
      reasoning: classified.retryable
        ? `Retries exhausted (${phase.error?.retryCount ?? 0}/${classified.maxRetries})`
        : `Error type ${classified.type} is not retryable`,
    });

    // Mark failed phase in merge queue so it doesn't block later merges
    await this.mergeQueue?.markFailed(phaseNumber);

    // Cascade failure to dependent phases
    if (this.state.executionPlan && phase.error) {
      const dependents = this.buildDependentsMap();
      this.state = cascadeFailure(
        this.state,
        phaseNumber,
        phase.error,
        dependents,
      );

      // Mark cascade-failed dependent phases in merge queue too
      const cascadedPhases = dependents.get(phaseNumber) ?? [];
      for (const depPhase of cascadedPhases) {
        const p = this.state.phases.find((ph) => ph.phaseNumber === depPhase);
        if (p?.status === 'failed') {
          await this.mergeQueue?.markFailed(depPhase);
        }
      }
    }

    // Check if any phases can still proceed
    const hasRemainingActive = this.state.phases.some(
      (p) => p.status !== 'done' && p.status !== 'failed',
    );

    if (!hasRemainingActive) {
      const failResult = pipelineTransition(this.state, {
        type: 'UNRECOVERABLE_ERROR',
        error: `Phase ${phaseNumber} failed: ${errorMessage}`,
      });
      if (failResult.valid) {
        this.state = failResult.state;
        await this.notificationService?.notify({
          type: 'pipeline_failed',
          error: `Phase ${phaseNumber} failed: ${errorMessage}`,
        });
      }
    }

    await this.persistState();
  }

  // ── Private: Revision handling ──────────────────────────────────

  /**
   * Handle REVISION_NEEDED: check revision count, re-discuss or fail.
   */
  private async handleRevisionNeeded(
    phaseNumber: number,
    feedback: string,
  ): Promise<void> {
    const count = (this.revisionCounts.get(phaseNumber) ?? 0) + 1;
    this.revisionCounts.set(phaseNumber, count);

    log.info(
      {
        phaseNumber,
        revisionCount: count,
        maxRevisions: this.config.maxRevisions,
      },
      'Revision requested',
    );

    if (count > this.config.maxRevisions) {
      // Exceeded revision limit -- transition to discussing first, then fail
      await this.auditLog.record({
        phase: phaseNumber,
        decisionType: 'revision_request',
        context: `Phase ${phaseNumber} revision ${count} exceeds max ${this.config.maxRevisions}`,
        optionsConsidered: ['revise', 'fail'],
        choice: 'fail',
        reasoning: `Revision count ${count} exceeds limit of ${this.config.maxRevisions}`,
      });

      // Transition reviewing -> discussing (via REVISION_NEEDED) then fail from discussing
      await this.handlePhaseEvent(phaseNumber, { type: 'REVISION_NEEDED' });
      await this.handlePhaseEvent(phaseNumber, {
        type: 'STEP_FAILED',
        errorType: 'fatal',
        message: `Revision limit exceeded (${count}/${this.config.maxRevisions})`,
      });
      return;
    }

    // Record revision decision
    await this.auditLog.record({
      phase: phaseNumber,
      decisionType: 'revision_request',
      context: `CEO requested revision for phase ${phaseNumber}`,
      optionsConsidered: ['revise', 'override'],
      choice: 'revise',
      reasoning: `Revision ${count}/${this.config.maxRevisions}: ${feedback}`,
    });

    // Transition phase back to discussing (REVISION_NEEDED event)
    await this.handlePhaseEvent(phaseNumber, { type: 'REVISION_NEEDED' });

    // Spawn revision discusser with CEO feedback
    await this.spawnRevisionDiscusser(phaseNumber, feedback);
  }

  // ── Private: Agent spawning ─────────────────────────────────────

  // spawnDiscusser and spawnCeoReview removed — autonomous mode skips
  // interactive discussion and CEO review steps.

  private async spawnUiDesigner(phaseNumber: number): Promise<void> {
    if (!this.state || !this.agents) return;

    const agentId = this.agents.designer.agentId;
    const projectPath =
      this.worktreeManager?.getWorkingDirectory(phaseNumber) ??
      this.state.projectPath;
    const spawn = await retryWithBackoff(
      () =>
        spawnAgent(this.services, this.companyId, agentId, {
          role: 'designer',
          projectPath,
          phaseNumber,
          gsdCommand: `/gsd:ui-phase ${phaseNumber}`,
        }),
      this.config.retry,
    );

    await this.setAgentOnPhase(phaseNumber, spawn.issueId, spawn.runId, agentId);
  }

  private async spawnUiReviewer(phaseNumber: number): Promise<void> {
    if (!this.state || !this.agents) return;

    const agentId = this.agents.designer.agentId;
    const projectPath =
      this.worktreeManager?.getWorkingDirectory(phaseNumber) ??
      this.state.projectPath;
    const spawn = await retryWithBackoff(
      () =>
        spawnAgent(this.services, this.companyId, agentId, {
          role: 'designer',
          projectPath,
          phaseNumber,
          gsdCommand: `/gsd:ui-review ${phaseNumber}`,
        }),
      this.config.retry,
    );

    await this.setAgentOnPhase(phaseNumber, spawn.issueId, spawn.runId, agentId);
  }

  private async spawnPlanner(phaseNumber: number): Promise<void> {
    if (!this.state || !this.agents) return;

    const agentId = this.agents.planner.agentId;
    const projectPath =
      this.worktreeManager?.getWorkingDirectory(phaseNumber) ??
      this.state.projectPath;
    const spawn = await retryWithBackoff(
      () =>
        spawnAgent(this.services, this.companyId, agentId, {
          role: 'planner',
          projectPath,
          phaseNumber,
          gsdCommand: `/gsd:plan-phase ${phaseNumber}`,
        }),
      this.config.retry,
    );

    await this.setAgentOnPhase(phaseNumber, spawn.issueId, spawn.runId, agentId);
  }

  private async spawnExecutor(phaseNumber: number): Promise<void> {
    if (!this.state || !this.agents) return;

    const agentId = this.agents.executor.agentId;
    const projectPath =
      this.worktreeManager?.getWorkingDirectory(phaseNumber) ??
      this.state.projectPath;
    const spawn = await retryWithBackoff(
      () =>
        spawnAgent(this.services, this.companyId, agentId, {
          role: 'executor',
          projectPath,
          phaseNumber,
          gsdCommand: `/gsd:execute-phase ${phaseNumber}`,
        }),
      this.config.retry,
    );

    await this.setAgentOnPhase(phaseNumber, spawn.issueId, spawn.runId, agentId);
  }

  private async spawnVerifier(phaseNumber: number): Promise<void> {
    if (!this.state || !this.agents) return;

    const agentId = this.agents.verifier.agentId;
    const projectPath =
      this.worktreeManager?.getWorkingDirectory(phaseNumber) ??
      this.state.projectPath;
    const spawn = await retryWithBackoff(
      () =>
        spawnAgent(this.services, this.companyId, agentId, {
          role: 'verifier',
          projectPath,
          phaseNumber,
          gsdCommand: `/gsd:verify-work ${phaseNumber}`,
        }),
      this.config.retry,
    );

    await this.setAgentOnPhase(phaseNumber, spawn.issueId, spawn.runId, agentId);
  }

  private async spawnRevisionDiscusser(
    phaseNumber: number,
    feedback: string,
  ): Promise<void> {
    if (!this.state || !this.agents) return;

    const projectPath =
      this.worktreeManager?.getWorkingDirectory(phaseNumber) ??
      this.state.projectPath;
    const gsdCommand = `/gsd:discuss-phase ${phaseNumber} --auto`;
    const description = buildRevisionIssueDescription(
      projectPath,
      phaseNumber,
      feedback,
      gsdCommand,
    );

    // Create issue with revision-specific description
    const issueResult = await this.services.issues.create({
      companyId: this.companyId,
      title: `Discusser: Revise phase ${phaseNumber} context`,
      description,
      status: 'todo',
      priority: 'high',
      assigneeAgentId: this.agents.discusser.agentId,
      executionWorkspaceSettings: { mode: 'isolated_workspace' },
    });

    if (!issueResult.ok) {
      log.error({ phaseNumber }, 'Failed to create revision issue');
      return;
    }

    const issueId = issueResult.value.id;

    const invokeResult = await this.services.agents.invoke({
      companyId: this.companyId,
      agentId: this.agents.discusser.agentId,
      reason: `GSD revision discussion for phase ${phaseNumber}`,
      prompt: `You have a new task assigned. Issue ID: ${issueId}. Check your assigned issues and complete the task.`,
    });

    if (!invokeResult.ok) {
      log.error({ phaseNumber }, 'Failed to invoke discusser for revision');
      return;
    }

    await this.setAgentOnPhase(phaseNumber, issueId, invokeResult.value.runId, this.agents.discusser.agentId);
  }

  // ── Private: Escalation / decision handling ─────────────────────

  /**
   * Handle a DECISION_NEEDED signal: create an escalation record,
   * notify the user, and do NOT advance the phase (waits for resolution).
   */
  private async handleDecisionNeeded(
    phaseNumber: number,
    signal: DecisionNeededSignal,
  ): Promise<void> {
    const id = `ESC-${randomUUID()}`;
    const escalation: EscalationRecord = {
      id,
      phaseNumber,
      context: signal.context,
      options: signal.options,
      createdAt: new Date().toISOString(),
      resolvedAt: null,
      resolution: null,
    };

    this.pendingEscalations.set(id, escalation);

    await this.notificationService?.notify({
      type: 'escalation',
      phaseNumber,
      context: signal.context,
      options: signal.options,
    });

    await this.auditLog.record({
      phase: phaseNumber,
      decisionType: 'quality_gate',
      context: `DECISION_NEEDED: ${signal.context}`,
      optionsConsidered: signal.options,
      choice: 'awaiting_user',
      reasoning: 'Escalated to user for decision',
    });

    log.info(
      { phaseNumber, escalationId: id },
      'Escalation created, awaiting user resolution',
    );
  }

  /**
   * Advance a phase after a user decision resolves an escalation.
   * Dispatches STEP_COMPLETED to move the phase forward.
   */
  private async advancePhaseAfterDecision(
    phaseNumber: number,
    _decision: string,
  ): Promise<void> {
    await this.handlePhaseEvent(phaseNumber, { type: 'STEP_COMPLETED' });
  }

  // ── Private: Helpers ────────────────────────────────────────────

  /**
   * Set the active agent on a phase and track in health monitor.
   */
  private async setAgentOnPhase(
    phaseNumber: number,
    issueId: string,
    runId: string,
    agentId?: string,
  ): Promise<void> {
    if (!this.state) return;

    const phase = this.state.phases.find((p) => p.phaseNumber === phaseNumber);
    if (!phase) return;

    const result = phaseTransition(phase, {
      type: 'SET_AGENT',
      agentIssueId: issueId,
    });
    if (result.valid) {
      this.updatePhase(phaseNumber, result.state);
    }

    this.healthMonitor.trackAgent(issueId, runId);
    if (agentId) {
      this.trackRunForPolling(agentId, issueId, runId);
    }
    await this.persistState();
  }

  /**
   * Update a phase in the pipeline state array.
   */
  private updatePhase(phaseNumber: number, newPhase: PhaseState): void {
    if (!this.state) return;

    this.state = {
      ...this.state,
      phases: this.state.phases.map((p) =>
        p.phaseNumber === phaseNumber ? newPhase : p,
      ),
    };
  }

  /**
   * Derive PhaseInput dependency declarations from execution plan groups.
   * Phases in group 0 have no dependencies. Phases in group N depend on
   * all phases in the immediately preceding group (group N-1).
   */
  private derivePhaseInputs(groups: number[][]): PhaseInput[] {
    const inputs: PhaseInput[] = [];
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      if (!group) continue;
      const dependsOn = i > 0 ? (groups[i - 1] ?? []) : [];
      for (const phaseNumber of group) {
        inputs.push({ phaseNumber, dependsOn: [...dependsOn] });
      }
    }
    return inputs;
  }

  /**
   * Build a map of phase -> phases that depend on it (forward adjacency).
   * Uses phaseInputs for accurate dependency data (supports parallel plans).
   */
  private buildDependentsMap(): Map<number, number[]> {
    const dependents = new Map<number, number[]>();

    for (const input of this.phaseInputs) {
      for (const dep of input.dependsOn) {
        const list = dependents.get(dep) ?? [];
        list.push(input.phaseNumber);
        dependents.set(dep, list);
      }
    }

    return dependents;
  }

  /**
   * Persist pipeline state. Currently logs serialized state.
   * Phase 6 will add HostServices.state for durable storage.
   */
  private async persistState(): Promise<void> {
    if (!this.state) return;

    const serialized = serialize(this.state);

    // Write to file for crash recovery
    try {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const os = await import('node:os');
      const dir = path.join(os.homedir(), '.open-gsd-clip');
      fs.mkdirSync(dir, { recursive: true });
      const stateFile = path.join(dir, 'pipeline-state.json');
      const data = {
        state: this.state,
        agents: this.agents ? Object.fromEntries(
          Object.entries(this.agents).map(([k, v]) => [k, { agentId: v.agentId, name: v.name }])
        ) : null,
        trackedRuns: Array.from(this.trackedRuns.entries()),
        companyId: this.companyId,
        savedAt: new Date().toISOString(),
      };
      fs.writeFileSync(stateFile, JSON.stringify(data, null, 2));
      log.debug({ stateFile, stateSize: serialized.length }, 'State persisted to file');
    } catch (err) {
      log.warn({ error: (err as Error).message }, 'Failed to persist state to file');
    }
  }

  /**
   * Restore pipeline state from file after worker restart.
   * Called on startup to resume a previously running pipeline.
   */
  async restoreState(): Promise<boolean> {
    try {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const os = await import('node:os');
      const stateFile = path.join(os.homedir(), '.open-gsd-clip', 'pipeline-state.json');

      if (!fs.existsSync(stateFile)) return false;

      const raw = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
      if (!raw.state || !raw.agents) return false;

      // Restore state
      this.state = raw.state;
      this.companyId = raw.companyId || this.companyId;

      // Restore agent definitions
      this.agents = raw.agents as Record<AgentRole, AgentDefinition>;

      // Restore tracked runs and restart poller
      if (raw.trackedRuns?.length > 0) {
        for (const [issueId, info] of raw.trackedRuns) {
          this.trackRunForPolling(info.agentId, issueId, info.runId);
        }
      }

      // Re-poll any phases that have active agents
      if (this.state?.phases) {
        for (const phase of this.state.phases) {
          if (phase.activeAgentIssueId && phase.status !== 'done' && phase.status !== 'failed' && phase.status !== 'pending') {
            // Find the agent for this phase's current step
            const agentRole = this.getAgentRoleForStatus(phase.status);
            if (agentRole && this.agents[agentRole]) {
              this.trackRunForPolling(
                this.agents[agentRole].agentId,
                phase.activeAgentIssueId,
                'restored',
              );
            }
          }
        }
      }

      log.info({ status: this.state?.status, phases: this.state?.phases?.length }, 'Pipeline state restored from file');
      return true;
    } catch (err) {
      log.warn({ error: (err as Error).message }, 'Failed to restore state');
      return false;
    }
  }

  private getAgentRoleForStatus(status: string): AgentRole | null {
    const map: Record<string, AgentRole> = {
      ui_designing: 'designer',
      planning: 'planner',
      executing: 'executor',
      ui_reviewing: 'designer',
      verifying: 'verifier',
    };
    return (map[status] as AgentRole) ?? null;
  }
}
