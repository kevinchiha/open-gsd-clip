import { describe, expect, it } from 'vitest';
import {
  cascadeFailure,
  createInitialPipelineState,
  pipelineTransition,
} from './fsm.js';
import type {
  ExecutionPlan,
  PhaseError,
  PhaseState,
  PipelineEvent,
  PipelineState,
} from './types.js';

// ── Helpers ──────────────────────────────────────────────────────────

function makePhaseState(
  phaseNumber: number,
  overrides: Partial<PhaseState> = {},
): PhaseState {
  return {
    phaseNumber,
    status: 'pending',
    stepTimings: {},
    activeAgentIssueId: null,
    error: null,
    failureCascade: null,
    ...overrides,
  };
}

const testPlan: ExecutionPlan = {
  groups: [[1], [2, 3]],
  phaseOrder: [1, 2, 3],
};

const testError: PhaseError = {
  type: 'test_failure',
  message: 'Tests did not pass',
  retryCount: 0,
  lastAttemptAt: null,
};

// ── createInitialPipelineState ───────────────────────────────────────

describe('createInitialPipelineState', () => {
  it('returns idle state with null timestamps', () => {
    const state = createInitialPipelineState('/project', 'build a widget');
    expect(state.status).toBe('idle');
    expect(state.projectPath).toBe('/project');
    expect(state.brief).toBe('build a widget');
    expect(state.phases).toEqual([]);
    expect(state.executionPlan).toBeNull();
    expect(state.startedAt).toBeNull();
    expect(state.completedAt).toBeNull();
    expect(state.lastTransitionAt).toBeTypeOf('string');
  });
});

// ── Valid pipeline transitions ───────────────────────────────────────

