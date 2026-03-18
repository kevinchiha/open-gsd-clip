---
phase: 01-foundation-and-protocol
plan: 03
subsystem: bridge
tags: [gsd-tools, execa, zod, auto-discovery, typed-wrapper, cli-bridge]

# Dependency graph
requires:
  - phase: 01-foundation-and-protocol
    provides: "Shared logger, base error classes (GsdError, GsdOperationalError), test fixtures with ROADMAP.md/STATE.md"
provides:
  - "GSD tools bridge with analyzeRoadmap(), getPhase(), getState(), findPhase() methods"
  - "Auto-discovery of gsd-tools.cjs via 3-step chain (env var, default path, package resolve)"
  - "Typed error hierarchy: GsdBridgeError, GsdToolsNotFoundError, GsdParseError, GsdTimeoutError"
  - "Zod schemas validating gsd-tools.cjs JSON output with snake_case to camelCase transformation"
  - "Domain types: RoadmapAnalysis, RoadmapPhase, PhaseDefinition, ProjectState, PhasePath"
affects: [01-04, 02-pipeline-state-machine, 03-agent-spawning]

# Tech tracking
tech-stack:
  added: []
  patterns: [typed-cli-bridge, zod-schema-validation, snake-to-camel-transform, 3-step-discovery]

key-files:
  created:
    - src/bridge/types.ts
    - src/bridge/errors.ts
    - src/bridge/schemas.ts
    - src/bridge/discovery.ts
    - src/bridge/discovery.test.ts
    - src/bridge/executor.ts
    - src/bridge/executor.test.ts
    - src/bridge/index.ts
    - src/bridge/commands.test.ts
  modified: []

key-decisions:
  - "FindPhaseSchema allows nullable directory/phase_number/phase_name for found=false case (verified against real gsd-tools.cjs output)"
  - "missing_phase_details typed as string[] | null (gsd-tools returns null, not empty array)"
  - "Error hierarchy extends GsdOperationalError from shared/errors.ts for consistent project error classification"

patterns-established:
  - "Typed CLI bridge: raw JSON validated through Zod, transformed to camelCase domain types"
  - "3-step auto-discovery: env var > default path > package resolve > throw"
  - "Classified error handling: timeout, not-found, parse, generic -- each with contextual properties"
  - "Integration tests against real gsd-tools.cjs with fixture project data"

requirements-completed: [PIPE-04]

# Metrics
duration: 5min
completed: 2026-03-18
---

# Phase 1 Plan 03: GSD Bridge Summary

**Typed gsd-tools.cjs bridge with 4 query methods, Zod validation, auto-discovery, and classified error hierarchy**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-18T10:40:55Z
- **Completed:** 2026-03-18T10:46:48Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- Full bridge API (analyzeRoadmap, getPhase, getState, findPhase) validated against real gsd-tools.cjs
- 3-step auto-discovery chain for gsd-tools.cjs path with classified errors
- 22 tests passing: 12 unit tests (discovery + executor) and 10 integration tests (real CLI)
- All returned objects use camelCase property names with correct TypeScript types

## Task Commits

Each task was committed atomically:

1. **Task 1: Define bridge types, errors, schemas, and implement discovery + executor** - `a6e20f4` (feat)
2. **Task 2: Implement bridge public API and integration tests** - `7f9d861` (feat)

## Files Created/Modified
- `src/bridge/types.ts` - Domain types: RoadmapAnalysis, RoadmapPhase, PhaseDefinition, ProjectState, PhasePath, BridgeOptions
- `src/bridge/errors.ts` - Error hierarchy: GsdBridgeError, GsdToolsNotFoundError, GsdParseError, GsdTimeoutError
- `src/bridge/schemas.ts` - Zod schemas for gsd-tools.cjs snake_case JSON output validation
- `src/bridge/discovery.ts` - 3-step auto-discovery of gsd-tools.cjs path
- `src/bridge/discovery.test.ts` - 6 unit tests for discovery logic
- `src/bridge/executor.ts` - Low-level gsd-tools.cjs invocation via execa with error classification
- `src/bridge/executor.test.ts` - 6 unit tests for executor (mocked execa)
- `src/bridge/index.ts` - Public bridge API: createBridge factory, re-exports all types/errors
- `src/bridge/commands.test.ts` - 10 integration tests against real gsd-tools.cjs with fixture project

## Decisions Made
- **FindPhaseSchema nullable fields:** Real gsd-tools.cjs returns null for directory/phase_number/phase_name when `found=false` -- updated schema and type to allow nulls
- **missing_phase_details nullable:** gsd-tools returns `null` (not `[]`) for missing_phase_details when there are none -- schema uses `z.array(z.string()).nullable()`
- **Error hierarchy:** GsdBridgeError extends GsdOperationalError (from shared/errors.ts), keeping the project-wide error classification consistent

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed FindPhaseSchema for not-found case**
- **Found during:** Task 2 (integration tests)
- **Issue:** Plan specified FindPhaseSchema with non-nullable directory/phase_number/phase_name, but real gsd-tools.cjs returns null for these fields when `found=false`
- **Fix:** Updated FindPhaseSchema to use `.nullable()` for directory, phase_number, phase_name; updated PhasePath type to match
- **Files modified:** src/bridge/schemas.ts, src/bridge/types.ts
- **Verification:** Integration test `findPhase with non-existent phase returns found=false` passes
- **Committed in:** 7f9d861 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Schema correction necessary for real gsd-tools.cjs compatibility. No scope creep.

## Issues Encountered
None beyond the auto-fixed deviation above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Bridge API fully functional and tested against real gsd-tools.cjs
- All types, errors, and schemas exported from `src/bridge/index.ts` for downstream use
- Integration test pattern established for future bridge method additions
- Pipeline state machine (Phase 2) can import bridge for roadmap/state queries

## Self-Check: PASSED

All 9 created files verified present on disk. Both task commits (a6e20f4, 7f9d861) verified in git history.

---
*Phase: 01-foundation-and-protocol*
*Completed: 2026-03-18*
