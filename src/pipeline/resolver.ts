import type { Result } from '../shared/types.js';

// Plan 01 (types.ts) has not run yet -- define types locally.
// Plan 03 will reconcile if needed.

export interface PhaseInput {
  phaseNumber: number;
  dependsOn: number[];
}

export interface ExecutionPlan {
  groups: number[][];
  phaseOrder: number[];
}

export type ResolverError =
  | { type: 'cyclic_dependency'; involvedPhases: number[] }
  | { type: 'missing_dependency'; phase: number; missingDep: number };

export function buildExecutionPlan(
  _phases: PhaseInput[],
): Result<ExecutionPlan, ResolverError> {
  throw new Error('Not implemented');
}
