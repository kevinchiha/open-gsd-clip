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

import { ensureAgentsExist } from '../agents/factory.js';
import { mapSignalToPhaseEvent, spawnAgent } from '../agents/invoker.js';
import type {
  AgentDefinition,
  AgentRole,
  HostServices,
} from '../agents/types.js';
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
import type { GsdSignal } from '../signals/types.js';

import { AuditLog } from './audit-log.js';
import { classifyError, retryWithBackoff } from './error-handler.js';
import { SerialEventQueue } from './event-queue.js';
import { HealthMonitor } from './health-monitor.js';
import { MergeQueue } from './merge-queue.js';
import {
  buildReviewIssueDescription,
  buildRevisionIssueDescription,
} from './quality-gate.js';
import type { OrchestratorConfig } from './types.js';
import { WorktreeManager } from './worktree-manager.js';

const log = createChildLogger('pipeline-runner');

export class PipelineRunner {
  private state: PipelineState | null = null;
  private readonly services: HostServices;
  private readonly config: OrchestratorConfig;
  private readonly companyId: string;
  private auditLog: AuditLog;
  private readonly healthMonitor: HealthMonitor;
  private readonly eventQueue: SerialEventQueue;
  private agents: Record<AgentRole, AgentDefinition> | null = null;

  /** Track revision count per phase number. */
  private readonly revisionCounts = new Map<number, number>();

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

    // Track CEO agent health
    this.healthMonitor.trackAgent(spawn.issueId, spawn.runId);

    // Store issue on pipeline state (no phase yet -- CEO is pipeline-level)
    await this.persistState();

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
  destroy(): void {
    this.healthMonitor.destroy();
    void this.worktreeManager?.cleanupAll().catch(() => {});
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
    switch (phase.status) {
      case 'discussing':
        await this.spawnDiscusser(phaseNumber);
        break;
      case 'reviewing':
        await this.spawnCeoReview(phaseNumber);
        break;
      case 'planning':
        await this.spawnPlanner(phaseNumber);
        break;
      case 'executing':
        await this.spawnExecutor(phaseNumber);
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

  private async spawnDiscusser(phaseNumber: number): Promise<void> {
    if (!this.state || !this.agents) return;

    const agentId = this.agents.discusser.agentId;
    const projectPath =
      this.worktreeManager?.getWorkingDirectory(phaseNumber) ??
      this.state.projectPath;
    const spawn = await retryWithBackoff(
      () =>
        spawnAgent(this.services, this.companyId, agentId, {
          role: 'discusser',
          projectPath,
          phaseNumber,
          gsdCommand: `/gsd:discuss-phase ${phaseNumber} --auto`,
        }),
      this.config.retry,
    );

    await this.setAgentOnPhase(phaseNumber, spawn.issueId, spawn.runId);
  }

  private async spawnCeoReview(phaseNumber: number): Promise<void> {
    if (!this.state || !this.agents) return;

    // Check revision count -- if over limit, fail
    const revCount = this.revisionCounts.get(phaseNumber) ?? 0;
    if (revCount > this.config.maxRevisions) {
      await this.handlePhaseEvent(phaseNumber, {
        type: 'STEP_FAILED',
        errorType: 'fatal',
        message: `Revision limit exceeded (${revCount}/${this.config.maxRevisions})`,
      });
      return;
    }

    const projectPath =
      this.worktreeManager?.getWorkingDirectory(phaseNumber) ??
      this.state.projectPath;
    const paddedPhase = String(phaseNumber).padStart(2, '0');
    const contextMdPath = `.planning/phases/${paddedPhase}-*/XX-CONTEXT.md`;

    const description = buildReviewIssueDescription(
      projectPath,
      phaseNumber,
      contextMdPath,
    );

    // Create issue with custom description (not standard spawnAgent)
    const issueResult = await this.services.issues.create({
      companyId: this.companyId,
      title: `CEO: Review phase ${phaseNumber} context`,
      description,
      status: 'todo',
      priority: 'high',
      assigneeAgentId: this.agents.ceo.agentId,
      executionWorkspaceSettings: { mode: 'isolated' },
    });

    if (!issueResult.ok) {
      log.error({ phaseNumber }, 'Failed to create CEO review issue');
      return;
    }

    const issueId = issueResult.value.id;

    const invokeResult = await this.services.agents.invoke({
      companyId: this.companyId,
      agentId: this.agents.ceo.agentId,
      reason: `GSD CEO review for phase ${phaseNumber}`,
      prompt: `You have a new task assigned. Issue ID: ${issueId}. Check your assigned issues and complete the task.`,
    });

    if (!invokeResult.ok) {
      log.error({ phaseNumber }, 'Failed to invoke CEO for review');
      return;
    }

    await this.setAgentOnPhase(phaseNumber, issueId, invokeResult.value.runId);
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

    await this.setAgentOnPhase(phaseNumber, spawn.issueId, spawn.runId);
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

    await this.setAgentOnPhase(phaseNumber, spawn.issueId, spawn.runId);
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

    await this.setAgentOnPhase(phaseNumber, spawn.issueId, spawn.runId);
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
      executionWorkspaceSettings: { mode: 'isolated' },
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

    await this.setAgentOnPhase(phaseNumber, issueId, invokeResult.value.runId);
  }

  // ── Private: Helpers ────────────────────────────────────────────

  /**
   * Set the active agent on a phase and track in health monitor.
   */
  private async setAgentOnPhase(
    phaseNumber: number,
    issueId: string,
    runId: string,
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
    log.debug({ stateSize: serialized.length }, 'State persisted');
  }
}
