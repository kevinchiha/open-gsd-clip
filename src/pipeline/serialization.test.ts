import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createInitialPipelineState, pipelineTransition } from './fsm.js';
import { createInitialPhaseState, phaseTransition } from './phase-machine.js';
import { deserialize, serialize } from './serialization.js';
import type {
  ExecutionPlan,
  FailureCascadeInfo,
  PhaseError,
  PhaseState,
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

function makeMinimalState(): PipelineState {
  return {
    status: 'idle',
    phases: [],
    executionPlan: null,
    startedAt: null,
    completedAt: null,
    lastTransitionAt: null,
    projectPath: '/tmp/project',
    brief: 'test brief',
  };
}

function makeComplexState(): PipelineState {
  const error: PhaseError = {
    type: 'test_failure',
    message: 'Tests did not pass',
    retryCount: 2,
    lastAttemptAt: '2026-01-15T10:30:00.000Z',
  };

  const cascade: FailureCascadeInfo = {
    rootCausePhase: 2,
    failureType: 'test_failure',
    errorSummary: 'Tests did not pass',
  };

  const plan: ExecutionPlan = {
    groups: [[1], [2, 3], [4]],
    phaseOrder: [1, 2, 3, 4],
  };

  return {
    status: 'running',
    phases: [
      makePhaseState(1, {
        status: 'done',
        stepTimings: {
          discussing: {
            startedAt: '2026-01-15T10:00:00.000Z',
            completedAt: '2026-01-15T10:05:00.000Z',
          },
          reviewing: {
            startedAt: '2026-01-15T10:05:00.000Z',
            completedAt: '2026-01-15T10:10:00.000Z',
          },
        },
      }),
      makePhaseState(2, {
        status: 'failed',
        error,
      }),
      makePhaseState(3, {
        status: 'executing',
        activeAgentIssueId: 'issue-42',
        stepTimings: {
          discussing: {
            startedAt: '2026-01-15T10:00:00.000Z',
            completedAt: '2026-01-15T10:02:00.000Z',
          },
        },
        failureCascade: cascade,
      }),
    ],
    executionPlan: plan,
    startedAt: '2026-01-15T09:00:00.000Z',
    completedAt: null,
    lastTransitionAt: '2026-01-15T10:30:00.000Z',
    projectPath: '/home/user/project',
    brief: 'Build a complex system',
  };
}

// ── Serialize ────────────────────────────────────────────────────────

describe('serialize', () => {
  it('produces a valid JSON string from PipelineState', () => {
    const state = makeMinimalState();
    const json = serialize(state);

    expect(typeof json).toBe('string');
    // Must be parseable JSON
    expect(() => JSON.parse(json)).not.toThrow();
    // Round-trip through JSON.parse should match original
    expect(JSON.parse(json)).toEqual(state);
  });

  it('handles complex state with all fields populated', () => {
    const state = makeComplexState();
    const json = serialize(state);

    expect(typeof json).toBe('string');
    const parsed = JSON.parse(json);
    expect(parsed.status).toBe('running');
    expect(parsed.phases).toHaveLength(3);
    expect(parsed.executionPlan).toEqual(state.executionPlan);
  });
});

// ── Deserialize valid ────────────────────────────────────────────────

describe('deserialize valid', () => {
  it('round-trips a minimal state (idle, empty phases)', () => {
    const state = makeMinimalState();
    const json = serialize(state);
    const result = deserialize(json);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(state);
    }
  });

  it('round-trips a complex state with phases, timings, errors, cascade, execution plan', () => {
    const state = makeComplexState();
    const json = serialize(state);
    const result = deserialize(json);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(state);
    }
  });

  it('preserves null fields (completedAt, error, failureCascade)', () => {
    const state = makeMinimalState();
    state.phases = [makePhaseState(1)];
    const json = serialize(state);
    const result = deserialize(json);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.completedAt).toBeNull();
      expect(result.value.lastTransitionAt).toBeNull();
      expect(result.value.phases[0]?.error).toBeNull();
      expect(result.value.phases[0]?.failureCascade).toBeNull();
      expect(result.value.phases[0]?.activeAgentIssueId).toBeNull();
    }
  });

  it('strips extra fields on deserialization', () => {
    const state = makeMinimalState();
    const json = serialize(state);
    const parsed = JSON.parse(json);
    parsed.extraField = 'should be stripped';
    const result = deserialize(JSON.stringify(parsed));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect('extraField' in result.value).toBe(false);
    }
  });

  it('accepts empty phases array (pipeline just started)', () => {
    const state = makeMinimalState();
    const json = serialize(state);
    const result = deserialize(json);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.phases).toEqual([]);
    }
  });
});

// ── Deserialize invalid ──────────────────────────────────────────────

