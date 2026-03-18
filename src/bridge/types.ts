/**
 * Domain types for the GSD tools bridge.
 *
 * These types represent the camelCase domain objects returned by bridge methods.
 * The raw gsd-tools.cjs output uses snake_case -- transformation happens in
 * the bridge index module.
 */

export interface RoadmapPhase {
  number: string;
  name: string;
  goal: string | null;
  dependsOn: string | null;
  planCount: number;
  summaryCount: number;
  hasContext: boolean;
  hasResearch: boolean;
  diskStatus: string;
  roadmapComplete: boolean;
}

export interface RoadmapAnalysis {
  milestones: unknown[];
  phases: RoadmapPhase[];
  phaseCount: number;
  completedPhases: number;
  totalPlans: number;
  totalSummaries: number;
  progressPercent: number;
  currentPhase: string | null;
  nextPhase: string | null;
  missingPhaseDetails: string[] | null;
}

export interface PhaseDefinition {
  found: boolean;
  phaseNumber: string;
  phaseName: string;
  goal: string | null;
  successCriteria: string[];
  section: string;
}

export interface ProjectState {
  gsdStateVersion: string;
  milestone: string;
  milestoneName: string;
  status: string;
  stoppedAt: string;
  lastUpdated: string;
  lastActivity: string;
  progress: {
    totalPhases: string;
    completedPhases: string;
    totalPlans: string;
    completedPlans: string;
    percent: string;
  };
}

export interface PhasePath {
  found: boolean;
  directory: string;
  phaseNumber: string;
  phaseName: string;
  plans: string[];
  summaries: string[];
}

export interface BridgeOptions {
  /** Override gsd-tools.cjs path (skips auto-discovery) */
  toolsPath?: string;
  /** Command timeout in milliseconds (default: 30000) */
  timeout?: number;
}
