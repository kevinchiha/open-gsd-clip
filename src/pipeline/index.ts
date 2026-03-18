// ── Pipeline FSM ─────────────────────────────────────────────────────
export {
  cascadeFailure,
  createInitialPipelineState,
  pipelineTransition,
} from './fsm.js';

// ── Phase sub-state machine ──────────────────────────────────────────
export {
  createInitialPhaseState,
  PHASE_TRANSITIONS,
  phaseTransition,
} from './phase-machine.js';

export type { ResolverError } from './resolver.js';

// ── Dependency resolver ──────────────────────────────────────────────
export { buildExecutionPlan } from './resolver.js';

// ── Serialization ────────────────────────────────────────────────────
export {
  deserialize,
  ExecutionPlanSchema,
  PhaseStateSchema,
  PipelineStateSchema,
  serialize,
} from './serialization.js';

// ── Types ────────────────────────────────────────────────────────────
export type {
  ErrorType,
  ExecutionPlan,
  FailureCascadeInfo,
  PhaseError,
  PhaseEvent,
  PhaseEventType,
  PhaseInput,
  PhaseState,
  PhaseStatus,
  PipelineEvent,
  PipelineState,
  PipelineStatus,
  StepTiming,
  TransitionResult,
} from './types.js';