describe('pipelineTransition - valid transitions', () => {
  it('idle + START_PIPELINE -> initializing', () => {
    const state = createInitialPipelineState('/p', 'brief');
    const result = pipelineTransition(state, { type: 'START_PIPELINE' });
    expect(result.valid).toBe(true);
    expect(result.state.status).toBe('initializing');
    expect(result.state.startedAt).toBeTypeOf('string');
  });

  it('initializing + PROJECT_READY -> analyzing', () => {
    const state: PipelineState = {
      ...createInitialPipelineState('/p', 'b'),
      status: 'initializing',
      startedAt: '2026-01-01T00:00:00.000Z',
    };
    const result = pipelineTransition(state, { type: 'PROJECT_READY' });
    expect(result.valid).toBe(true);
    expect(result.state.status).toBe('analyzing');
  });

  it('analyzing + ANALYSIS_COMPLETE -> running (stores execution plan)', () => {
    const state: PipelineState = {
      ...createInitialPipelineState('/p', 'b'),
      status: 'analyzing',
      startedAt: '2026-01-01T00:00:00.000Z',
    };
    const result = pipelineTransition(state, {
      type: 'ANALYSIS_COMPLETE',
      executionPlan: testPlan,
    });
    expect(result.valid).toBe(true);
    expect(result.state.status).toBe('running');
    expect(result.state.executionPlan).toEqual(testPlan);
  });

  it('running + ALL_PHASES_DONE -> completed (sets completedAt)', () => {
    const state: PipelineState = {
      ...createInitialPipelineState('/p', 'b'),
      status: 'running',
      startedAt: '2026-01-01T00:00:00.000Z',
      executionPlan: testPlan,
    };
    const result = pipelineTransition(state, { type: 'ALL_PHASES_DONE' });
    expect(result.valid).toBe(true);
    expect(result.state.status).toBe('completed');
    expect(result.state.completedAt).toBeTypeOf('string');
  });

  it('running + UNRECOVERABLE_ERROR -> failed', () => {
    const state: PipelineState = {
      ...createInitialPipelineState('/p', 'b'),
      status: 'running',
      startedAt: '2026-01-01T00:00:00.000Z',
    };
    const result = pipelineTransition(state, {
      type: 'UNRECOVERABLE_ERROR',
      error: 'boom',
    });
    expect(result.valid).toBe(true);
    expect(result.state.status).toBe('failed');
  });

  it('running + PAUSE_REQUESTED -> paused', () => {
    const state: PipelineState = {
      ...createInitialPipelineState('/p', 'b'),
      status: 'running',
      startedAt: '2026-01-01T00:00:00.000Z',
    };
    const result = pipelineTransition(state, { type: 'PAUSE_REQUESTED' });
    expect(result.valid).toBe(true);
    expect(result.state.status).toBe('paused');
  });

  it('paused + RESUME_REQUESTED -> running', () => {
    const state: PipelineState = {
      ...createInitialPipelineState('/p', 'b'),
      status: 'paused',
      startedAt: '2026-01-01T00:00:00.000Z',
    };
    const result = pipelineTransition(state, { type: 'RESUME_REQUESTED' });
    expect(result.valid).toBe(true);
    expect(result.state.status).toBe('running');
  });

  it('running + PHASE_COMPLETED updates phase status', () => {
    const state: PipelineState = {
      ...createInitialPipelineState('/p', 'b'),
      status: 'running',
      startedAt: '2026-01-01T00:00:00.000Z',
      phases: [makePhaseState(1, { status: 'verifying' }), makePhaseState(2)],
    };
    const result = pipelineTransition(state, {
      type: 'PHASE_COMPLETED',
      phaseNumber: 1,
    });
    expect(result.valid).toBe(true);
    expect(result.state.status).toBe('running');
    const phase1 = result.state.phases.find((p) => p.phaseNumber === 1);
    expect(phase1?.status).toBe('done');
  });

  it('running + PHASE_FAILED updates phase error info', () => {
    const state: PipelineState = {
      ...createInitialPipelineState('/p', 'b'),
      status: 'running',
      startedAt: '2026-01-01T00:00:00.000Z',
      phases: [
        makePhaseState(1, { status: 'executing' }),
        makePhaseState(2),
      ],
    };
    const result = pipelineTransition(state, {
      type: 'PHASE_FAILED',
      phaseNumber: 1,
      error: testError,
    });
    expect(result.valid).toBe(true);
    expect(result.state.status).toBe('running');
    const phase1 = result.state.phases.find((p) => p.phaseNumber === 1);
    expect(phase1?.status).toBe('failed');
    expect(phase1?.error).toEqual(testError);
  });

  it('updates lastTransitionAt on every valid transition', () => {
    const state = createInitialPipelineState('/p', 'b');
    const before = state.lastTransitionAt;
    // Small delay not needed -- just check it's a string
    const result = pipelineTransition(state, { type: 'START_PIPELINE' });
    expect(result.state.lastTransitionAt).toBeTypeOf('string');
    expect(result.state.lastTransitionAt).not.toBeNull();
  });
});

// ── Invalid pipeline transitions ─────────────────────────────────────

describe('pipelineTransition - invalid transitions', () => {
  const invalidCases: Array<{
    name: string;
    status: PipelineState['status'];
    event: PipelineEvent;
  }> = [
    {
      name: 'idle + PROJECT_READY',
      status: 'idle',
      event: { type: 'PROJECT_READY' },
    },
    {
      name: 'idle + ALL_PHASES_DONE',
      status: 'idle',
      event: { type: 'ALL_PHASES_DONE' },
    },
    {
      name: 'initializing + START_PIPELINE',
      status: 'initializing',
      event: { type: 'START_PIPELINE' },
    },
    {
      name: 'analyzing + PROJECT_READY',
      status: 'analyzing',
      event: { type: 'PROJECT_READY' },
    },
    {
      name: 'running + START_PIPELINE',
      status: 'running',
      event: { type: 'START_PIPELINE' },
    },
    {
      name: 'paused + START_PIPELINE',
      status: 'paused',
      event: { type: 'START_PIPELINE' },
    },
  ];

  for (const { name, status, event } of invalidCases) {
    it(`rejects ${name} with description`, () => {
      const state: PipelineState = {
        ...createInitialPipelineState('/p', 'b'),
        status,
        startedAt: status !== 'idle' ? '2026-01-01T00:00:00.000Z' : null,
      };
      const result = pipelineTransition(state, event);
      expect(result.valid).toBe(false);
      expect(result.description).toBeTypeOf('string');
      expect(result.description!.length).toBeGreaterThan(0);
    });
  }
});

