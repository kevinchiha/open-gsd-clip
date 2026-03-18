---
phase: 03-agent-spawning-infrastructure
plan: 03
subsystem: agents
tags: [paperclip, agent-invoker, signal-mapping, event-handler, barrel-export]

# Dependency graph
requires:
  - phase: 03-agent-spawning-infrastructure
    provides: "Agent types, factory (Plan 01), context builder (Plan 02)"
  - phase: 01-foundation-and-protocol
    provides: "JSON-RPC handler, signal parser, pipeline types"
provides:
  - "spawnAgent function for creating issues and invoking Paperclip agents"
  - "mapSignalToPhaseEvent for converting GSD signals to FSM events"
  - "onEvent handler detecting heartbeat.run.status agent completion events"
  - "src/agents/index.ts barrel export for entire agents module"
affects: [04-sequential-pipeline-execution, 05-parallel-phases]

# Tech tracking
tech-stack:
  added: []
  patterns: [signal-to-event-mapping, event-driven-completion-detection, barrel-export]

key-files:
  created:
    - src/agents/invoker.ts
    - src/agents/invoker.test.ts
    - src/agents/index.ts
  modified:
    - src/plugin/rpc-handler.ts
    - src/plugin/rpc-handler.test.ts

key-decisions:
  - "Result<T,E> unwrapping with throw on error for spawnAgent -- keeps caller interface clean"
  - "onEvent defers signal parsing to Phase 4 -- avoids coupling to HostServices not yet wired"
  - "mapSignalToPhaseEvent returns null for non-phase signals (DECISION_NEEDED, STALE_HEARTBEAT)"

patterns-established:
  - "Signal-to-event mapping: switch on GsdSignal.type to produce PhaseEvent"
  - "Agent completion detection: heartbeat.run.status event filtering in onEvent"
  - "Barrel export: src/agents/index.ts re-exports all public APIs"

requirements-completed: [AGNT-07, AGNT-01, AGNT-02, AGNT-03, AGNT-04, AGNT-05]

# Metrics
duration: 4min
completed: 2026-03-18
---

# Phase 3 Plan 03: Agent Invoker and Event Handler Summary

**spawnAgent creates isolated-workspace issues and invokes agents; mapSignalToPhaseEvent converts all 12 signal types to FSM events; onEvent detects agent completion via heartbeat.run.status**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-18T15:42:45Z
- **Completed:** 2026-03-18T15:46:58Z
- **Tasks:** 4
- **Files modified:** 5

## Accomplishments
- spawnAgent creates Paperclip issues with isolated workspace mode and invokes agents, returning SpawnResult
- mapSignalToPhaseEvent maps all 12 GSD signal types to PhaseEvent (STEP_COMPLETED, STEP_FAILED, APPROVED, REVISION_NEEDED) or null
- onEvent handler detects heartbeat.run.status events and logs terminal states (succeeded/failed) for Phase 4 wiring
- Barrel export at src/agents/index.ts provides clean single-import API for the entire agents module

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement spawnAgent with issue creation and agent invocation** - `196c1bd` (feat)
2. **Task 2: Implement signal-to-PhaseEvent mapping** - `05ef812` (feat)
3. **Task 3: Update onEvent handler for agent completion detection** - `7378379` (feat)
4. **Task 4: Create barrel export and verify module integration** - `c67cc92` (feat)

## Files Created/Modified
- `src/agents/invoker.ts` - spawnAgent and mapSignalToPhaseEvent functions
- `src/agents/invoker.test.ts` - 21 tests covering spawn and signal mapping
- `src/agents/index.ts` - Barrel export for agents module
- `src/plugin/rpc-handler.ts` - Updated onEvent with heartbeat.run.status detection
- `src/plugin/rpc-handler.test.ts` - 4 onEvent tests for run status events

## Decisions Made
- Used Result<T,E> unwrapping with throw on error in spawnAgent rather than propagating Result -- keeps the spawn interface clean for Phase 4 callers who will catch at the orchestration level
- Deferred full signal parsing in onEvent to Phase 4 -- onEvent currently logs terminal states but does not fetch issue comments or parse signals, because HostServices is not yet wired into the handler
- mapSignalToPhaseEvent returns null (not an error) for DECISION_NEEDED, DECISION_MADE, and STALE_HEARTBEAT signals since these are handled at the orchestration layer, not the phase FSM layer

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 3 complete: agent factory, context builder, and invoker all implemented and tested
- Phase 4 can wire HostServices into onEvent for full signal parsing and FSM dispatch
- Phase 4 can use spawnAgent to create issues and invoke agents per phase step
- All 276 tests passing, TypeScript strict compilation clean, biome lint clean

## Self-Check: PASSED

All 6 files verified present. All 4 task commits verified in git log.

---
*Phase: 03-agent-spawning-infrastructure*
*Completed: 2026-03-18*
