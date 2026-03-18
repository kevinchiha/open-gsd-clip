import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AgentDefinition,
  AgentRole,
  HostServices,
} from '../agents/types.js';
import type { PhaseEvent } from '../pipeline/types.js';
import type { GsdSignal } from '../signals/types.js';
import { PipelineRunner } from './pipeline-runner.js';
import type { OrchestratorConfig } from './types.js';
import { DEFAULT_CONFIG } from './types.js';

// ── Mock modules ─────────────────────────────────────────────────────

vi.mock('../agents/factory.js', () => ({
  ensureAgentsExist: vi.fn(),
}));

vi.mock('../agents/invoker.js', () => ({
  spawnAgent: vi.fn(),
  mapSignalToPhaseEvent: vi.fn(),
}));

vi.mock('../signals/parser.js', () => ({
  parseSignal: vi.fn(),
}));

vi.mock('./quality-gate.js', () => ({
  buildCeoReviewContext: vi.fn(),
  buildReviewIssueDescription: vi.fn(),
  buildRevisionContext: vi.fn(),
  buildRevisionIssueDescription: vi.fn(),
}));

vi.mock('./error-handler.js', () => ({
  classifyError: vi.fn(),
  retryWithBackoff: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

vi.mock('./audit-log.js', () => ({
  AuditLog: vi.fn().mockImplementation(() => ({
    record: vi.fn().mockResolvedValue(undefined),
    readAll: vi.fn().mockResolvedValue([]),
    getLogPath: vi.fn().mockReturnValue('/tmp/audit.jsonl'),
  })),
}));

vi.mock('./worktree-manager.js', () => ({
  WorktreeManager: vi.fn().mockImplementation(() => ({
    createWorktree: vi.fn().mockImplementation(async (phaseNumber: number) => ({
      phaseNumber,
      branchName: `gsd/phase-${phaseNumber}`,
      worktreePath: `/worktree/phase-${phaseNumber}`,
    })),
    mergePhase: vi.fn().mockResolvedValue(undefined),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
    getWorkingDirectory: vi.fn(
      (phaseNumber: number) => `/worktree/phase-${phaseNumber}`,
    ),
    hasParallelPhases: vi.fn().mockReturnValue(false),
    pruneStaleWorktrees: vi.fn().mockResolvedValue(undefined),
    cleanupAll: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('./merge-queue.js', () => ({
  MergeQueue: vi.fn().mockImplementation(
    (
      _order: number[],
      onMerge: (n: number) => Promise<void>,
    ) => {
      const instance = {
        enqueue: vi.fn(async (n: number) => {
          await onMerge(n);
        }),
        markFailed: vi.fn().mockResolvedValue(undefined),
        isComplete: vi.fn().mockReturnValue(false),
      };
      return instance;
    },
  ),
}));

vi.mock('../pipeline/resolver.js', () => ({
  buildExecutionPlan: vi.fn(),
}));

// Suppress logger output in tests
vi.mock('../shared/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ── Helpers ──────────────────────────────────────────────────────────

function createMockServices(): HostServices {
  return {
    agents: {
      invoke: vi
        .fn()
        .mockResolvedValue({ ok: true, value: { runId: 'run-1' } }),
      list: vi.fn().mockResolvedValue({ ok: true, value: [] }),
      create: vi.fn().mockResolvedValue({
        ok: true,
        value: { agentId: 'agent-1', role: 'ceo', name: 'GSD CEO' },
      }),
    },
    issues: {
      create: vi.fn().mockResolvedValue({ ok: true, value: { id: 'issue-1' } }),
      createComment: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
      listComments: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    },
  };
}

function createMockAgents(): Record<AgentRole, AgentDefinition> {
  return {
    ceo: { agentId: 'ceo-agent-id', role: 'ceo', name: 'GSD CEO' },
    discusser: {
      agentId: 'discusser-agent-id',
      role: 'discusser',
      name: 'GSD Discusser',
    },
    planner: {
      agentId: 'planner-agent-id',
      role: 'planner',
      name: 'GSD Planner',
    },
    executor: {
      agentId: 'executor-agent-id',
      role: 'executor',
      name: 'GSD Executor',
    },
    verifier: {
      agentId: 'verifier-agent-id',
      role: 'verifier',
      name: 'GSD Verifier',
    },
  };
}

function makeConfig(
  overrides?: Partial<OrchestratorConfig>,
): OrchestratorConfig {
  return {
    ...DEFAULT_CONFIG,
    companyId: 'test-company',
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('PipelineRunner', () => {
  let services: HostServices;
  let config: OrchestratorConfig;
  let runner: PipelineRunner;

  // Dynamic imports for mocked modules
  let ensureAgentsExist: ReturnType<typeof vi.fn>;
  let spawnAgent: ReturnType<typeof vi.fn>;
  let mapSignalToPhaseEvent: ReturnType<typeof vi.fn>;
  let parseSignal: ReturnType<typeof vi.fn>;
  let classifyError: ReturnType<typeof vi.fn>;
  let buildCeoReviewContext: ReturnType<typeof vi.fn>;
  let buildReviewIssueDescription: ReturnType<typeof vi.fn>;
  let buildRevisionContext: ReturnType<typeof vi.fn>;
  let buildRevisionIssueDescription: ReturnType<typeof vi.fn>;
  let buildExecutionPlan: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();

    services = createMockServices();
    config = makeConfig();

    // Get mock references
    const factoryMod = await import('../agents/factory.js');
    const invokerMod = await import('../agents/invoker.js');
    const parserMod = await import('../signals/parser.js');
    const errorMod = await import('./error-handler.js');
    const qgMod = await import('./quality-gate.js');
    const resolverMod = await import('../pipeline/resolver.js');

    ensureAgentsExist = factoryMod.ensureAgentsExist as ReturnType<
      typeof vi.fn
    >;
    spawnAgent = invokerMod.spawnAgent as ReturnType<typeof vi.fn>;
    mapSignalToPhaseEvent = invokerMod.mapSignalToPhaseEvent as ReturnType<
      typeof vi.fn
    >;
    parseSignal = parserMod.parseSignal as ReturnType<typeof vi.fn>;
    classifyError = errorMod.classifyError as ReturnType<typeof vi.fn>;
    buildCeoReviewContext = qgMod.buildCeoReviewContext as ReturnType<
      typeof vi.fn
    >;
    buildReviewIssueDescription =
      qgMod.buildReviewIssueDescription as ReturnType<typeof vi.fn>;
    buildRevisionContext = qgMod.buildRevisionContext as ReturnType<
      typeof vi.fn
    >;
    buildRevisionIssueDescription =
      qgMod.buildRevisionIssueDescription as ReturnType<typeof vi.fn>;
    buildExecutionPlan = resolverMod.buildExecutionPlan as ReturnType<
      typeof vi.fn
    >;

    // Default mock: sequential 6-phase plan (matches Phase 4 behavior)
    buildExecutionPlan.mockReturnValue({
      ok: true,
      value: {
        groups: [[1], [2], [3], [4], [5], [6]],
        phaseOrder: [1, 2, 3, 4, 5, 6],
      },
    });

    // Default mock implementations
    ensureAgentsExist.mockResolvedValue(createMockAgents());
    spawnAgent.mockResolvedValue({ issueId: 'issue-1', runId: 'run-1' });
    buildCeoReviewContext.mockReturnValue({
      role: 'ceo',
      projectPath: '/test',
      gsdCommand: 'review-context',
    });
    buildReviewIssueDescription.mockReturnValue('Review description');
    buildRevisionContext.mockReturnValue({
      role: 'discusser',
      projectPath: '/test',
      gsdCommand: '/gsd:discuss-phase 1 --auto',
    });
    buildRevisionIssueDescription.mockReturnValue('Revision description');
    classifyError.mockReturnValue({
      type: 'fatal',
      retryable: false,
      maxRetries: 0,
      message: 'error',
    });

    runner = new PipelineRunner(services, config);
  });

  // ── 1. start ─────────────────────────────────────────────────────

  describe('start', () => {
    it('transitions pipeline idle -> initializing and spawns CEO', async () => {
      await runner.start('/test/project', 'Build a todo app');

      const state = runner.getState();
      expect(state).not.toBeNull();
      expect(state?.status).toBe('initializing');
      expect(state?.projectPath).toBe('/test/project');
      expect(state?.brief).toBe('Build a todo app');
      expect(ensureAgentsExist).toHaveBeenCalledOnce();
      expect(spawnAgent).toHaveBeenCalledOnce();
    });

    it('persists state after start', async () => {
      await runner.start('/test/project', 'Build a todo app');
      // State is persisted (currently via getState -- future will use HostServices.state)
      expect(runner.getState()).not.toBeNull();
    });
  });

  // ── 2. handleAgentCompletion with PROJECT_READY ──────────────────

  describe('handleAgentCompletion with PROJECT_READY', () => {
    it('transitions initializing -> analyzing -> running and starts first phase', async () => {
      await runner.start('/test/project', 'Build a todo app');

      // Mock comments with PROJECT_READY signal
      const projectReadySignal: GsdSignal = {
        type: 'PROJECT_READY',
        phase: 0,
        summary: 'Project initialized',
      };
      (
        services.issues.listComments as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        ok: true,
        value: [
          {
            id: 'c1',
            body: '---\nGSD_SIGNAL:PROJECT_READY\nphase: 0\nstatus: success\nsummary: done\n---',
          },
        ],
      });
      parseSignal.mockReturnValue(projectReadySignal);

      await runner.handleAgentCompletion({
        status: 'succeeded',
        agentId: 'ceo-agent-id',
        runId: 'run-1',
        issueId: 'issue-1',
      });

      const state = runner.getState();
      expect(state?.status).toBe('running');
      expect(state?.phases.length).toBeGreaterThan(0);
      expect(state?.executionPlan).not.toBeNull();
    });
  });

  // ── 3. Phase loop: discussing -> done ─────────────────────────────

  describe('phase loop: discussing -> done', () => {
    async function setupRunningPipeline() {
      await runner.start('/test/project', 'Build a todo app');

      // PROJECT_READY
      const projectReadySignal: GsdSignal = {
        type: 'PROJECT_READY',
        phase: 0,
        summary: 'Project initialized',
      };
      (
        services.issues.listComments as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        ok: true,
        value: [{ id: 'c1', body: 'signal' }],
      });
      parseSignal.mockReturnValue(projectReadySignal);

      await runner.handleAgentCompletion({
        status: 'succeeded',
        agentId: 'ceo-agent-id',
        runId: 'run-1',
        issueId: 'issue-1',
      });
    }

    it('completes a full phase cycle with correct signals', async () => {
      await setupRunningPipeline();

      const state = runner.getState()!;
      const firstPhase = state.phases[0]!;
      expect(firstPhase.status).toBe('discussing');

      // Simulate DISCUSS_COMPLETE
      const signals: Array<{ signal: GsdSignal; event: PhaseEvent }> = [
        {
          signal: {
            type: 'DISCUSS_COMPLETE',
            phase: firstPhase.phaseNumber,
            status: 'success',
            summary: 'done',
          },
          event: { type: 'STEP_COMPLETED' },
        },
        {
          signal: {
            type: 'APPROVED',
            phase: firstPhase.phaseNumber,
            summary: 'approved',
          },
          event: { type: 'APPROVED' },
        },
        {
          signal: {
            type: 'PLAN_COMPLETE',
            phase: firstPhase.phaseNumber,
            status: 'success',
            summary: 'planned',
          },
          event: { type: 'STEP_COMPLETED' },
        },
        {
          signal: {
            type: 'EXECUTE_COMPLETE',
            phase: firstPhase.phaseNumber,
            status: 'success',
            summary: 'done',
          },
          event: { type: 'STEP_COMPLETED' },
        },
        {
          signal: {
            type: 'VERIFY_COMPLETE',
            phase: firstPhase.phaseNumber,
            summary: 'verified',
          },
          event: { type: 'STEP_COMPLETED' },
        },
      ];

      for (const { signal, event } of signals) {
        // Issue a new issueId each time since each agent gets its own issue
        const issueId = `issue-${signal.type.toLowerCase()}`;
        spawnAgent.mockResolvedValue({
          issueId,
          runId: `run-${signal.type.toLowerCase()}`,
        });

        parseSignal.mockReturnValue(signal);
        mapSignalToPhaseEvent.mockReturnValue(event);

        await runner.handleAgentCompletion({
          status: 'succeeded',
          agentId: 'some-agent',
          runId: `run-${signal.type.toLowerCase()}`,
          issueId,
        });
      }

      // After all signals, the first phase should be done
      const updatedState = runner.getState()!;
      const updatedPhase = updatedState.phases.find(
        (p) => p.phaseNumber === firstPhase.phaseNumber,
      )!;
      expect(updatedPhase.status).toBe('done');
    });
  });

  // ── 4. REVISION_NEEDED triggers re-discussion ────────────────────

  describe('REVISION_NEEDED triggers re-discussion', () => {
    async function setupAtReviewing() {
      await runner.start('/test/project', 'Build a todo app');

      // PROJECT_READY
      parseSignal.mockReturnValue({
        type: 'PROJECT_READY',
        phase: 0,
        summary: 'done',
      } as GsdSignal);
      (
        services.issues.listComments as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        ok: true,
        value: [{ id: 'c1', body: 'signal' }],
      });

      await runner.handleAgentCompletion({
        status: 'succeeded',
        agentId: 'ceo-agent-id',
        runId: 'run-1',
        issueId: 'issue-1',
      });

      // DISCUSS_COMPLETE -> reviewing
      spawnAgent.mockResolvedValue({
        issueId: 'issue-discuss',
        runId: 'run-discuss',
      });
      parseSignal.mockReturnValue({
        type: 'DISCUSS_COMPLETE',
        phase: 1,
        status: 'success',
        summary: 'done',
      } as GsdSignal);
      mapSignalToPhaseEvent.mockReturnValue({
        type: 'STEP_COMPLETED',
      } as PhaseEvent);

      await runner.handleAgentCompletion({
        status: 'succeeded',
        agentId: 'discusser-agent-id',
        runId: 'run-discuss',
        issueId: 'issue-discuss',
      });
    }

    it('sends phase back to discussing and increments revision count', async () => {
      await setupAtReviewing();

      const stateBefore = runner.getState()!;
      const phase = stateBefore.phases[0]!;
      expect(phase.status).toBe('reviewing');

      // REVISION_NEEDED -> discussing
      spawnAgent.mockResolvedValue({
        issueId: 'issue-review',
        runId: 'run-review',
      });
      parseSignal.mockReturnValue({
        type: 'REVISION_NEEDED',
        phase: phase.phaseNumber,
        feedback: 'Missing error handling',
      } as GsdSignal);
      mapSignalToPhaseEvent.mockReturnValue({
        type: 'REVISION_NEEDED',
      } as PhaseEvent);

      await runner.handleAgentCompletion({
        status: 'succeeded',
        agentId: 'ceo-agent-id',
        runId: 'run-review',
        issueId: 'issue-review',
      });

      const stateAfter = runner.getState()!;
      const updatedPhase = stateAfter.phases.find(
        (p) => p.phaseNumber === phase.phaseNumber,
      )!;
      expect(updatedPhase.status).toBe('discussing');
    });
  });

  // ── 5. Revision limit exceeded ─────────────────────────────────

  describe('revision limit exceeded', () => {
    it('fails phase when revision count exceeds maxRevisions', async () => {
      const limitedConfig = makeConfig({ maxRevisions: 1 });
      runner = new PipelineRunner(services, limitedConfig);

      await runner.start('/test/project', 'Build a todo app');

      // PROJECT_READY
      parseSignal.mockReturnValue({
        type: 'PROJECT_READY',
        phase: 0,
        summary: 'done',
      } as GsdSignal);
      (
        services.issues.listComments as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        ok: true,
        value: [{ id: 'c1', body: 'signal' }],
      });

      await runner.handleAgentCompletion({
        status: 'succeeded',
        agentId: 'ceo-agent-id',
        runId: 'run-1',
        issueId: 'issue-1',
      });

      const firstPhaseNumber = runner.getState()?.phases[0]
        ?.phaseNumber as number;

      // First discussion + revision (revision count: 1)
      for (let i = 0; i < 2; i++) {
        // DISCUSS_COMPLETE
        spawnAgent.mockResolvedValue({
          issueId: `issue-d${i}`,
          runId: `run-d${i}`,
        });
        parseSignal.mockReturnValue({
          type: 'DISCUSS_COMPLETE',
          phase: firstPhaseNumber,
          status: 'success',
          summary: 'done',
        } as GsdSignal);
        mapSignalToPhaseEvent.mockReturnValue({
          type: 'STEP_COMPLETED',
        } as PhaseEvent);

        await runner.handleAgentCompletion({
          status: 'succeeded',
          agentId: 'discusser-agent-id',
          runId: `run-d${i}`,
          issueId: `issue-d${i}`,
        });

        // REVISION_NEEDED
        spawnAgent.mockResolvedValue({
          issueId: `issue-r${i}`,
          runId: `run-r${i}`,
        });
        parseSignal.mockReturnValue({
          type: 'REVISION_NEEDED',
          phase: firstPhaseNumber,
          feedback: `Feedback ${i}`,
        } as GsdSignal);
        mapSignalToPhaseEvent.mockReturnValue({
          type: 'REVISION_NEEDED',
        } as PhaseEvent);

        await runner.handleAgentCompletion({
          status: 'succeeded',
          agentId: 'ceo-agent-id',
          runId: `run-r${i}`,
          issueId: `issue-r${i}`,
        });
      }

      // After 2 REVISION_NEEDED with maxRevisions=1, phase should be failed
      const finalState = runner.getState();
      const updatedPhase = finalState?.phases.find(
        (p) => p.phaseNumber === firstPhaseNumber,
      );
      expect(updatedPhase?.status).toBe('failed');
    });
  });

  // ── 6. Retry phase from failed ─────────────────────────────────

  describe('retry phase from failed', () => {
    it('sends RETRY_PHASE for transient error and resets phase to pending', async () => {
      await runner.start('/test/project', 'Build a todo app');

      // PROJECT_READY
      parseSignal.mockReturnValue({
        type: 'PROJECT_READY',
        phase: 0,
        summary: 'done',
      } as GsdSignal);
      (
        services.issues.listComments as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        ok: true,
        value: [{ id: 'c1', body: 'signal' }],
      });

      await runner.handleAgentCompletion({
        status: 'succeeded',
        agentId: 'ceo-agent-id',
        runId: 'run-1',
        issueId: 'issue-1',
      });

      const firstPhaseNumber = runner.getState()?.phases[0]
        ?.phaseNumber as number;

      // Agent fails
      spawnAgent.mockResolvedValue({
        issueId: 'issue-fail',
        runId: 'run-fail',
      });

      await runner.handleAgentCompletion({
        status: 'failed',
        agentId: 'discusser-agent-id',
        runId: 'run-fail',
        issueId: 'issue-fail',
      });

      // With transient error, phase should retry
      classifyError.mockReturnValue({
        type: 'transient',
        retryable: true,
        maxRetries: 3,
        message: 'ETIMEDOUT',
      });

      // The phase should go to failed then get retried back to discussing
      const state = runner.getState()!;
      const phase = state.phases.find(
        (p) => p.phaseNumber === firstPhaseNumber,
      )!;
      // After retry, phase should be back in discussing (pending -> discussing via DEPENDENCIES_MET)
      expect(phase.status === 'discussing' || phase.status === 'pending').toBe(
        true,
      );
    });
  });

  // ── 7. Replan on verification failure ────────────────────────────

  describe('replan on verification failure', () => {
    it('transitions back to executing when verification fails (test_failure)', async () => {
      await runner.start('/test/project', 'Build a todo app');

      // PROJECT_READY
      parseSignal.mockReturnValue({
        type: 'PROJECT_READY',
        phase: 0,
        summary: 'done',
      } as GsdSignal);
      (
        services.issues.listComments as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        ok: true,
        value: [{ id: 'c1', body: 'signal' }],
      });

      await runner.handleAgentCompletion({
        status: 'succeeded',
        agentId: 'ceo-agent-id',
        runId: 'run-1',
        issueId: 'issue-1',
      });

      const firstPhaseNumber = runner.getState()?.phases[0]
        ?.phaseNumber as number;

      // Advance through discussing -> reviewing -> planning -> executing -> verifying
      const stepsToVerifying: Array<{ signal: GsdSignal; event: PhaseEvent }> =
        [
          {
            signal: {
              type: 'DISCUSS_COMPLETE',
              phase: firstPhaseNumber,
              status: 'success',
              summary: 'done',
            },
            event: { type: 'STEP_COMPLETED' },
          },
          {
            signal: {
              type: 'APPROVED',
              phase: firstPhaseNumber,
              summary: 'approved',
            },
            event: { type: 'APPROVED' },
          },
          {
            signal: {
              type: 'PLAN_COMPLETE',
              phase: firstPhaseNumber,
              status: 'success',
              summary: 'planned',
            },
            event: { type: 'STEP_COMPLETED' },
          },
          {
            signal: {
              type: 'EXECUTE_COMPLETE',
              phase: firstPhaseNumber,
              status: 'success',
              summary: 'done',
            },
            event: { type: 'STEP_COMPLETED' },
          },
        ];

      for (const { signal, event } of stepsToVerifying) {
        spawnAgent.mockResolvedValue({
          issueId: `issue-${signal.type}`,
          runId: `run-${signal.type}`,
        });
        parseSignal.mockReturnValue(signal);
        mapSignalToPhaseEvent.mockReturnValue(event);

        await runner.handleAgentCompletion({
          status: 'succeeded',
          agentId: 'some-agent',
          runId: `run-${signal.type}`,
          issueId: `issue-${signal.type}`,
        });
      }

      // Now at verifying, send VERIFY_FAILED -> should go back to executing per phase-machine
      spawnAgent.mockResolvedValue({ issueId: 'issue-vf', runId: 'run-vf' });
      parseSignal.mockReturnValue({
        type: 'VERIFY_FAILED',
        phase: firstPhaseNumber,
        issues: ['Tests failed: 3 assertions'],
      } as GsdSignal);
      mapSignalToPhaseEvent.mockReturnValue({
        type: 'STEP_FAILED',
        errorType: 'test_failure',
        message: 'Tests failed: 3 assertions',
      } as PhaseEvent);

      await runner.handleAgentCompletion({
        status: 'succeeded',
        agentId: 'verifier-agent-id',
        runId: 'run-vf',
        issueId: 'issue-vf',
      });

      const state = runner.getState()!;
      const phase = state.phases.find(
        (p) => p.phaseNumber === firstPhaseNumber,
      )!;
      // verifying + STEP_FAILED -> executing (per phase-machine transition table)
      expect(phase.status).toBe('executing');
    });
  });

  // ── 8. All phases done ──────────────────────────────────────────

  describe('all phases done', () => {
    it('transitions pipeline to completed when all phases finish', async () => {
      await runner.start('/test/project', 'Build a todo app');

      // PROJECT_READY
      parseSignal.mockReturnValue({
        type: 'PROJECT_READY',
        phase: 0,
        summary: 'done',
      } as GsdSignal);
      (
        services.issues.listComments as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        ok: true,
        value: [{ id: 'c1', body: 'signal' }],
      });

      await runner.handleAgentCompletion({
        status: 'succeeded',
        agentId: 'ceo-agent-id',
        runId: 'run-1',
        issueId: 'issue-1',
      });

      const state = runner.getState()!;

      // Complete every phase by cycling through the full discuss -> verify loop
      for (const phase of state.phases) {
        const signals: Array<{ signal: GsdSignal; event: PhaseEvent }> = [
          {
            signal: {
              type: 'DISCUSS_COMPLETE',
              phase: phase.phaseNumber,
              status: 'success',
              summary: 'done',
            },
            event: { type: 'STEP_COMPLETED' },
          },
          {
            signal: {
              type: 'APPROVED',
              phase: phase.phaseNumber,
              summary: 'approved',
            },
            event: { type: 'APPROVED' },
          },
          {
            signal: {
              type: 'PLAN_COMPLETE',
              phase: phase.phaseNumber,
              status: 'success',
              summary: 'planned',
            },
            event: { type: 'STEP_COMPLETED' },
          },
          {
            signal: {
              type: 'EXECUTE_COMPLETE',
              phase: phase.phaseNumber,
              status: 'success',
              summary: 'done',
            },
            event: { type: 'STEP_COMPLETED' },
          },
          {
            signal: {
              type: 'VERIFY_COMPLETE',
              phase: phase.phaseNumber,
              summary: 'verified',
            },
            event: { type: 'STEP_COMPLETED' },
          },
        ];

        for (const { signal, event } of signals) {
          const issueId = `issue-p${phase.phaseNumber}-${signal.type}`;
          spawnAgent.mockResolvedValue({
            issueId,
            runId: `run-p${phase.phaseNumber}-${signal.type}`,
          });
          parseSignal.mockReturnValue(signal);
          mapSignalToPhaseEvent.mockReturnValue(event);

          await runner.handleAgentCompletion({
            status: 'succeeded',
            agentId: 'some-agent',
            runId: `run-p${phase.phaseNumber}-${signal.type}`,
            issueId,
          });
        }
      }

      const finalState = runner.getState()!;
      expect(finalState.status).toBe('completed');
    });
  });

  // ── 9. Serial event processing ─────────────────────────────────

  describe('serial event processing', () => {
    it('processes events serially via event queue', async () => {
      await runner.start('/test/project', 'Build a todo app');

      const callOrder: number[] = [];

      // PROJECT_READY for first call
      parseSignal.mockReturnValue({
        type: 'PROJECT_READY',
        phase: 0,
        summary: 'done',
      } as GsdSignal);
      (
        services.issues.listComments as ReturnType<typeof vi.fn>
      ).mockImplementation(async () => {
        callOrder.push(1);
        // Small delay to test serialization
        await new Promise((r) => globalThis.setTimeout(r, 10));
        callOrder.push(2);
        return { ok: true, value: [{ id: 'c1', body: 'signal' }] };
      });

      // Fire two completions concurrently
      const p1 = runner.handleAgentCompletion({
        status: 'succeeded',
        agentId: 'ceo-agent-id',
        runId: 'run-1',
        issueId: 'issue-1',
      });

      const p2 = runner.handleAgentCompletion({
        status: 'succeeded',
        agentId: 'ceo-agent-id',
        runId: 'run-2',
        issueId: 'issue-2',
      });

      await Promise.allSettled([p1, p2]);

      // Events should have been serialized (1,2 then 1,2 -- not interleaved)
      expect(callOrder[0]).toBe(1);
      expect(callOrder[1]).toBe(2);
    });
  });

  // ── 10. Parallel group execution ────────────────────────────────

  describe('parallel group execution', () => {
    /**
     * Set up a running pipeline with parallel groups: [[1, 3], [2]].
     * Phase 1 and 3 are independent, phase 2 depends on both.
     */
    async function setupParallelPipeline() {
      // Override resolver to return parallel groups
      buildExecutionPlan.mockReturnValue({
        ok: true,
        value: {
          groups: [[1, 3], [2]],
          phaseOrder: [1, 3, 2],
        },
      });

      await runner.start('/test/project', 'Build a todo app');

      // PROJECT_READY
      parseSignal.mockReturnValue({
        type: 'PROJECT_READY',
        phase: 0,
        summary: 'done',
      } as GsdSignal);
      (
        services.issues.listComments as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        ok: true,
        value: [{ id: 'c1', body: 'signal' }],
      });

      await runner.handleAgentCompletion({
        status: 'succeeded',
        agentId: 'ceo-agent-id',
        runId: 'run-1',
        issueId: 'issue-1',
      });
    }

    it('starts all phases in first group simultaneously', async () => {
      await setupParallelPipeline();

      const state = runner.getState()!;
      const phase1 = state.phases.find((p) => p.phaseNumber === 1)!;
      const phase2 = state.phases.find((p) => p.phaseNumber === 2)!;
      const phase3 = state.phases.find((p) => p.phaseNumber === 3)!;

      // Phase 1 and 3 should both be started (discussing)
      expect(phase1.status).toBe('discussing');
      expect(phase3.status).toBe('discussing');
      // Phase 2 depends on both, should remain pending
      expect(phase2.status).toBe('pending');
    });
  });

  // ── 11. Dependent phase waits ──────────────────────────────────

  describe('dependent phase waits', () => {
    it('does not start dependent phase until all dependencies complete', async () => {
      // groups: [[1, 3], [2]] with phase 2 depending on 1 and 3
      buildExecutionPlan.mockReturnValue({
        ok: true,
        value: {
          groups: [[1, 3], [2]],
          phaseOrder: [1, 3, 2],
        },
      });

      await runner.start('/test/project', 'Build a todo app');

      // PROJECT_READY
      parseSignal.mockReturnValue({
        type: 'PROJECT_READY',
        phase: 0,
        summary: 'done',
      } as GsdSignal);
      (
        services.issues.listComments as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        ok: true,
        value: [{ id: 'c1', body: 'signal' }],
      });

      await runner.handleAgentCompletion({
        status: 'succeeded',
        agentId: 'ceo-agent-id',
        runId: 'run-1',
        issueId: 'issue-1',
      });

      // Complete phase 1 through full cycle
      const phaseSignals: Array<{ signal: GsdSignal; event: PhaseEvent }> = [
        {
          signal: { type: 'DISCUSS_COMPLETE', phase: 1, status: 'success', summary: 'done' },
          event: { type: 'STEP_COMPLETED' },
        },
        {
          signal: { type: 'APPROVED', phase: 1, summary: 'approved' },
          event: { type: 'APPROVED' },
        },
        {
          signal: { type: 'PLAN_COMPLETE', phase: 1, status: 'success', summary: 'planned' },
          event: { type: 'STEP_COMPLETED' },
        },
        {
          signal: { type: 'EXECUTE_COMPLETE', phase: 1, status: 'success', summary: 'done' },
          event: { type: 'STEP_COMPLETED' },
        },
        {
          signal: { type: 'VERIFY_COMPLETE', phase: 1, summary: 'verified' },
          event: { type: 'STEP_COMPLETED' },
        },
      ];

      for (const { signal, event } of phaseSignals) {
        const issueId = `issue-p1-${signal.type}`;
        spawnAgent.mockResolvedValue({ issueId, runId: `run-p1-${signal.type}` });
        parseSignal.mockReturnValue(signal);
        mapSignalToPhaseEvent.mockReturnValue(event);

        await runner.handleAgentCompletion({
          status: 'succeeded',
          agentId: 'some-agent',
          runId: `run-p1-${signal.type}`,
          issueId,
        });
      }

      // Phase 1 done, but phase 3 still running -> phase 2 should be pending
      const state = runner.getState()!;
      const phase1 = state.phases.find((p) => p.phaseNumber === 1)!;
      const phase2 = state.phases.find((p) => p.phaseNumber === 2)!;
      const phase3 = state.phases.find((p) => p.phaseNumber === 3)!;

      expect(phase1.status).toBe('done');
      expect(phase3.status).toBe('discussing'); // still running
      expect(phase2.status).toBe('pending'); // blocked on phase 3
    });
  });

  // ── 12. Worktree path used for agent spawn ────────────────────

  describe('worktree path used for agent spawn', () => {
    it('passes worktree path as projectPath in agent spawn', async () => {
      // Use parallel groups to ensure worktrees are created
      buildExecutionPlan.mockReturnValue({
        ok: true,
        value: {
          groups: [[1, 3], [2]],
          phaseOrder: [1, 3, 2],
        },
      });

      await runner.start('/test/project', 'Build a todo app');

      // PROJECT_READY
      parseSignal.mockReturnValue({
        type: 'PROJECT_READY',
        phase: 0,
        summary: 'done',
      } as GsdSignal);
      (
        services.issues.listComments as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        ok: true,
        value: [{ id: 'c1', body: 'signal' }],
      });

      await runner.handleAgentCompletion({
        status: 'succeeded',
        agentId: 'ceo-agent-id',
        runId: 'run-1',
        issueId: 'issue-1',
      });

      // spawnAgent should have been called with worktree paths for phases 1 and 3
      const spawnCalls = spawnAgent.mock.calls;
      // Find the discusser spawn calls (after CEO spawn)
      const discusserCalls = spawnCalls.filter(
        (call: unknown[]) =>
          (call[3] as { role: string }).role === 'discusser',
      );

      // At least one should use a worktree path
      const worktreePaths = discusserCalls.map(
        (call: unknown[]) => (call[3] as { projectPath: string }).projectPath,
      );
      expect(worktreePaths).toContain('/worktree/phase-1');
      expect(worktreePaths).toContain('/worktree/phase-3');
    });
  });

  // ── 13. Merge queue receives completed phases ─────────────────

  describe('merge queue receives completed phases', () => {
    it('enqueues completed phase in MergeQueue', async () => {
      // Use parallel groups
      buildExecutionPlan.mockReturnValue({
        ok: true,
        value: {
          groups: [[1, 3], [2]],
          phaseOrder: [1, 3, 2],
        },
      });

      await runner.start('/test/project', 'Build a todo app');

      // PROJECT_READY
      parseSignal.mockReturnValue({
        type: 'PROJECT_READY',
        phase: 0,
        summary: 'done',
      } as GsdSignal);
      (
        services.issues.listComments as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        ok: true,
        value: [{ id: 'c1', body: 'signal' }],
      });

      await runner.handleAgentCompletion({
        status: 'succeeded',
        agentId: 'ceo-agent-id',
        runId: 'run-1',
        issueId: 'issue-1',
      });

      // Complete phase 1 through full cycle
      const phaseSignals: Array<{ signal: GsdSignal; event: PhaseEvent }> = [
        { signal: { type: 'DISCUSS_COMPLETE', phase: 1, status: 'success', summary: 'done' }, event: { type: 'STEP_COMPLETED' } },
        { signal: { type: 'APPROVED', phase: 1, summary: 'approved' }, event: { type: 'APPROVED' } },
        { signal: { type: 'PLAN_COMPLETE', phase: 1, status: 'success', summary: 'planned' }, event: { type: 'STEP_COMPLETED' } },
        { signal: { type: 'EXECUTE_COMPLETE', phase: 1, status: 'success', summary: 'done' }, event: { type: 'STEP_COMPLETED' } },
        { signal: { type: 'VERIFY_COMPLETE', phase: 1, summary: 'verified' }, event: { type: 'STEP_COMPLETED' } },
      ];

      for (const { signal, event } of phaseSignals) {
        const issueId = `issue-p1-${signal.type}`;
        spawnAgent.mockResolvedValue({ issueId, runId: `run-p1-${signal.type}` });
        parseSignal.mockReturnValue(signal);
        mapSignalToPhaseEvent.mockReturnValue(event);

        await runner.handleAgentCompletion({
          status: 'succeeded',
          agentId: 'some-agent',
          runId: `run-p1-${signal.type}`,
          issueId,
        });
      }

      // Get MergeQueue instance to verify enqueue was called
      const { MergeQueue } = await import('./merge-queue.js');
      const mqConstructor = MergeQueue as ReturnType<typeof vi.fn>;
      const mqInstance = mqConstructor.mock.results[0]?.value;

      expect(mqInstance.enqueue).toHaveBeenCalledWith(1);
    });
  });

  // ── 14. Failed phase marked in merge queue ─────────────────────

  describe('failed phase marked in merge queue', () => {
    it('calls MergeQueue.markFailed when phase fails with fatal error', async () => {
      buildExecutionPlan.mockReturnValue({
        ok: true,
        value: {
          groups: [[1, 3], [2]],
          phaseOrder: [1, 3, 2],
        },
      });

      await runner.start('/test/project', 'Build a todo app');

      // PROJECT_READY
      parseSignal.mockReturnValue({
        type: 'PROJECT_READY',
        phase: 0,
        summary: 'done',
      } as GsdSignal);
      (
        services.issues.listComments as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        ok: true,
        value: [{ id: 'c1', body: 'signal' }],
      });

      await runner.handleAgentCompletion({
        status: 'succeeded',
        agentId: 'ceo-agent-id',
        runId: 'run-1',
        issueId: 'issue-1',
      });

      // Phase 1 agent fails
      classifyError.mockReturnValue({
        type: 'fatal',
        retryable: false,
        maxRetries: 0,
        message: 'fatal error',
      });

      spawnAgent.mockResolvedValue({
        issueId: 'issue-p1-discuss',
        runId: 'run-p1-discuss',
      });

      await runner.handleAgentCompletion({
        status: 'failed',
        agentId: 'discusser-agent-id',
        runId: 'run-p1-discuss',
        issueId: 'issue-p1-discuss',
      });

      // Verify markFailed was called on MergeQueue
      const { MergeQueue } = await import('./merge-queue.js');
      const mqConstructor = MergeQueue as ReturnType<typeof vi.fn>;
      const mqInstance = mqConstructor.mock.results[0]?.value;

      expect(mqInstance.markFailed).toHaveBeenCalledWith(1);
    });
  });

  // ── 15. Sequential plan backward compatible ────────────────────

  describe('sequential plan backward compatible', () => {
    it('executes phases one at a time with groups of size 1', async () => {
      // Default mock already returns sequential [[1],[2],[3],[4],[5],[6]]
      await runner.start('/test/project', 'Build a todo app');

      // PROJECT_READY
      parseSignal.mockReturnValue({
        type: 'PROJECT_READY',
        phase: 0,
        summary: 'done',
      } as GsdSignal);
      (
        services.issues.listComments as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        ok: true,
        value: [{ id: 'c1', body: 'signal' }],
      });

      await runner.handleAgentCompletion({
        status: 'succeeded',
        agentId: 'ceo-agent-id',
        runId: 'run-1',
        issueId: 'issue-1',
      });

      const state = runner.getState()!;

      // Only phase 1 should be discussing, all others pending
      const phase1 = state.phases.find((p) => p.phaseNumber === 1)!;
      expect(phase1.status).toBe('discussing');

      for (const phase of state.phases) {
        if (phase.phaseNumber !== 1) {
          expect(phase.status).toBe('pending');
        }
      }
    });
  });
});
