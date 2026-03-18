/**
 * All 12 GSD signal types used for inter-agent communication.
 * Each signal is sent as a YAML block in Paperclip issue comments.
 */
export const SIGNAL_TYPES = [
  'PROJECT_READY',
  'DISCUSS_COMPLETE',
  'APPROVED',
  'REVISION_NEEDED',
  'PLAN_COMPLETE',
  'EXECUTE_COMPLETE',
  'VERIFY_COMPLETE',
  'VERIFY_FAILED',
  'DECISION_NEEDED',
  'DECISION_MADE',
  'AGENT_ERROR',
  'STALE_HEARTBEAT',
] as const;

/**
 * Union type of all valid signal type strings.
 */
export type SignalType = (typeof SIGNAL_TYPES)[number];

/**
 * Base shape shared by all signals.
 */
export interface BaseSignal {
  type: SignalType;
  phase: number;
}

// Individual signal interfaces for documentation.
// Runtime types are inferred from Zod schemas in schemas.ts.

export interface ProjectReadySignal extends BaseSignal {
  type: 'PROJECT_READY';
  artifacts?: string[];
  summary?: string;
}

export interface DiscussCompleteSignal extends BaseSignal {
  type: 'DISCUSS_COMPLETE';
  status: 'success' | 'failure';
  artifacts?: string[];
  summary?: string;
}

export interface ApprovedSignal extends BaseSignal {
  type: 'APPROVED';
  summary?: string;
}

export interface RevisionNeededSignal extends BaseSignal {
  type: 'REVISION_NEEDED';
  feedback: string;
  summary?: string;
}

export interface PlanCompleteSignal extends BaseSignal {
  type: 'PLAN_COMPLETE';
  status: 'success' | 'failure';
  artifacts?: string[];
  summary?: string;
}

export interface ExecuteCompleteSignal extends BaseSignal {
  type: 'EXECUTE_COMPLETE';
  status: 'success' | 'failure';
  artifacts?: string[];
  summary?: string;
}

export interface VerifyCompleteSignal extends BaseSignal {
  type: 'VERIFY_COMPLETE';
  artifacts?: string[];
  summary?: string;
}

export interface VerifyFailedSignal extends BaseSignal {
  type: 'VERIFY_FAILED';
  issues: string[];
  summary?: string;
}

export interface DecisionNeededSignal extends BaseSignal {
  type: 'DECISION_NEEDED';
  context: string;
  options: string[];
  summary?: string;
}

export interface DecisionMadeSignal extends BaseSignal {
  type: 'DECISION_MADE';
  decision: string;
  reasoning: string;
  summary?: string;
}

export interface AgentErrorSignal extends BaseSignal {
  type: 'AGENT_ERROR';
  error: string;
  command?: string;
  summary?: string;
}

export interface StaleHeartbeatSignal extends BaseSignal {
  type: 'STALE_HEARTBEAT';
  agent_id: string;
  elapsed_ms: number;
}

/**
 * Discriminated union of all signal types.
 * Runtime validation is done via Zod schemas -- this type
 * is provided for TypeScript-level type narrowing.
 */
export type GsdSignal =
  | ProjectReadySignal
  | DiscussCompleteSignal
  | ApprovedSignal
  | RevisionNeededSignal
  | PlanCompleteSignal
  | ExecuteCompleteSignal
  | VerifyCompleteSignal
  | VerifyFailedSignal
  | DecisionNeededSignal
  | DecisionMadeSignal
  | AgentErrorSignal
  | StaleHeartbeatSignal;
