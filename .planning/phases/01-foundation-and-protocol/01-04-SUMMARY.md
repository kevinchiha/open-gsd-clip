---
phase: 01-foundation-and-protocol
plan: 04
subsystem: signals
tags: [zod, yaml, parser, signal-protocol, vitest, tdd]

# Dependency graph
requires:
  - phase: 01-foundation-and-protocol
    provides: Project scaffolding, shared logger, error classes, TypeScript/Vitest/Biome toolchain
provides:
  - "12 signal type definitions with TypeScript interfaces and Zod schemas"
  - "parseSignal() extracts GSD_SIGNAL blocks from natural language text"
  - "formatSignal() serializes signals to YAML-delimited blocks (round-trip)"
  - "Discriminated union schema (gsdSignalSchema) for type-based dispatch"
  - "Barrel file (src/signals/index.ts) for public API"
affects: [02-pipeline-state-machine, 03-agent-spawning, 04-sequential-pipeline]

# Tech tracking
tech-stack:
  added: []
  patterns: [zod-discriminated-union, yaml-signal-blocks, non-greedy-regex-extraction, namespace-import-for-cjs-deps]

key-files:
  created:
    - src/signals/types.ts
    - src/signals/schemas.ts
    - src/signals/schemas.test.ts
    - src/signals/parser.ts
    - src/signals/parser.test.ts
    - src/signals/index.ts
  modified: []

key-decisions:
  - "Namespace import for js-yaml (`import * as yaml`) required by nodenext module resolution with CJS @types/js-yaml"
  - "Explicit .strip() on all Zod schemas to document intent of stripping unknown fields"
  - "Compile-time exhaustiveness check ensures signalSchemas covers all SIGNAL_TYPES entries"
  - "Non-greedy regex with global+multiline flags to find first GSD_SIGNAL block among multiple --- delimited sections"

patterns-established:
  - "Signal block format: --- delimited, GSD_SIGNAL:<TYPE> on first line, YAML body, --- close"
  - "Type-specific Zod schemas with safeParse for validation, strip for unknown fields"
  - "formatSignal/parseSignal round-trip: type field goes on marker line, excluded from YAML body"
  - "Namespace imports for CJS packages under nodenext resolution"

requirements-completed: [PIPE-05]

# Metrics
duration: 5min
completed: 2026-03-18
---

# Phase 1 Plan 04: Signal Parser Summary

**Zod-validated signal parser extracting 12 GSD_SIGNAL types from YAML blocks in natural language text with round-trip formatting**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-18T10:41:10Z
- **Completed:** 2026-03-18T10:46:11Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- All 12 signal types defined with TypeScript interfaces and Zod schemas (strict validation, unknown field stripping)
- Signal parser extracts GSD_SIGNAL blocks from surrounding natural language using non-greedy regex
- formatSignal + parseSignal round-trip verified for multiple signal types including edge cases
- 56 tests passing across schema validation (38) and parser extraction/formatting (18)

## Task Commits

Each task was committed atomically:

1. **Task 1: Define signal types and Zod schemas** - `983f892` (feat)
2. **Task 2: Implement signal parser, formatter, barrel exports** - `f185987` (feat)

## Files Created/Modified
- `src/signals/types.ts` - SIGNAL_TYPES array, SignalType union, 12 interfaces, GsdSignal discriminated union
- `src/signals/schemas.ts` - 12 Zod schemas with .strip(), signalSchemas record, gsdSignalSchema discriminated union
- `src/signals/schemas.test.ts` - 38 tests: valid data, missing fields, unknown field stripping, union validation
- `src/signals/parser.ts` - parseSignal() extraction with YAML parsing and schema validation, formatSignal() serialization
- `src/signals/parser.test.ts` - 18 tests: extraction, edge cases, null returns, round-trip, multiple signal types
- `src/signals/index.ts` - Barrel re-exports for public API

## Decisions Made
- **Namespace import for js-yaml**: nodenext module resolution with CJS @types/js-yaml requires `import * as yaml` not default import
- **Explicit .strip() on schemas**: Default Zod behavior strips unknown fields, but explicit call documents the intent for future maintainers
- **Compile-time exhaustiveness check**: `const _exhaustiveCheck: Record<SignalType, ZodTypeAny> = signalSchemas` ensures all types have schemas
- **Non-greedy regex with global/multiline**: Iterates `---` blocks searching for GSD_SIGNAL marker, handles multiple blocks correctly

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed js-yaml import for nodenext module resolution**
- **Found during:** Task 2 (parser implementation)
- **Issue:** `import yaml from 'js-yaml'` fails tsc with nodenext resolution because @types/js-yaml declares no default export
- **Fix:** Changed to `import * as yaml from 'js-yaml'` (namespace import)
- **Files modified:** src/signals/parser.ts
- **Verification:** `npx tsc --noEmit` passes for signal files (only pre-existing bridge errors remain)
- **Committed in:** f185987 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Fix required for TypeScript compilation. No scope creep.

## Issues Encountered

**Pre-existing tsc errors in bridge module:** `src/bridge/commands.test.ts` has TS2307 errors for missing `./index.js` module. These errors exist on the main branch before this plan's changes and are from the bridge module (Plan 01-03) that hasn't been executed yet. Out of scope -- not fixed.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Signal parser ready for consumption by pipeline FSM (Phase 2) and agent spawning (Phase 3)
- All 12 signal types validated with strict schemas -- agents can safely parse and format signals
- Barrel file provides clean public API: `import { parseSignal, formatSignal } from './signals/index.js'`
- Zero coupling between signals module and bridge module -- independent integration paths

## Self-Check: PASSED

All 6 created files verified present on disk. Both task commits (983f892, f185987) verified in git history.

---
*Phase: 01-foundation-and-protocol*
*Completed: 2026-03-18*
