/**
 * Zod schemas for gsd-tools.cjs JSON output validation.
 *
 * These schemas match the snake_case keys from the raw CLI output.
 * Transformation to camelCase domain types happens in bridge/index.ts.
 */
import { z } from 'zod';

export const RoadmapPhaseSchema = z.object({
  number: z.string(),
  name: z.string(),
  goal: z.string().nullable(),
  depends_on: z.string().nullable(),
  plan_count: z.number(),
  summary_count: z.number(),
  has_context: z.boolean(),
  has_research: z.boolean(),
  disk_status: z.string(),
  roadmap_complete: z.boolean(),
});

export const RoadmapAnalysisSchema = z.object({
  milestones: z.array(z.unknown()),
  phases: z.array(RoadmapPhaseSchema),
  phase_count: z.number(),
  completed_phases: z.number(),
  total_plans: z.number(),
  total_summaries: z.number(),
  progress_percent: z.number(),
  current_phase: z.string().nullable(),
  next_phase: z.string().nullable(),
  missing_phase_details: z.array(z.string()).nullable(),
});

export const PhaseDefinitionSchema = z.object({
  found: z.boolean(),
  phase_number: z.string(),
  phase_name: z.string(),
  goal: z.string().nullable(),
  success_criteria: z.array(z.string()),
  section: z.string(),
});

export const StateJsonSchema = z.object({
  gsd_state_version: z.string(),
  milestone: z.string(),
  milestone_name: z.string(),
  status: z.string(),
  stopped_at: z.string(),
  last_updated: z.string(),
  last_activity: z.string(),
  progress: z.object({
    total_phases: z.string(),
    completed_phases: z.string(),
    total_plans: z.string(),
    completed_plans: z.string(),
    percent: z.string(),
  }),
});

export const FindPhaseSchema = z.object({
  found: z.boolean(),
  directory: z.string().nullable(),
  phase_number: z.string().nullable(),
  phase_name: z.string().nullable(),
  plans: z.array(z.string()),
  summaries: z.array(z.string()),
});
