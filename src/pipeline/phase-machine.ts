import type {
  PhaseEvent,
  PhaseEventType,
  PhaseState,
  PhaseStatus,
  StepTiming,
  TransitionResult,
} from './types.js';

// ── Transition table ─────────────────────────────────────────────────

/**
 * Data-driven transition table for per-phase sub-state machine.
 * Maps current status + event type -> next status.
 * Empty object = terminal state (no valid transitions except special handling).
 */
export const PHASE_TRANSITIONS: Record<
  PhaseStatus,
  Partial<Record<PhaseEventType, PhaseStatus>>
> = {
  pending: { DEPENDENCIES_MET: 'discussing', AUTO_FAIL: 'failed' },
  discussing: { STEP_COMPLETED: 'reviewing', STEP_FAILED: 'failed' },
  reviewing: { APPROVED: 'planning', REVISION_NEEDED: 'discussing' },
  planning: { STEP_COMPLETED: 'executing', STEP_FAILED: 'failed' },
  executing: { STEP_COMPLETED: 'verifying', STEP_FAILED: 'failed' },
  verifying: { STEP_COMPLETED: 'done', STEP_FAILED: 'executing' },
  done: {},
  failed: { RETRY_PHASE: 'pending' },
};

// ── Factory ──────────────────────────────────────────────────────────

/**
 * Create the initial phase state.
 * Starts in 'pending' with empty step timings and null metadata.
 */
export function createInitialPhaseState(phaseNumber: number): PhaseState {
  return {
    phaseNumber,
    status: 'pending',
    stepTimings: {},
    activeAgentIssueId: null,
    error: null,
    failureCascade: null,
  };
}

// ── Transition function ──────────────────────────────────────────────

/**
 * Pure per-phase sub-state machine transition function.
 *
 * Looks up the transition in the table, applies timing updates,
 * handles error context on STEP_FAILED, and clears state on RETRY_PHASE.
 *
 * SET_AGENT and CLEAR_AGENT are metadata-only updates that do not
 * change the phase status.
 */
export function phaseTransition(
  state: PhaseState,
  event: PhaseEvent,
): TransitionResult<PhaseState> {
  const now = new Date().toISOString();

  // Handle metadata-only events (no status change)
  if (event.type === 'SET_AGENT' || event.type === 'CLEAR_AGENT') {
    return handleAgentEvent(state, event);
  }

  // Look up transition in table
  const table = PHASE_TRANSITIONS[state.status];
  const nextStatus = table[event.type];

  if (nextStatus === undefined) {
    return {
      state,
      valid: false,
      description: `Invalid transition: '${state.status}' does not accept '${event.type}'`,
    };
  }

  // Build the new state based on the transition type
  let newState: PhaseState;

  if (event.type === 'RETRY_PHASE') {
    // Special case: reset everything on retry
    newState = {
      ...state,
      status: nextStatus,
      stepTimings: {},
      error: null,
      failureCascade: null,
    };
  } else if (event.type === 'AUTO_FAIL') {
    // Special case: set cascade info
    newState = {
      ...state,
      status: nextStatus,
      failureCascade: event.cascade,
    };
  } else if (event.type === 'STEP_FAILED') {
    // Handle STEP_FAILED with error context
    const timings = updateTimingsOnLeave(state.stepTimings, state.status, now);
    const targetTimings = isBackwardTransition(state.status, nextStatus)
      ? resetTargetTiming(timings, nextStatus, now)
      : timings;

    newState = {
      ...state,
      status: nextStatus,
      stepTimings: targetTimings,
      error:
        nextStatus === 'failed'
          ? {
              type: event.errorType,
              message: event.message,
              retryCount: 0,
              lastAttemptAt: now,
            }
          : state.error,
    };
  } else {
    // Standard forward or backward transition
    const timings = updateTimingsOnLeave(state.stepTimings, state.status, now);
    const targetTimings = isBackwardTransition(state.status, nextStatus)
      ? resetTargetTiming(timings, nextStatus, now)
      : updateTimingsOnEnter(timings, nextStatus, now);

    newState = {
      ...state,
      status: nextStatus,
      stepTimings: targetTimings,
    };
  }

  return { state: newState, valid: true };
}

// ── Agent event handling ─────────────────────────────────────────────

function handleAgentEvent(
  state: PhaseState,
  event: PhaseEvent,
): TransitionResult<PhaseState> {
  // Reject agent events in terminal states
  if (state.status === 'done' || state.status === 'failed') {
    return {
      state,
      valid: false,
      description: `Cannot update agent in terminal state '${state.status}'`,
    };
  }

  if (event.type === 'SET_AGENT') {
    return {
      state: { ...state, activeAgentIssueId: event.agentIssueId },
      valid: true,
    };
  }

  // CLEAR_AGENT
  return {
    state: { ...state, activeAgentIssueId: null },
    valid: true,
  };
}

// ── Timing helpers ───────────────────────────────────────────────────

/**
 * The ordered list of phase statuses that have timing data.
 * Used to determine forward vs backward transitions.
 */
const STATUS_ORDER: PhaseStatus[] = [
  'pending',
  'discussing',
  'reviewing',
  'planning',
  'executing',
  'verifying',
  'done',
  'failed',
];

function isBackwardTransition(from: PhaseStatus, to: PhaseStatus): boolean {
  return STATUS_ORDER.indexOf(to) < STATUS_ORDER.indexOf(from);
}

/**
 * Set completedAt on the current step when leaving it.
 * Only applies to steps that have timing data (not pending or done/failed).
 */
function updateTimingsOnLeave(
  timings: Record<string, StepTiming>,
  leavingStatus: PhaseStatus,
  now: string,
): Record<string, StepTiming> {
  if (
    leavingStatus === 'pending' ||
    leavingStatus === 'done' ||
    leavingStatus === 'failed'
  ) {
    return { ...timings };
  }
  const existing = timings[leavingStatus] ?? {
    startedAt: null,
    completedAt: null,
  };
  return {
    ...timings,
    [leavingStatus]: { ...existing, completedAt: now },
  };
}

/**
 * Set startedAt on the new step when entering it (forward transition).
 */
function updateTimingsOnEnter(
  timings: Record<string, StepTiming>,
  enteringStatus: PhaseStatus,
  now: string,
): Record<string, StepTiming> {
  if (
    enteringStatus === 'pending' ||
    enteringStatus === 'done' ||
    enteringStatus === 'failed'
  ) {
    return { ...timings };
  }
  return {
    ...timings,
    [enteringStatus]: { startedAt: now, completedAt: null },
  };
}

/**
 * Reset target step timing for backward transitions.
 * Sets startedAt to now, clears completedAt.
 */
function resetTargetTiming(
  timings: Record<string, StepTiming>,
  targetStatus: PhaseStatus,
  now: string,
): Record<string, StepTiming> {
  return {
    ...timings,
    [targetStatus]: { startedAt: now, completedAt: null },
  };
}
