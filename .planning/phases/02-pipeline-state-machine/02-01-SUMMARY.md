---
phase: 02-pipeline-state-machine
plan: 01
subsystem: pipeline
tags: [fsm, state-machine, typescript, discriminated-unions, pure-functions, bfs-cascade]

# Dependency graph
requires:
  - phase: 01-foundation-and-protocol
    provides: "Result<T,E> type, GsdError hierarchy, pino logger, ESM/Vitest/Biome toolchain"
provides:
  - "Pipeline state types (PipelineStatus, PipelineEvent, PipelineState, TransitionResult)"
  - "Phase state types (PhaseStatus, PhaseEvent, PhaseState, ErrorType, PhaseError, FailureCascadeInfo, StepTiming)"
  - "Resolver input types (PhaseInput, ExecutionPlan)"
  - "Pipeline-level FSM (pipelineTransition, createInitialPipelineState, cascadeFailure)"
  - "Per-phase sub-state machine (phaseTransition, createInitialPhaseState, PHASE_TRANSITIONS)"
affects: [02-02, 02-03, 03-agent-spawning, 04-orchestration]

# Tech tracking
tech-stack:
  added: []
  patterns: [pure-transition-function, transition-table-as-data, bfs-cascade-with-visited-set, immutable-state-spread]

key-files:
  created:
    - src/pipeline/types.ts
    - src/pipeline/fsm.ts
    - src/pipeline/fsm.test.ts
    - src/pipeline/phase-machine.ts
    - src/pipeline/phase-machine.test.ts
  modified: []

key-decisions:
  - "Pure transition functions (no side effects) -- consumers react to returned state"
  - "Switch-based pipeline FSM for complex event handling; data-driven transition table for per-phase machine"
  - "BFS cascade with visited set to prevent infinite loops and process each node exactly once"
  - "Terminal states (done/completed/failed) implemented as empty transition maps rejecting all events"
  - "SET_AGENT/CLEAR_AGENT are metadata-only updates that bypass the transition table"
  - "Backward transitions (revision, retry) reset target step timing but preserve source timing as historical data"

patterns-established:
  - "Pure FSM: transition(state, event) => TransitionResult with no side effects"
  - "Transition table as data: PHASE_TRANSITIONS record for inspectable, testable state machine rules"
  - "Immutable state: always spread to create new objects, never mutate in-place"
  - "StepTiming metadata: startedAt/completedAt tracking per sub-state for duration analytics"
  - "FailureCascadeInfo: rootCausePhase, failureType, errorSummary for auto-failed dependents"

requirements-completed: [PIPE-02]

# Metrics
duration: 7min
completed: 2026-03-18
---

# Phase 2 Plan 01: Pipeline State Machine Summary

**Pure FSM transition functions for pipeline-level and per-phase state machines with BFS failure cascade, step timing, and 91 exhaustive tests**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-18T10:54:29Z
- **Completed:** 2026-03-18T11:01:44Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Pipeline-level FSM enforcing valid transitions (idle -> initializing -> analyzing -> running -> completed/failed) with pause/resume support
- Per-phase sub-state machine with data-driven transition table (pending -> discussing -> reviewing -> planning -> executing -> verifying -> done)
- BFS failure cascade propagating to transitive dependents while skipping done/already-failed phases
- Step timing metadata tracking startedAt/completedAt for each sub-state with correct reset on backward transitions
- 91 tests covering every valid transition, every invalid transition rejection, terminal state guards, cascade scenarios, and agent tracking

## Task Commits

Each task was committed atomically (TDD: test -> feat):

1. **Task 1: Define pipeline state types and implement pipeline FSM**
   - `19644b1` (test) - Failing tests for pipeline FSM transitions and cascade
   - `ea42bd3` (feat) - Pipeline FSM implementation with types and cascade failure
2. **Task 2: Implement per-phase sub-state machine**
   - `a92c5f8` (test) - Failing tests for per-phase sub-state machine
   - `07287c8` (feat) - Per-phase sub-state machine with transition table

## Files Created/Modified
- `src/pipeline/types.ts` - All pipeline/phase state types, events, errors, timing, resolver inputs
- `src/pipeline/fsm.ts` - Pipeline-level FSM: pipelineTransition, createInitialPipelineState, cascadeFailure
- `src/pipeline/fsm.test.ts` - 41 tests for pipeline FSM transitions, terminal guards, cascade scenarios
- `src/pipeline/phase-machine.ts` - Per-phase sub-state machine: phaseTransition, createInitialPhaseState, PHASE_TRANSITIONS
- `src/pipeline/phase-machine.test.ts` - 33 tests (+ 17 parameterized = 50 test cases) for phase transitions, timing, agent tracking

## Decisions Made
- **Switch vs table for pipeline FSM:** Used switch-based approach for pipeline FSM because events carry heterogeneous payloads (executionPlan, phaseNumber, error) requiring per-case destructuring. Used data-driven table for phase FSM where transitions are more uniform.
- **Agent events bypass transition table:** SET_AGENT and CLEAR_AGENT are handled as metadata-only updates before the table lookup, since they don't change phase status and work across all non-terminal states.
- **Cascade skips done but still traverses:** Done phases are not auto-failed (completed work preserved), but their dependents are still traversed and may be auto-failed if they aren't done themselves.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All pipeline and phase state types exported and importable for Plan 02 (dependency resolver) and Plan 03 (serialization)
- PHASE_TRANSITIONS table exported for inspection/testing by downstream modules
- TransitionResult<S> generic ready for use across both FSM levels
- PhaseInput and ExecutionPlan types ready for the dependency resolver (Plan 02)

## Self-Check: PASSED

All 5 created files verified present on disk. All 4 task commits (19644b1, ea42bd3, a92c5f8, 07287c8) verified in git history.

---
*Phase: 02-pipeline-state-machine*
*Completed: 2026-03-18*