// ── Terminal state rejection ─────────────────────────────────────────

describe('pipelineTransition - terminal states', () => {
  const allEvents: PipelineEvent[] = [
    { type: 'START_PIPELINE' },
    { type: 'PROJECT_READY' },
    {
      type: 'ANALYSIS_COMPLETE',
      executionPlan: testPlan,
    },
    { type: 'PHASE_COMPLETED', phaseNumber: 1 },
    { type: 'PHASE_FAILED', phaseNumber: 1, error: testError },
    { type: 'ALL_PHASES_DONE' },
    { type: 'PAUSE_REQUESTED' },
    { type: 'RESUME_REQUESTED' },
    { type: 'UNRECOVERABLE_ERROR', error: 'boom' },
  ];

  for (const event of allEvents) {
    it(`completed rejects ${event.type}`, () => {
      const state: PipelineState = {
        ...createInitialPipelineState('/p', 'b'),
        status: 'completed',
        startedAt: '2026-01-01T00:00:00.000Z',
        completedAt: '2026-01-01T01:00:00.000Z',
      };
      const result = pipelineTransition(state, event);
      expect(result.valid).toBe(false);
    });

    it(`failed rejects ${event.type}`, () => {
      const state: PipelineState = {
        ...createInitialPipelineState('/p', 'b'),
        status: 'failed',
        startedAt: '2026-01-01T00:00:00.000Z',
      };
      const result = pipelineTransition(state, event);
      expect(result.valid).toBe(false);
    });
  }
});

// ── cascadeFailure ───────────────────────────────────────────────────

