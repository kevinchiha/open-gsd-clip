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

/**
 * Builds a parallel execution plan from phase dependency declarations
 * using Kahn's algorithm with level extraction.
 *
 * Phases with no dependencies appear in the first execution group.
 * Each subsequent group contains phases whose dependencies are all
 * satisfied by earlier groups. Phases within a group can run in parallel.
 *
 * @param phases - Array of phase inputs with dependency declarations
 * @returns Result containing the execution plan or a resolver error
 */
export function buildExecutionPlan(
  phases: PhaseInput[],
): Result<ExecutionPlan, ResolverError> {
  // Handle empty input
  if (phases.length === 0) {
    return { ok: true, value: { groups: [], phaseOrder: [] } };
  }

  // 1. Normalize inputs: treat undefined/null dependsOn as empty array
  const normalized = phases.map((p) => ({
    phaseNumber: p.phaseNumber,
    dependsOn: Array.isArray(p.dependsOn) ? p.dependsOn : [],
  }));

  // 2. Build set of known phase numbers for validation
  const phaseNumbers = new Set(normalized.map((p) => p.phaseNumber));

  // 3. Validate all dependency references exist
  for (const phase of normalized) {
    for (const dep of phase.dependsOn) {
      if (!phaseNumbers.has(dep)) {
        return {
          ok: false,
          error: {
            type: 'missing_dependency',
            phase: phase.phaseNumber,
            missingDep: dep,
          },
        };
      }
    }
  }

  // 4. Build adjacency structures
  //    inDegree: how many dependencies each phase has
  //    dependents: phase -> phases that depend on it (forward adjacency)
  const inDegree = new Map<number, number>();
  const dependents = new Map<number, number[]>();

  for (const phase of normalized) {
    inDegree.set(phase.phaseNumber, phase.dependsOn.length);
    if (!dependents.has(phase.phaseNumber)) {
      dependents.set(phase.phaseNumber, []);
    }
    for (const dep of phase.dependsOn) {
      const list = dependents.get(dep) ?? [];
      list.push(phase.phaseNumber);
      dependents.set(dep, list);
    }
  }

  // 5. Initialize first level: all phases with in-degree 0
  let queue = normalized
    .filter((p) => (inDegree.get(p.phaseNumber) ?? 0) === 0)
    .map((p) => p.phaseNumber)
    .sort((a, b) => a - b); // Sort for deterministic output

  // 6. Level-by-level BFS (Kahn's with level extraction)
  const groups: number[][] = [];
  let processed = 0;

  while (queue.length > 0) {
    groups.push([...queue]); // Current level = parallel group
    const nextQueue: number[] = [];

    for (const phaseNum of queue) {
      processed++;
      for (const dependent of dependents.get(phaseNum) ?? []) {
        const newDegree = (inDegree.get(dependent) ?? 1) - 1;
        inDegree.set(dependent, newDegree);
        if (newDegree === 0) {
          nextQueue.push(dependent);
        }
      }
    }

    // Sort next queue for deterministic output
    queue = nextQueue.sort((a, b) => a - b);
  }

  // 7. Cycle detection: if not all phases processed, a cycle exists
  if (processed !== normalized.length) {
    const involvedPhases = normalized
      .filter((p) => (inDegree.get(p.phaseNumber) ?? 0) > 0)
      .map((p) => p.phaseNumber)
      .sort((a, b) => a - b);
    return {
      ok: false,
      error: { type: 'cyclic_dependency', involvedPhases },
    };
  }

  return {
    ok: true,
    value: {
      groups,
      phaseOrder: groups.flat(),
    },
  };
}
