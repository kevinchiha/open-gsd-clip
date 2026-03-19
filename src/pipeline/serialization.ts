import { z } from 'zod';
import type { Result } from '../shared/types.js';
import type { PipelineState } from './types.js';

// ── Zod schemas mirroring types.ts ───────────────────────────────────

/**
 * Step timing metadata for a single sub-state.
 */
const StepTimingSchema = z.object({
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
});

/**
 * Error classification for phase failures.
 */
const PhaseErrorSchema = z.object({
  type: z.enum([
    'transient',
    'context_overflow',
    'test_failure',
    'merge_conflict',
    'fatal',
  ]),
  message: z.string(),
  retryCount: z.number().int().min(0),
  lastAttemptAt: z.string().nullable(),
});

/**
 * Cascade info for auto-failed dependent phases.
 */
const FailureCascadeInfoSchema = z.object({
  rootCausePhase: z.number().int(),
  failureType: z.string(),
  errorSummary: z.string(),
});

/**
 * Per-phase state schema.
 */
export const PhaseStateSchema = z
  .object({
    phaseNumber: z.number().int(),
    status: z.enum([
      'pending',
      'discussing',
      'reviewing',
      'ui_designing',
      'planning',
      'executing',
      'ui_reviewing',
      'done',
      'failed',
    ]),
    stepTimings: z.record(z.string(), StepTimingSchema),
    activeAgentIssueId: z.string().nullable(),
    error: PhaseErrorSchema.nullable(),
    failureCascade: FailureCascadeInfoSchema.nullable(),
  })
  .strip();

/**
 * Execution plan schema (dependency resolver output).
 */
export const ExecutionPlanSchema = z
  .object({
    groups: z.array(z.array(z.number().int())),
    phaseOrder: z.array(z.number().int()),
  })
  .strip();

/**
 * Top-level pipeline state schema.
 * Uses .strip() to remove unknown fields on parse.
 */
export const PipelineStateSchema = z
  .object({
    status: z.enum([
      'idle',
      'initializing',
      'analyzing',
      'running',
      'paused',
      'completed',
      'failed',
    ]),
    phases: z.array(PhaseStateSchema),
    executionPlan: ExecutionPlanSchema.nullable(),
    startedAt: z.string().nullable(),
    completedAt: z.string().nullable(),
    lastTransitionAt: z.string().nullable(),
    projectPath: z.string(),
    brief: z.string(),
  })
  .strip();

// ── Serialize / Deserialize ──────────────────────────────────────────

/**
 * Serialize a PipelineState to a JSON string.
 * Explicit function for consistency -- callers always use
 * serialize/deserialize as a pair.
 */
export function serialize(state: PipelineState): string {
  return JSON.stringify(state);
}

/**
 * Deserialize a JSON string to a validated PipelineState.
 *
 * Returns Result<PipelineState, z.ZodError | Error>:
 * - ok=true with the validated state if valid
 * - ok=false with a ZodError for validation failures
 * - ok=false with a SyntaxError for malformed JSON
 */
export function deserialize(
  json: string,
): Result<PipelineState, z.ZodError | Error> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err : new Error('Failed to parse JSON'),
    };
  }

  const result = PipelineStateSchema.safeParse(parsed);
  if (result.success) {
    return { ok: true, value: result.data as PipelineState };
  }
  return { ok: false, error: result.error };
}
