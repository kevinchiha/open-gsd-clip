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
// Pipeline runner
export { PipelineRunner } from './pipeline-runner.js';
// Quality gate
export {
  buildCeoReviewContext,
  buildReviewIssueDescription,
  buildRevisionContext,
  buildRevisionIssueDescription,
} from './quality-gate.js';
// Types
export type {
  AuditEntry,
  ClassifiedError,
  HealthConfig,
  OrchestratorConfig,
  RetryConfig,
} from './types.js';
export {
  DEFAULT_CONFIG,
  DEFAULT_HEALTH_CONFIG,
  DEFAULT_RETRY_CONFIG,
} from './types.js';
