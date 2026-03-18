import type {
  PhaseError,
  PipelineEvent,
  PipelineState,
  TransitionResult,
} from './types.js';

// ── Factory ──────────────────────────────────────────────────────────

/**
 * Create the initial pipeline state.
 * Starts in 'idle' with empty phases, null timestamps,
 * and lastTransitionAt set to now.
 */
export function createInitialPipelineState(
  projectPath: string,
  brief: string,
): PipelineState {
  return {
    status: 'idle',
    phases: [],
    executionPlan: null,
    startedAt: null,
    completedAt: null,
    lastTransitionAt: new Date().toISOString(),
    projectPath,
    brief,
  };
}

// ── Pipeline FSM transition ──────────────────────────────────────────

/**
 * Pure pipeline-level FSM transition function.
 *
 * Given a current state and an event, returns a TransitionResult with:
 * - valid=true and the new state if the transition is valid
 * - valid=false and the unchanged state with a description if invalid
 *
 * No side effects. Consumers react to the returned state.
 */
export function pipelineTransition(
  state: PipelineState,
  event: PipelineEvent,
): TransitionResult<PipelineState> {
  const now = new Date().toISOString();

  switch (state.status) {
    case 'idle': {
      if (event.type === 'START_PIPELINE') {
        return {
          state: {
            ...state,
            status: 'initializing',
            startedAt: now,
            lastTransitionAt: now,
          },
          valid: true,
        };
      }
      break;
    }

    case 'initializing': {
      if (event.type === 'PROJECT_READY') {
        return {
          state: {
            ...state,
            status: 'analyzing',
            lastTransitionAt: now,
          },
          valid: true,
        };
      }
      break;
    }

    case 'analyzing': {
      if (event.type === 'ANALYSIS_COMPLETE') {
        return {
          state: {
            ...state,
            status: 'running',
            executionPlan: event.executionPlan,
            lastTransitionAt: now,
          },
          valid: true,
        };
      }
      break;
    }

    case 'running': {
      if (event.type === 'ALL_PHASES_DONE') {
        return {
          state: {
            ...state,
            status: 'completed',
            completedAt: now,
            lastTransitionAt: now,
          },
          valid: true,
        };
      }
      if (event.type === 'UNRECOVERABLE_ERROR') {
        return {
          state: {
            ...state,
            status: 'failed',
            lastTransitionAt: now,
          },
          valid: true,
        };
      }
      if (event.type === 'PAUSE_REQUESTED') {
        return {
          state: {
            ...state,
            status: 'paused',
            lastTransitionAt: now,
          },
          valid: true,
        };
      }
      if (event.type === 'PHASE_COMPLETED') {
        const updatedPhases = state.phases.map((p) =>
          p.phaseNumber === event.phaseNumber
            ? { ...p, status: 'done' as const }
            : p,
        );
        return {
          state: {
            ...state,
            phases: updatedPhases,
            lastTransitionAt: now,
          },
          valid: true,
        };
      }
      if (event.type === 'PHASE_FAILED') {
        const updatedPhases = state.phases.map((p) =>
          p.phaseNumber === event.phaseNumber
            ? { ...p, status: 'failed' as const, error: event.error }
            : p,
        );
        return {
          state: {
            ...state,
            phases: updatedPhases,
            lastTransitionAt: now,
          },
          valid: true,
        };
      }
      break;
    }

    case 'paused': {
      if (event.type === 'RESUME_REQUESTED') {
        return {
          state: {
            ...state,
            status: 'running',
            lastTransitionAt: now,
          },
          valid: true,
        };
      }
      break;
    }

    case 'completed':
    case 'failed': {
      // Terminal states reject all events
      return {
        state,
        valid: false,
        description: `Cannot transition from terminal state '${state.status}': event '${event.type}' rejected`,
      };
    }
  }

  // Invalid transition (non-terminal)
  return {
    state,
    valid: false,
    description: `Invalid transition: '${state.status}' does not accept '${event.type}'`,
  };
}

// ── Failure cascade ──────────────────────────────────────────────────

/**
 * BFS cascade failure propagation.
 *
 * When a phase fails, all transitive dependents are auto-failed
 * with FailureCascadeInfo pointing to the root cause.
 *
 * - Skips already-failed phases (no overwrite)
 * - Skips done phases (completed work preserved)
 * - Uses visited set to process each node exactly once
 * - Independent phases (not in dependency graph) are untouched
 *
 * @param state - Current pipeline state
 * @param failedPhase - The phase number that originally failed
 * @param error - The error from the failed phase
 * @param dependents - Map of phase -> phases that depend on it
 */
export function cascadeFailure(
  state: PipelineState,
  failedPhase: number,
  error: PhaseError,
  dependents: Map<number, number[]>,
): PipelineState {
  const visited = new Set<number>();
  const queue: number[] = [failedPhase];
  const newPhases = state.phases.map((p) => ({ ...p }));

  visited.add(failedPhase);

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    const deps = dependents.get(current) ?? [];

    for (const dep of deps) {
      if (visited.has(dep)) continue;
      visited.add(dep);

      const phaseIdx = newPhases.findIndex((p) => p.phaseNumber === dep);
      if (phaseIdx === -1) continue;

      const phase = newPhases[phaseIdx];
      if (!phase) continue;

      // Skip already-failed and done phases
      if (phase.status === 'failed' || phase.status === 'done') {
        // Still add to queue to traverse their dependents
        queue.push(dep);
        continue;
      }

      newPhases[phaseIdx] = {
        ...phase,
        status: 'failed',
        failureCascade: {
          rootCausePhase: failedPhase,
          failureType: error.type,
          errorSummary: error.message,
        },
      };

      queue.push(dep);
    }
  }

  return { ...state, phases: newPhases };
}