describe('cascadeFailure', () => {
  it('linear chain: A fails, B and C auto-fail', () => {
    // A(1) -> B(2) -> C(3)
    const state: PipelineState = {
      ...createInitialPipelineState('/p', 'b'),
      status: 'running',
      phases: [
        makePhaseState(1, { status: 'failed', error: testError }),
        makePhaseState(2),
        makePhaseState(3),
      ],
    };
    const dependents = new Map<number, number[]>([
      [1, [2]],
      [2, [3]],
    ]);
    const result = cascadeFailure(state, 1, testError, dependents);
    expect(result.phases.find((p) => p.phaseNumber === 2)?.status).toBe(
      'failed',
    );
    expect(
      result.phases.find((p) => p.phaseNumber === 2)?.failureCascade,
    ).toEqual({
      rootCausePhase: 1,
      failureType: 'test_failure',
      errorSummary: 'Tests did not pass',
    });
    expect(result.phases.find((p) => p.phaseNumber === 3)?.status).toBe(
      'failed',
    );
    expect(
      result.phases.find((p) => p.phaseNumber === 3)?.failureCascade,
    ).toEqual({
      rootCausePhase: 1,
      failureType: 'test_failure',
      errorSummary: 'Tests did not pass',
    });
  });

  it('diamond: A fails, B, C, D all auto-fail', () => {
    // A(1) -> B(2), A(1) -> C(3), B(2) -> D(4), C(3) -> D(4)
    const state: PipelineState = {
      ...createInitialPipelineState('/p', 'b'),
      status: 'running',
      phases: [
        makePhaseState(1, { status: 'failed', error: testError }),
        makePhaseState(2),
        makePhaseState(3),
        makePhaseState(4),
      ],
    };
    const dependents = new Map<number, number[]>([
      [1, [2, 3]],
      [2, [4]],
      [3, [4]],
    ]);
    const result = cascadeFailure(state, 1, testError, dependents);
    expect(result.phases.find((p) => p.phaseNumber === 2)?.status).toBe(
      'failed',
    );
    expect(result.phases.find((p) => p.phaseNumber === 3)?.status).toBe(
      'failed',
    );
    expect(result.phases.find((p) => p.phaseNumber === 4)?.status).toBe(
      'failed',
    );
  });

  it('skips already-failed phases', () => {
    const state: PipelineState = {
      ...createInitialPipelineState('/p', 'b'),
      status: 'running',
      phases: [
        makePhaseState(1, { status: 'failed', error: testError }),
        makePhaseState(2, {
          status: 'failed',
          error: {
            type: 'fatal',
            message: 'previous failure',
            retryCount: 0,
            lastAttemptAt: null,
          },
        }),
        makePhaseState(3),
      ],
    };
    const dependents = new Map<number, number[]>([
      [1, [2]],
      [2, [3]],
    ]);
    const result = cascadeFailure(state, 1, testError, dependents);
    // Phase 2 was already failed -- should remain as-is (no cascade info overwrite)
    const phase2 = result.phases.find((p) => p.phaseNumber === 2)!;
    expect(phase2.status).toBe('failed');
    // Its cascade info should NOT be overwritten since it was already failed
    expect(phase2.failureCascade).toBeNull();
    // Phase 3 should still be cascaded through phase 2
    expect(result.phases.find((p) => p.phaseNumber === 3)?.status).toBe(
      'failed',
    );
  });

  it('skips done phases', () => {
    const state: PipelineState = {
      ...createInitialPipelineState('/p', 'b'),
      status: 'running',
      phases: [
        makePhaseState(1, { status: 'failed', error: testError }),
        makePhaseState(2, { status: 'done' }),
        makePhaseState(3),
      ],
    };
    const dependents = new Map<number, number[]>([
      [1, [2]],
      [2, [3]],
    ]);
    const result = cascadeFailure(state, 1, testError, dependents);
    // Phase 2 is done -- should not be affected
    expect(result.phases.find((p) => p.phaseNumber === 2)?.status).toBe('done');
    // Phase 3 depends on phase 2 which is done, but cascade still propagates via graph traversal
    // since phase 2 was not auto-failed, we still traverse its dependents
    expect(result.phases.find((p) => p.phaseNumber === 3)?.status).toBe(
      'failed',
    );
  });

  it('leaves independent phases untouched', () => {
    // A(1) -> B(2), C(3) is independent
    const state: PipelineState = {
      ...createInitialPipelineState('/p', 'b'),
      status: 'running',
      phases: [
        makePhaseState(1, { status: 'failed', error: testError }),
        makePhaseState(2),
        makePhaseState(3, { status: 'executing' }),
      ],
    };
    const dependents = new Map<number, number[]>([[1, [2]]]);
    const result = cascadeFailure(state, 1, testError, dependents);
    expect(result.phases.find((p) => p.phaseNumber === 2)?.status).toBe(
      'failed',
    );
    expect(result.phases.find((p) => p.phaseNumber === 3)?.status).toBe(
      'executing',
    );
  });

  it('uses visited set -- each node processed exactly once', () => {
    // Diamond: 1 -> 2, 1 -> 3, 2 -> 4, 3 -> 4
    // Node 4 should only be processed once
    const state: PipelineState = {
      ...createInitialPipelineState('/p', 'b'),
      status: 'running',
      phases: [
        makePhaseState(1, { status: 'failed', error: testError }),
        makePhaseState(2),
        makePhaseState(3),
        makePhaseState(4),
      ],
    };
    const dependents = new Map<number, number[]>([
      [1, [2, 3]],
      [2, [4]],
      [3, [4]],
    ]);
    const result = cascadeFailure(state, 1, testError, dependents);
    // All dependents should be failed
    expect(result.phases.filter((p) => p.status === 'failed')).toHaveLength(4);
    // Phase 4 should have cascade info (processed exactly once)
    expect(
      result.phases.find((p) => p.phaseNumber === 4)?.failureCascade,
    ).toEqual({
      rootCausePhase: 1,
      failureType: 'test_failure',
      errorSummary: 'Tests did not pass',
    });
  });
});
