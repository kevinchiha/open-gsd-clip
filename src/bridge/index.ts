/**
 * GSD Tools Bridge - Public API
 *
 * Typed wrappers around gsd-tools.cjs CLI commands with:
 * - Auto-discovery of gsd-tools.cjs path
 * - Zod schema validation of CLI output
 * - Snake_case to camelCase transformation
 * - Classified error handling
 */

import { createChildLogger } from '../shared/logger.js';
import { discoverGsdToolsPath } from './discovery.js';
import { GsdParseError } from './errors.js';
import { executeGsdCommand } from './executor.js';
import {
  FindPhaseSchema,
  PhaseDefinitionSchema,
  RoadmapAnalysisSchema,
  StateJsonSchema,
} from './schemas.js';
import type {
  BridgeOptions,
  PhaseDefinition,
  PhasePath,
  ProjectState,
  RoadmapAnalysis,
  RoadmapPhase,
} from './types.js';

const log = createChildLogger('bridge');

/**
 * The GSD Bridge interface -- four methods for querying gsd-tools.cjs.
 */
export interface GsdBridge {
  /** Analyze the roadmap and return phase data, counts, and progress. */
  analyzeRoadmap(cwd: string): Promise<RoadmapAnalysis>;
  /** Get a specific phase definition by number. */
  getPhase(cwd: string, phaseNumber: number | string): Promise<PhaseDefinition>;
  /** Get the current project state from STATE.md. */
  getState(cwd: string): Promise<ProjectState>;
  /** Find a phase directory and its plans/summaries. */
  findPhase(cwd: string, phaseNumber: number | string): Promise<PhasePath>;
}

/**
 * Create a GSD Bridge instance.
 *
 * @param options - Optional configuration (toolsPath override, timeout)
 * @returns GsdBridge instance
 */
export function createBridge(options?: BridgeOptions): GsdBridge {
  const toolsPath = options?.toolsPath ?? discoverGsdToolsPath();
  const timeout = options?.timeout ?? 30_000;

  log.debug({ toolsPath, timeout }, 'Bridge created');

  return {
    async analyzeRoadmap(cwd: string): Promise<RoadmapAnalysis> {
      const raw = await executeGsdCommand(toolsPath, 'roadmap', ['analyze'], cwd, timeout);
      const parsed = validateSchema(RoadmapAnalysisSchema, raw, 'roadmap analyze');
      return transformRoadmapAnalysis(parsed);
    },

    async getPhase(cwd: string, phaseNumber: number | string): Promise<PhaseDefinition> {
      const raw = await executeGsdCommand(
        toolsPath,
        'roadmap',
        ['get-phase', String(phaseNumber)],
        cwd,
        timeout,
      );
      const parsed = validateSchema(PhaseDefinitionSchema, raw, 'roadmap get-phase');
      return transformPhaseDefinition(parsed);
    },

    async getState(cwd: string): Promise<ProjectState> {
      const raw = await executeGsdCommand(toolsPath, 'state', ['json'], cwd, timeout);
      const parsed = validateSchema(StateJsonSchema, raw, 'state json');
      return transformProjectState(parsed);
    },

    async findPhase(cwd: string, phaseNumber: number | string): Promise<PhasePath> {
      const raw = await executeGsdCommand(
        toolsPath,
        'find-phase',
        [String(phaseNumber)],
        cwd,
        timeout,
      );
      const parsed = validateSchema(FindPhaseSchema, raw, 'find-phase');
      return transformPhasePath(parsed);
    },
  };
}

// ---- Schema validation ----

import type { z } from 'zod';

function validateSchema<T>(schema: z.ZodType<T>, data: unknown, command: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const rawOutput = JSON.stringify(data);
    throw new GsdParseError(
      command,
      rawOutput,
      `Schema validation failed for '${command}': ${result.error.message}`,
    );
  }
  return result.data;
}

// ---- Snake_case to camelCase transformations ----

function transformRoadmapPhase(raw: z.infer<typeof import('./schemas.js').RoadmapPhaseSchema>): RoadmapPhase {
  return {
    number: raw.number,
    name: raw.name,
    goal: raw.goal,
    dependsOn: raw.depends_on,
    planCount: raw.plan_count,
    summaryCount: raw.summary_count,
    hasContext: raw.has_context,
    hasResearch: raw.has_research,
    diskStatus: raw.disk_status,
    roadmapComplete: raw.roadmap_complete,
  };
}

function transformRoadmapAnalysis(raw: z.infer<typeof RoadmapAnalysisSchema>): RoadmapAnalysis {
  return {
    milestones: raw.milestones,
    phases: raw.phases.map(transformRoadmapPhase),
    phaseCount: raw.phase_count,
    completedPhases: raw.completed_phases,
    totalPlans: raw.total_plans,
    totalSummaries: raw.total_summaries,
    progressPercent: raw.progress_percent,
    currentPhase: raw.current_phase,
    nextPhase: raw.next_phase,
    missingPhaseDetails: raw.missing_phase_details,
  };
}

function transformPhaseDefinition(raw: z.infer<typeof PhaseDefinitionSchema>): PhaseDefinition {
  return {
    found: raw.found,
    phaseNumber: raw.phase_number,
    phaseName: raw.phase_name,
    goal: raw.goal,
    successCriteria: raw.success_criteria,
    section: raw.section,
  };
}

function transformProjectState(raw: z.infer<typeof StateJsonSchema>): ProjectState {
  return {
    gsdStateVersion: raw.gsd_state_version,
    milestone: raw.milestone,
    milestoneName: raw.milestone_name,
    status: raw.status,
    stoppedAt: raw.stopped_at,
    lastUpdated: raw.last_updated,
    lastActivity: raw.last_activity,
    progress: {
      totalPhases: raw.progress.total_phases,
      completedPhases: raw.progress.completed_phases,
      totalPlans: raw.progress.total_plans,
      completedPlans: raw.progress.completed_plans,
      percent: raw.progress.percent,
    },
  };
}

function transformPhasePath(raw: z.infer<typeof FindPhaseSchema>): PhasePath {
  return {
    found: raw.found,
    directory: raw.directory,
    phaseNumber: raw.phase_number,
    phaseName: raw.phase_name,
    plans: raw.plans,
    summaries: raw.summaries,
  };
}

// ---- Re-exports ----

export type {
  BridgeOptions,
  PhaseDefinition,
  PhasePath,
  ProjectState,
  RoadmapAnalysis,
  RoadmapPhase,
} from './types.js';

export {
  GsdBridgeError,
  GsdToolsNotFoundError,
  GsdParseError,
  GsdTimeoutError,
} from './errors.js';

export { discoverGsdToolsPath } from './discovery.js';
export { executeGsdCommand } from './executor.js';
