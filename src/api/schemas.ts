/**
 * Zod schemas for validating GSD API action requests.
 *
 * Used by the RPC handler to validate incoming gsd.start,
 * gsd.retry, gsd.override, and preference update requests.
 */

import { z } from 'zod';

/**
 * Schema for gsd.start requests.
 * Requires a non-empty project path and brief description.
 */
export const StartSchema = z.object({
  projectPath: z.string().min(1),
  brief: z.string().min(1),
});

/**
 * Schema for gsd.retry requests.
 * Requires a positive integer phase number; fromStep is optional.
 */
export const RetrySchema = z.object({
  phaseNumber: z.number().int().positive(),
  fromStep: z.string().optional(),
});

/**
 * Schema for gsd.override requests.
 * Requires a valid UUID escalation ID and a non-empty decision string.
 */
export const OverrideSchema = z.object({
  escalationId: z.string().uuid(),
  decision: z.string().min(1),
});

/**
 * Schema for notification preference updates.
 * Accepts one of the four valid preference modes.
 */
export const PreferenceSchema = z.object({
  preference: z.enum([
    'all',
    'failures_only',
    'completions_only',
    'escalations_only',
  ]),
});

/** Inferred type for gsd.start input. */
export type StartInput = z.infer<typeof StartSchema>;

/** Inferred type for gsd.retry input. */
export type RetryInput = z.infer<typeof RetrySchema>;

/** Inferred type for gsd.override input. */
export type OverrideInput = z.infer<typeof OverrideSchema>;

/** Inferred type for preference update input. */
export type PreferenceInput = z.infer<typeof PreferenceSchema>;