describe('deserialize invalid', () => {
  it('returns error for malformed JSON string', () => {
    const result = deserialize('not valid json {{{');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(Error);
    }
  });

  it('returns ZodError for missing required field (no status)', () => {
    const state = makeMinimalState();
    const json = serialize(state);
    const parsed = JSON.parse(json);
    delete parsed.status;
    const result = deserialize(JSON.stringify(parsed));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(z.ZodError);
    }
  });

  it('returns ZodError for invalid status enum value', () => {
    const state = makeMinimalState();
    const json = serialize(state);
    const parsed = JSON.parse(json);
    parsed.status = 'bogus';
    const result = deserialize(JSON.stringify(parsed));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(z.ZodError);
    }
  });

  it('returns ZodError for invalid nested PhaseError.type enum', () => {
    const state = makeComplexState();
    const json = serialize(state);
    const parsed = JSON.parse(json);
    // Phase 2 has an error -- corrupt its type
    parsed.phases[1].error.type = 'unknown_type';
    const result = deserialize(JSON.stringify(parsed));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(z.ZodError);
    }
  });

  it('returns ZodError for missing required field in PhaseState', () => {
    const state = makeMinimalState();
    state.phases = [makePhaseState(1)];
    const json = serialize(state);
    const parsed = JSON.parse(json);
    delete parsed.phases[0].phaseNumber;
    const result = deserialize(JSON.stringify(parsed));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(z.ZodError);
    }
  });
});

// ── Full integration round-trip ──────────────────────────────────────

describe('full integration round-trip', () => {
  it('create initial state -> transitions -> serialize -> deserialize -> more transitions', () => {
    // 1. Create initial pipeline state
    const initial = createInitialPipelineState(
      '/test/project',
      'Integration brief',
    );
    expect(initial.status).toBe('idle');

    // 2. Apply pipeline transitions: idle -> initializing -> analyzing
    const started = pipelineTransition(initial, { type: 'START_PIPELINE' });
    expect(started.valid).toBe(true);

    const ready = pipelineTransition(started.state, {
      type: 'PROJECT_READY',
    });
    expect(ready.valid).toBe(true);
    expect(ready.state.status).toBe('analyzing');

    // 3. Add phases and transition pipeline to running
    const phase1 = createInitialPhaseState(1);
    const phase2 = createInitialPhaseState(2);

    const executionPlan: ExecutionPlan = {
      groups: [[1], [2]],
      phaseOrder: [1, 2],
    };

    const withPhases: PipelineState = {
      ...ready.state,
      phases: [phase1, phase2],
    };

    const running = pipelineTransition(withPhases, {
      type: 'ANALYSIS_COMPLETE',
      executionPlan,
    });
    expect(running.valid).toBe(true);
    expect(running.state.status).toBe('running');

    // 4. Apply phase transitions to phase 1
    const runningPhase0 = running.state.phases[0];
    expect(runningPhase0).toBeDefined();
    const p1Step1 = phaseTransition(runningPhase0 as PhaseState, {
      type: 'DEPENDENCIES_MET',
    });
    expect(p1Step1.valid).toBe(true);
    expect(p1Step1.state.status).toBe('discussing');

    // 5. Snapshot the state for serialization
    const runningPhase1 = running.state.phases[1];
    expect(runningPhase1).toBeDefined();
    const preSerializeState: PipelineState = {
      ...running.state,
      phases: [p1Step1.state, runningPhase1 as PhaseState],
    };

    // 6. Serialize
    const json = serialize(preSerializeState);
    expect(typeof json).toBe('string');

    // 7. Deserialize
    const deserialized = deserialize(json);
    expect(deserialized.ok).toBe(true);
    if (!deserialized.ok) return;

    // 8. Verify deserialized state matches
    expect(deserialized.value.status).toBe('running');
    expect(deserialized.value.phases).toHaveLength(2);
    expect(deserialized.value.phases[0]?.status).toBe('discussing');
    expect(deserialized.value.phases[1]?.status).toBe('pending');
    expect(deserialized.value.executionPlan).toEqual(executionPlan);
    expect(deserialized.value.projectPath).toBe('/test/project');
    expect(deserialized.value.brief).toBe('Integration brief');

    // 9. Apply more phase transitions on the deserialized state
    const deserializedPhase0 = deserialized.value.phases[0];
    expect(deserializedPhase0).toBeDefined();
    const p1Step2 = phaseTransition(deserializedPhase0 as PhaseState, {
      type: 'STEP_COMPLETED',
    });
    expect(p1Step2.valid).toBe(true);
    expect(p1Step2.state.status).toBe('reviewing');

    // 10. Verify step timings were preserved through serialization
    expect(deserialized.value.phases[0]?.stepTimings.discussing).toBeDefined();
    expect(
      deserialized.value.phases[0]?.stepTimings.discussing?.startedAt,
    ).toBeTruthy();
  });
});
