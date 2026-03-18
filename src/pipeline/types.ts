// ── Pipeline-level types ──────────────────────────────────────────────

/**
 * Pipeline-level status values.
 * idle -> initializing -> analyzing -> running -> completed/failed
 * running can also transition to paused and back.
 */
export type PipelineStatus =
  | 'idle'
  | 'initializing'
  | 'analyzing'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed';

/**
 * Discriminated union of all pipeline-level events.
 */
export type PipelineEvent =
  | { type: 'START_PIPELINE' }
  | { type: 'PROJECT_READY' }
  | { type: 'ANALYSIS_COMPLETE'; executionPlan: ExecutionPlan }
  | { type: 'PHASE_COMPLETED'; phaseNumber: number }
  | { type: 'PHASE_FAILED'; phaseNumber: number; error: PhaseError }
  | { type: 'ALL_PHASES_DONE' }
  | { type: 'PAUSE_REQUESTED' }
  | { type: 'RESUME_REQUESTED' }
  | { type: 'UNRECOVERABLE_ERROR'; error: string };

/**
 * Pipeline-level state.
 * phases is a flat array -- find by phaseNumber for lookups.
 * All timestamps are ISO 8601 strings or null.
 */
export interface PipelineState {
  status: PipelineStatus;
  phases: PhaseState[];
  executionPlan: ExecutionPlan | null;
  startedAt: string | null;
  completedAt: string | null;
  lastTransitionAt: string | null;
  projectPath: string;
  brief: string;
}

/**
 * Generic transition result.
 * valid=false means the transition was rejected (state unchanged).
 * description provides a human-readable reason for invalid transitions.
 */
export interface TransitionResult<S> {
  state: S;
  valid: boolean;
  description?: string;
}

// ── Phase-level types ────────────────────────────────────────────────

/**
 * Per-phase status values following the GSD pipeline workflow:
 * pending -> discussing -> reviewing -> planning -> executing -> verifying -> done
 * Any active step can fail. Failed phases can retry (back to pending).
 */
export type PhaseStatus =
  | 'pending'
  | 'discussing'
  | 'reviewing'
  | 'planning'
  | 'executing'
  | 'verifying'
  | 'done'
  | 'failed';

/**
 * Discriminated union of all phase-level events.
 */
export type PhaseEvent =
  | { type: 'DEPENDENCIES_MET' }
  | { type: 'STEP_COMPLETED' }
  | { type: 'STEP_FAILED'; errorType: ErrorType; message: string }
  | { type: 'APPROVED' }
  | { type: 'REVISION_NEEDED' }
  | { type: 'RETRY_PHASE' }
  | { type: 'AUTO_FAIL'; cascade: FailureCascadeInfo }
  | { type: 'SET_AGENT'; agentIssueId: string }
  | { type: 'CLEAR_AGENT' };

/**
 * Extract the type discriminant from PhaseEvent for transition table keys.
 */
export type PhaseEventType = PhaseEvent['type'];

/**
 * Per-phase state.
 * stepTimings tracks start/complete timestamps for each sub-state.
 * Keys are PhaseStatus values (e.g., 'discussing', 'planning').
 */
export interface PhaseState {
  phaseNumber: number;
  status: PhaseStatus;
  stepTimings: Record<string, StepTiming>;
  activeAgentIssueId: string | null;
  error: PhaseError | null;
  failureCascade: FailureCascadeInfo | null;
}

// ── Error types ──────────────────────────────────────────────────────

/**
 * Error classification for phase failures.
 */
export type ErrorType =
  | 'transient'
  | 'context_overflow'
  | 'test_failure'
  | 'merge_conflict'
  | 'fatal';

/**
 * Inline error context on phase failure.
 */
export interface PhaseError {
  type: ErrorType;
  message: string;
  retryCount: number;
  lastAttemptAt: string | null;
}

/**
 * Information stored on phases that were auto-failed
 * due to a dependency's failure.
 */
export interface FailureCascadeInfo {
  rootCausePhase: number;
  failureType: string;
  errorSummary: string;
}

/**
 * Timing metadata for a single sub-state step.
 */
export interface StepTiming {
  startedAt: string | null;
  completedAt: string | null;
}

// ── Resolver input types (used by Plan 02) ───────────────────────────

/**
 * Input for the dependency resolver.
 * Each phase declares its number and what phases it depends on.
 */
export interface PhaseInput {
  phaseNumber: number;
  dependsOn: number[];
}

/**
 * Output of the dependency resolver.
 * groups: parallel execution groups, ordered by level.
 * phaseOrder: flattened topological order.
 */
export interface ExecutionPlan {
  groups: number[][];
  phaseOrder: number[];
}
