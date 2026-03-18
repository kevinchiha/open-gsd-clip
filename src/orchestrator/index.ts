/**
 * Barrel export for the orchestrator module.
 *
 * Provides the PipelineRunner (main orchestration loop), error handling,
 * audit logging, health monitoring, event queue, and quality gate
 * utilities for the GSD pipeline.
 */

// Audit log
export { AuditLog } from './audit-log.js';
// Error handling
export {
  calculateBackoffDelay,
  classifyError,
  retryWithBackoff,
} from './error-handler.js';
// Event queue
export { SerialEventQueue } from './event-queue.js';
// Health monitoring
export { HealthMonitor } from './health-monitor.js';
// Merge queue
export { MergeQueue } from './merge-queue.js';
// Pipeline runner
export { PipelineRunner } from './pipeline-runner.js';
// Quality gate
export {
  buildCeoReviewContext,
  buildReviewIssueDescription,
  buildRevisionContext,
  buildRevisionIssueDescription,
} from './quality-gate.js';
// Token tracker
export { TokenTracker } from './token-tracker.js';
export type { PhaseTokenUsage, TokenUsage } from './token-tracker.js';
// Types
export type {
  AuditEntry,
  ClassifiedError,
  EscalationRecord,
  HealthConfig,
  OrchestratorConfig,
  RetryConfig,
} from './types.js';
export {
  DEFAULT_CONFIG,
  DEFAULT_HEALTH_CONFIG,
  DEFAULT_RETRY_CONFIG,
} from './types.js';
// Worktree manager
export type { WorktreeInfo } from './worktree-manager.js';
export { WorktreeManager } from './worktree-manager.js';
