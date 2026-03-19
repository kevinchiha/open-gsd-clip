import type { ErrorType, PhaseStatus } from '../pipeline/types.js';

// ── Retry Configuration ─────────────────────────────────────────────

/**
 * Configuration for exponential backoff retry behavior.
 */
export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 60_000,
};

// ── Health Monitoring Configuration ─────────────────────────────────

/**
 * Configuration for agent health monitoring.
 * staleThresholdMs: How long before an agent is considered stale.
 * hardTimeoutMs: Absolute maximum time for an agent run.
 * checkIntervalMs: How often to poll for health status.
 */
export interface HealthConfig {
  staleThresholdMs: number;
  hardTimeoutMs: number;
  checkIntervalMs: number;
}

export const DEFAULT_HEALTH_CONFIG: HealthConfig = {
  staleThresholdMs: 600_000, // 10 minutes
  hardTimeoutMs: 1_800_000, // 30 minutes
  checkIntervalMs: 60_000, // 1 minute
};

// ── Classified Error ────────────────────────────────────────────────

/**
 * Result of classifying an error message.
 * type: The ErrorType category from the pipeline module.
 * retryable: Whether the error can be retried.
 * maxRetries: Maximum number of retry attempts for this error type.
 * message: The original error message.
 */
export interface ClassifiedError {
  type: ErrorType;
  retryable: boolean;
  maxRetries: number;
  message: string;
}

// ── Audit Entry ─────────────────────────────────────────────────────

/**
 * Record of an orchestrator decision for the audit trail.
 */
export interface AuditEntry {
  id: string;
  timestamp: string;
  phase: number;
  decisionType:
    | 'quality_gate'
    | 'revision_request'
    | 'replan'
    | 'error_recovery';
  context: string;
  optionsConsidered: string[];
  choice: string;
  reasoning: string;
  agentIssueId?: string;
}

// ── Orchestrator Configuration ──────────────────────────────────────

/**
 * Top-level orchestrator configuration.
 * stepTimeouts: Per-PhaseStatus timeout overrides in milliseconds.
 */
export interface OrchestratorConfig {
  model: string;
  companyId: string;
  maxRevisions: number;
  retry: RetryConfig;
  health: HealthConfig;
  stepTimeouts: Partial<Record<PhaseStatus, number>>;
}

// ── Escalation Record ─────────────────────────────────────────────

/**
 * Record of a CEO-to-user escalation requiring human decision.
 * Created when the CEO agent cannot resolve a quality gate failure
 * within the allowed revision limit.
 */
export interface EscalationRecord {
  id: string;
  phaseNumber: number;
  context: string;
  options: string[];
  createdAt: string;
  resolvedAt: string | null;
  resolution: string | null;
}

export const DEFAULT_CONFIG: OrchestratorConfig = {
  model: 'claude-sonnet-4-6',
  companyId: '',
  maxRevisions: 3,
  retry: DEFAULT_RETRY_CONFIG,
  health: DEFAULT_HEALTH_CONFIG,
  stepTimeouts: {
    discussing: 15 * 60_000, // 15 minutes
    reviewing: 10 * 60_000, // 10 minutes
    planning: 20 * 60_000, // 20 minutes
    executing: 45 * 60_000, // 45 minutes
  },
};
