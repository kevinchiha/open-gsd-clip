import { describe, expect, it } from 'vitest';
import {
  PHASE_TRANSITIONS,
  createInitialPhaseState,
  phaseTransition,
} from './phase-machine.js';
import type {
  ErrorType,
  FailureCascadeInfo,
  PhaseEvent,
  PhaseState,
  PhaseStatus,
} from './types.js';

// ── createInitialPhaseState ──────────────────────────────────────────

describe('createInitialPhaseState', () => {
  it('returns pending state with empty timings', () => {
    const state = createInitialPhaseState(1);
    expect(state.phaseNumber).toBe(1);
    expect(state.status).toBe('pending');
    expect(state.stepTimings).toEqual({});
    expect(state.activeAgentIssueId).toBeNull();
    expect(state.error).toBeNull();
    expect(state.failureCascade).toBeNull();
  });
});

// ── PHASE_TRANSITIONS table ──────────────────────────────────────────

describe('PHASE_TRANSITIONS', () => {
  it('exports the transition table for inspection', () => {
    expect(PHASE_TRANSITIONS).toBeDefined();
    expect(PHASE_TRANSITIONS.done).toEqual({});
    expect(PHASE_TRANSITIONS.failed).toEqual({ RETRY_PHASE: 'pending' });
  });
});

// ── Valid forward transitions with timing ────────────────────────────

