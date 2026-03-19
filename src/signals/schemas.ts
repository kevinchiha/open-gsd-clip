import { z } from 'zod';
import { SIGNAL_TYPES } from './types.js';
import type { SignalType } from './types.js';

/**
 * Zod schema for PROJECT_READY signal.
 * Emitted when a project is initialized and ready for processing.
 */
const projectReadySchema = z
  .object({
    type: z.literal('PROJECT_READY'),
    phase: z.number(),
    artifacts: z.array(z.string()).optional(),
    summary: z.string().optional(),
  })
  .strip();

/**
 * Zod schema for DISCUSS_COMPLETE signal.
 * Emitted when a discussion phase finishes.
 */
const discussCompleteSchema = z
  .object({
    type: z.literal('DISCUSS_COMPLETE'),
    phase: z.number(),
    status: z.enum(['success', 'failure']),
    artifacts: z.array(z.string()).optional(),
    summary: z.string().optional(),
  })
  .strip();

/**
 * Zod schema for APPROVED signal.
 * Emitted when a phase or plan is approved to proceed.
 */
const approvedSchema = z
  .object({
    type: z.literal('APPROVED'),
    phase: z.number(),
    summary: z.string().optional(),
  })
  .strip();

/**
 * Zod schema for REVISION_NEEDED signal.
 * Emitted when changes are required before proceeding.
 */
const revisionNeededSchema = z
  .object({
    type: z.literal('REVISION_NEEDED'),
    phase: z.number(),
    feedback: z.string(),
    summary: z.string().optional(),
  })
  .strip();

/**
 * Zod schema for UI_DESIGN_COMPLETE signal.
 * Emitted when the designer finishes creating UI-SPEC.md for a phase.
 */
const uiDesignCompleteSchema = z
  .object({
    type: z.literal('UI_DESIGN_COMPLETE'),
    phase: z.number(),
    status: z.enum(['success', 'failure']),
    artifacts: z.array(z.string()).optional(),
    summary: z.string().optional(),
  })
  .strip();

/**
 * Zod schema for UI_REVIEW_COMPLETE signal.
 * Emitted when the designer finishes a visual audit of implemented code.
 */
const uiReviewCompleteSchema = z
  .object({
    type: z.literal('UI_REVIEW_COMPLETE'),
    phase: z.number(),
    status: z.enum(['success', 'failure']),
    artifacts: z.array(z.string()).optional(),
    summary: z.string().optional(),
  })
  .strip();

/**
 * Zod schema for PLAN_COMPLETE signal.
 * Emitted when planning finishes for a phase.
 */
const planCompleteSchema = z
  .object({
    type: z.literal('PLAN_COMPLETE'),
    phase: z.number(),
    status: z.enum(['success', 'failure']),
    artifacts: z.array(z.string()).optional(),
    summary: z.string().optional(),
  })
  .strip();

/**
 * Zod schema for EXECUTE_COMPLETE signal.
 * Emitted when execution finishes for a phase.
 */
const executeCompleteSchema = z
  .object({
    type: z.literal('EXECUTE_COMPLETE'),
    phase: z.number(),
    status: z.enum(['success', 'failure']),
    artifacts: z.array(z.string()).optional(),
    summary: z.string().optional(),
  })
  .strip();

/**
 * Zod schema for DECISION_NEEDED signal.
 * Emitted when a decision is required from a human or higher-level agent.
 */
const decisionNeededSchema = z
  .object({
    type: z.literal('DECISION_NEEDED'),
    phase: z.number(),
    context: z.string(),
    options: z.array(z.string()),
    summary: z.string().optional(),
  })
  .strip();

/**
 * Zod schema for DECISION_MADE signal.
 * Emitted when a decision has been recorded.
 */
const decisionMadeSchema = z
  .object({
    type: z.literal('DECISION_MADE'),
    phase: z.number(),
    decision: z.string(),
    reasoning: z.string(),
    summary: z.string().optional(),
  })
  .strip();

/**
 * Zod schema for AGENT_ERROR signal.
 * Emitted when an agent encounters an unrecoverable error.
 */
const agentErrorSchema = z
  .object({
    type: z.literal('AGENT_ERROR'),
    phase: z.number(),
    error: z.string(),
    command: z.string().optional(),
    summary: z.string().optional(),
  })
  .strip();

/**
 * Zod schema for STALE_HEARTBEAT signal.
 * Emitted when an agent has not reported activity within the expected interval.
 */
const staleHeartbeatSchema = z
  .object({
    type: z.literal('STALE_HEARTBEAT'),
    phase: z.number(),
    agent_id: z.string(),
    elapsed_ms: z.number(),
  })
  .strip();

/**
 * Record mapping each signal type string to its Zod schema.
 * Used by the parser to validate extracted signal data
 * against the correct type-specific schema.
 */
export const signalSchemas: Record<SignalType, z.ZodTypeAny> = {
  PROJECT_READY: projectReadySchema,
  DISCUSS_COMPLETE: discussCompleteSchema,
  APPROVED: approvedSchema,
  REVISION_NEEDED: revisionNeededSchema,
  UI_DESIGN_COMPLETE: uiDesignCompleteSchema,
  UI_REVIEW_COMPLETE: uiReviewCompleteSchema,
  PLAN_COMPLETE: planCompleteSchema,
  EXECUTE_COMPLETE: executeCompleteSchema,
  DECISION_NEEDED: decisionNeededSchema,
  DECISION_MADE: decisionMadeSchema,
  AGENT_ERROR: agentErrorSchema,
  STALE_HEARTBEAT: staleHeartbeatSchema,
};

/**
 * Discriminated union schema that validates any GSD signal.
 * Discriminates on the `type` field.
 */
export const gsdSignalSchema = z.discriminatedUnion('type', [
  projectReadySchema,
  discussCompleteSchema,
  approvedSchema,
  revisionNeededSchema,
  uiDesignCompleteSchema,
  uiReviewCompleteSchema,
  planCompleteSchema,
  executeCompleteSchema,
  decisionNeededSchema,
  decisionMadeSchema,
  agentErrorSchema,
  staleHeartbeatSchema,
]);

/**
 * TypeScript type inferred from the discriminated union schema.
 * This is the runtime-validated equivalent of the GsdSignal type.
 */
export type ValidatedGsdSignal = z.infer<typeof gsdSignalSchema>;

// Verify the SIGNAL_TYPES array covers all schemas at compile time.
// If a signal type is added to SIGNAL_TYPES but not to schemas, this will error.
const _exhaustiveCheck: Record<(typeof SIGNAL_TYPES)[number], z.ZodTypeAny> =
  signalSchemas;
void _exhaustiveCheck;
