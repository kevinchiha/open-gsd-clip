---
phase: 01-foundation-and-protocol
plan: 02
subsystem: plugin
tags: [json-rpc, stdio, zod, readline, child-process, integration-test]

# Dependency graph
requires:
  - phase: 01-01
    provides: "Project scaffolding, shared logger (stderr), error classes, Biome noConsole rule"
provides:
  - "JSON-RPC 2.0 transport layer over stdin/stdout (line-delimited JSON framing)"
  - "RPC method handler with all 8 Paperclip methods (initialize, health, onEvent, getState, executeAction, registerTools, configure, shutdown)"
  - "Plugin entry point that wires transport to handler for child-process execution"
  - "Zod-validated request schema with typed error codes"
  - "Integration test proving full child-process round-trip via stdio"
affects: [01-03, 01-04, 02-pipeline-state-machine, 03-agent-spawning]

# Tech tracking
tech-stack:
  added: []
  patterns: [line-delimited-json-rpc, method-dispatch-table, zod-request-validation, child-process-integration-tests]

key-files:
  created:
    - src/plugin/types.ts
    - src/plugin/rpc-transport.ts
    - src/plugin/rpc-transport.test.ts
    - src/plugin/rpc-handler.ts
    - src/plugin/rpc-handler.test.ts
    - src/plugin/index.ts
    - src/plugin/integration.test.ts
  modified: []

key-decisions:
  - "Hand-rolled JSON-RPC over stdio (no json-rpc-2.0 library) -- protocol is simple (8 methods), avoids dependency"
  - "readline.createInterface with crlfDelay:Infinity for cross-platform line splitting"
  - "Notification requests (no id) run handler but produce no response per JSON-RPC 2.0 spec"
  - "node:child_process.spawn with tsx for integration tests instead of execa -- simpler for test harness"

patterns-established:
  - "Method dispatch table: Record<string, MethodHandler> for mapping RPC method names to async handlers"
  - "Transport/handler separation: transport handles framing (JSON parsing/serialization), handler handles routing/logic"
  - "Zod schema validation at RPC boundary: validate once at entry, typed downstream"
  - "Child process integration tests: spawn plugin via tsx, send JSON on stdin, assert JSON on stdout"

requirements-completed: [PIPE-01]

# Metrics
duration: 8min
completed: 2026-03-18
---

# Phase 1 Plan 02: Plugin Shell Summary

**JSON-RPC 2.0 stdio transport with Zod-validated request dispatch, 8 method handlers, and child-process integration tests**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-18T10:40:56Z
- **Completed:** 2026-03-18T10:49:00Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Full JSON-RPC 2.0 transport layer: line-delimited JSON framing over stdin/stdout with parse error handling and empty line skipping
- RPC handler with all 8 Paperclip methods: initialize (manifest), health (ok), onEvent (ack), shutdown, plus 4 stubs
- Child-process integration test proving round-trip: spawn plugin via tsx, send requests on stdin, verify responses on stdout
- 22 tests total: 12 handler unit tests, 5 transport unit tests, 5 integration tests

## Task Commits

Each task was committed atomically (TDD: test -> feat):

1. **Task 1: Define types and implement transport + handler**
   - `1179fc7` (test) - RED: types.ts + failing transport/handler tests
   - `ee83bb0` (feat) - GREEN: transport + handler implementation (committed by parallel agent)

2. **Task 2: Wire entry point and integration test**
   - `f1c40bd` (test) - RED: failing integration test
   - `81c87f2` (feat) - GREEN: plugin entry point wiring

## Files Created/Modified
- `src/plugin/types.ts` - JSON-RPC 2.0 message types (Zod schemas), RPC error codes, PaperclipPluginManifestV1 interface
- `src/plugin/rpc-transport.ts` - Line-delimited JSON framing layer using readline over stdin/stdout
- `src/plugin/rpc-transport.test.ts` - 5 unit tests: valid JSON, malformed JSON, empty lines, multi-line, notifications
- `src/plugin/rpc-handler.ts` - JSON-RPC method dispatcher with initialize/health/onEvent/shutdown + 4 stubs
- `src/plugin/rpc-handler.test.ts` - 12 unit tests: all methods, error codes, invalid requests, notifications
- `src/plugin/index.ts` - Plugin entry point: wires transport to handler, auto-start detection, clean exit on stdin close
- `src/plugin/integration.test.ts` - 5 integration tests: child process spawn, sequential requests, clean exit

## Decisions Made
- Used `node:child_process.spawn` instead of execa for integration tests -- simpler for the test harness and avoids importing execa in test code
- Notification handling follows JSON-RPC 2.0 spec strictly: handler runs but response is suppressed (returns undefined from transport)
- Auto-start detection via `process.argv[1]` suffix match rather than `import.meta.url` comparison (tsx rewrites paths making URL comparison unreliable)

## Deviations from Plan

None -- plan executed exactly as written. Biome formatting was applied post-implementation as standard cleanup.

## Issues Encountered
- Parallel agent commits (`ee83bb0`, `6313d5e`) picked up plugin files written to disk by this plan's execution, creating interleaved commit history. No code impact -- all files are correct and tests pass.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plugin shell complete and tested, ready for pipeline FSM integration (Phase 2)
- Transport/handler pattern established for adding new RPC methods in future phases
- Integration test pattern ready for reuse in more complex scenarios (state management, event handling)

## Self-Check: PASSED

All 7 created files verified present on disk. All 4 task commits (1179fc7, ee83bb0, f1c40bd, 81c87f2) verified in git history.

---
*Phase: 01-foundation-and-protocol*
*Completed: 2026-03-18*