describe('phaseTransition - valid forward transitions', () => {
  it('pending + DEPENDENCIES_MET -> discussing (sets discussing.startedAt)', () => {
    const state = createInitialPhaseState(1);
    const result = phaseTransition(state, { type: 'DEPENDENCIES_MET' });
    expect(result.valid).toBe(true);
    expect(result.state.status).toBe('discussing');
    expect(result.state.stepTimings.discussing?.startedAt).toBeTypeOf('string');
    expect(result.state.stepTimings.discussing?.completedAt).toBeNull();
  });

  it('discussing + STEP_COMPLETED -> reviewing (sets discussing.completedAt, reviewing.startedAt)', () => {
    const state: PhaseState = {
      ...createInitialPhaseState(1),
      status: 'discussing',
      stepTimings: {
        discussing: { startedAt: '2026-01-01T00:00:00.000Z', completedAt: null },
      },
    };
    const result = phaseTransition(state, { type: 'STEP_COMPLETED' });
    expect(result.valid).toBe(true);
    expect(result.state.status).toBe('reviewing');
    expect(result.state.stepTimings.discussing?.completedAt).toBeTypeOf('string');
    expect(result.state.stepTimings.reviewing?.startedAt).toBeTypeOf('string');
    expect(result.state.stepTimings.reviewing?.completedAt).toBeNull();
  });

  it('reviewing + APPROVED -> planning (sets reviewing.completedAt, planning.startedAt)', () => {
    const state: PhaseState = {
      ...createInitialPhaseState(1),
      status: 'reviewing',
      stepTimings: {
        discussing: { startedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T00:05:00.000Z' },
        reviewing: { startedAt: '2026-01-01T00:05:00.000Z', completedAt: null },
      },
    };
    const result = phaseTransition(state, { type: 'APPROVED' });
    expect(result.valid).toBe(true);
    expect(result.state.status).toBe('planning');
    expect(result.state.stepTimings.reviewing?.completedAt).toBeTypeOf('string');
    expect(result.state.stepTimings.planning?.startedAt).toBeTypeOf('string');
  });

  it('planning + STEP_COMPLETED -> executing', () => {
    const state: PhaseState = {
      ...createInitialPhaseState(1),
      status: 'planning',
      stepTimings: {
        planning: { startedAt: '2026-01-01T00:00:00.000Z', completedAt: null },
      },
    };
    const result = phaseTransition(state, { type: 'STEP_COMPLETED' });
    expect(result.valid).toBe(true);
    expect(result.state.status).toBe('executing');
    expect(result.state.stepTimings.planning?.completedAt).toBeTypeOf('string');
    expect(result.state.stepTimings.executing?.startedAt).toBeTypeOf('string');
  });

  it('executing + STEP_COMPLETED -> verifying', () => {
    const state: PhaseState = {
      ...createInitialPhaseState(1),
      status: 'executing',
      stepTimings: {
        executing: { startedAt: '2026-01-01T00:00:00.000Z', completedAt: null },
      },
    };
    const result = phaseTransition(state, { type: 'STEP_COMPLETED' });
    expect(result.valid).toBe(true);
    expect(result.state.status).toBe('verifying');
    expect(result.state.stepTimings.executing?.completedAt).toBeTypeOf('string');
    expect(result.state.stepTimings.verifying?.startedAt).toBeTypeOf('string');
  });

  it('verifying + STEP_COMPLETED -> done', () => {
    const state: PhaseState = {
      ...createInitialPhaseState(1),
      status: 'verifying',
      stepTimings: {
        verifying: { startedAt: '2026-01-01T00:00:00.000Z', completedAt: null },
      },
    };
    const result = phaseTransition(state, { type: 'STEP_COMPLETED' });
    expect(result.valid).toBe(true);
    expect(result.state.status).toBe('done');
    expect(result.state.stepTimings.verifying?.completedAt).toBeTypeOf('string');
  });
});

// ── Backward transitions (revision and retry loop) ───────────────────

describe('phaseTransition - backward transitions', () => {
  it('reviewing + REVISION_NEEDED -> discussing (resets discussing.startedAt, clears completedAt)', () => {
    const state: PhaseState = {
      ...createInitialPhaseState(1),
      status: 'reviewing',
      stepTimings: {
        discussing: { startedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T00:05:00.000Z' },
        reviewing: { startedAt: '2026-01-01T00:05:00.000Z', completedAt: null },
      },
    };
    const result = phaseTransition(state, { type: 'REVISION_NEEDED' });
    expect(result.valid).toBe(true);
    expect(result.state.status).toBe('discussing');
    // discussing timing is reset
    expect(result.state.stepTimings.discussing?.startedAt).toBeTypeOf('string');
    expect(result.state.stepTimings.discussing?.startedAt).not.toBe('2026-01-01T00:00:00.000Z');
    expect(result.state.stepTimings.discussing?.completedAt).toBeNull();
    // reviewing timing remains as historical data (completedAt set on leaving)
    expect(result.state.stepTimings.reviewing?.completedAt).toBeTypeOf('string');
  });

  it('verifying + STEP_FAILED -> executing (retry loop: resets executing timing)', () => {
    const state: PhaseState = {
      ...createInitialPhaseState(1),
      status: 'verifying',
      stepTimings: {
        executing: { startedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T00:10:00.000Z' },
        verifying: { startedAt: '2026-01-01T00:10:00.000Z', completedAt: null },
      },
    };
    const result = phaseTransition(state, {
      type: 'STEP_FAILED',
      errorType: 'test_failure',
      message: 'Tests did not pass',
    });
    expect(result.valid).toBe(true);
    expect(result.state.status).toBe('executing');
    // executing timing is reset
    expect(result.state.stepTimings.executing?.startedAt).toBeTypeOf('string');
    expect(result.state.stepTimings.executing?.startedAt).not.toBe('2026-01-01T00:00:00.000Z');
    expect(result.state.stepTimings.executing?.completedAt).toBeNull();
    // verifying timing remains as historical (completedAt set on leaving)
    expect(result.state.stepTimings.verifying?.completedAt).toBeTypeOf('string');
  });
});

// ── failed -> pending (RETRY_PHASE) ─────────────────────────────────

describe('phaseTransition - RETRY_PHASE', () => {
  it('failed + RETRY_PHASE -> pending (clears error, resets all timings)', () => {
    const state: PhaseState = {
      ...createInitialPhaseState(1),
      status: 'failed',
      stepTimings: {
        discussing: { startedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T00:05:00.000Z' },
        reviewing: { startedAt: '2026-01-01T00:05:00.000Z', completedAt: '2026-01-01T00:10:00.000Z' },
        planning: { startedAt: '2026-01-01T00:10:00.000Z', completedAt: null },
      },
      error: {
        type: 'test_failure',
        message: 'Tests failed',
        retryCount: 1,
        lastAttemptAt: '2026-01-01T00:10:00.000Z',
      },
      failureCascade: {
        rootCausePhase: 2,
        failureType: 'fatal',
        errorSummary: 'Upstream failure',
      },
    };
    const result = phaseTransition(state, { type: 'RETRY_PHASE' });
    expect(result.valid).toBe(true);
    expect(result.state.status).toBe('pending');
    expect(result.state.error).toBeNull();
    expect(result.state.failureCascade).toBeNull();
    expect(result.state.stepTimings).toEqual({});
  });
});

// ── Terminal state rejection ─────────────────────────────────────────

describe('phaseTransition - terminal states', () => {
  const nonRetryEvents: PhaseEvent[] = [
    { type: 'DEPENDENCIES_MET' },
    { type: 'STEP_COMPLETED' },
    { type: 'STEP_FAILED', errorType: 'transient', message: 'err' },
    { type: 'APPROVED' },
    { type: 'REVISION_NEEDED' },
    { type: 'AUTO_FAIL', cascade: { rootCausePhase: 1, failureType: 'fatal', errorSummary: 'boom' } },
  ];

  for (const event of nonRetryEvents) {
    it(`done rejects ${event.type}`, () => {
      const state: PhaseState = {
        ...createInitialPhaseState(1),
        status: 'done',
      };
      const result = phaseTransition(state, event);
      expect(result.valid).toBe(false);
      expect(result.description).toBeTypeOf('string');
    });
  }

  for (const event of nonRetryEvents) {
    it(`failed rejects ${event.type} (only RETRY_PHASE allowed)`, () => {
      const state: PhaseState = {
        ...createInitialPhaseState(1),
        status: 'failed',
        error: { type: 'fatal', message: 'boom', retryCount: 0, lastAttemptAt: null },
      };
      const result = phaseTransition(state, event);
      expect(result.valid).toBe(false);
      expect(result.description).toBeTypeOf('string');
    });
  }
});

// ── AUTO_FAIL ────────────────────────────────────────────────────────

describe('phaseTransition - AUTO_FAIL', () => {
  it('pending + AUTO_FAIL -> failed (with cascade info)', () => {
    const cascade: FailureCascadeInfo = {
      rootCausePhase: 2,
      failureType: 'fatal',
      errorSummary: 'Phase 2 crashed',
    };
    const state = createInitialPhaseState(3);
    const result = phaseTransition(state, { type: 'AUTO_FAIL', cascade });
    expect(result.valid).toBe(true);
    expect(result.state.status).toBe('failed');
    expect(result.state.failureCascade).toEqual(cascade);
  });
});

// ── SET_AGENT / CLEAR_AGENT ──────────────────────────────────────────

describe('phaseTransition - agent tracking', () => {
  it('SET_AGENT updates activeAgentIssueId without status change', () => {
    const state: PhaseState = {
      ...createInitialPhaseState(1),
      status: 'executing',
    };
    const result = phaseTransition(state, {
      type: 'SET_AGENT',
      agentIssueId: 'issue-42',
    });
    expect(result.valid).toBe(true);
    expect(result.state.status).toBe('executing');
    expect(result.state.activeAgentIssueId).toBe('issue-42');
  });

  it('CLEAR_AGENT clears activeAgentIssueId without status change', () => {
    const state: PhaseState = {
      ...createInitialPhaseState(1),
      status: 'executing',
      activeAgentIssueId: 'issue-42',
    };
    const result = phaseTransition(state, { type: 'CLEAR_AGENT' });
    expect(result.valid).toBe(true);
    expect(result.state.status).toBe('executing');
    expect(result.state.activeAgentIssueId).toBeNull();
  });

  it('SET_AGENT works in any non-terminal status', () => {
    const statuses: PhaseStatus[] = ['pending', 'discussing', 'reviewing', 'planning', 'executing', 'verifying'];
    for (const status of statuses) {
      const state: PhaseState = { ...createInitialPhaseState(1), status };
      const result = phaseTransition(state, {
        type: 'SET_AGENT',
        agentIssueId: 'agent-1',
      });
      expect(result.valid).toBe(true);
      expect(result.state.activeAgentIssueId).toBe('agent-1');
    }
  });

  it('SET_AGENT rejected in done state', () => {
    const state: PhaseState = { ...createInitialPhaseState(1), status: 'done' };
    const result = phaseTransition(state, {
      type: 'SET_AGENT',
      agentIssueId: 'agent-1',
    });
    expect(result.valid).toBe(false);
  });

  it('SET_AGENT rejected in failed state', () => {
    const state: PhaseState = {
      ...createInitialPhaseState(1),
      status: 'failed',
      error: { type: 'fatal', message: 'boom', retryCount: 0, lastAttemptAt: null },
    };
    const result = phaseTransition(state, {
      type: 'SET_AGENT',
      agentIssueId: 'agent-1',
    });
    expect(result.valid).toBe(false);
  });
});

// ── STEP_FAILED from each active state ───────────────────────────────

describe('phaseTransition - STEP_FAILED sets error', () => {
  const activeStates: PhaseStatus[] = ['discussing', 'planning', 'executing'];

  for (const status of activeStates) {
    it(`${status} + STEP_FAILED -> failed with error info`, () => {
      const state: PhaseState = {
        ...createInitialPhaseState(1),
        status,
        stepTimings: {
          [status]: { startedAt: '2026-01-01T00:00:00.000Z', completedAt: null },
        },
      };
      const errorType: ErrorType = 'context_overflow';
      const result = phaseTransition(state, {
        type: 'STEP_FAILED',
        errorType,
        message: 'Context window exceeded',
      });
      expect(result.valid).toBe(true);
      expect(result.state.status).toBe('failed');
      expect(result.state.error).toEqual({
        type: 'context_overflow',
        message: 'Context window exceeded',
        retryCount: 0,
        lastAttemptAt: expect.any(String),
      });
    });
  }

  it('verifying + STEP_FAILED -> executing (retry, not terminal failure)', () => {
    const state: PhaseState = {
      ...createInitialPhaseState(1),
      status: 'verifying',
      stepTimings: {
        verifying: { startedAt: '2026-01-01T00:00:00.000Z', completedAt: null },
      },
    };
    const result = phaseTransition(state, {
      type: 'STEP_FAILED',
      errorType: 'test_failure',
      message: 'Tests failed',
    });
    expect(result.valid).toBe(true);
    // verifying -> executing is a retry loop, NOT a terminal failure
    expect(result.state.status).toBe('executing');
  });
});
