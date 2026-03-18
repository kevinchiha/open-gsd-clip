---
phase: 06-user-facing-integration
plan: 03
subsystem: api
tags: [rpc, json-rpc, discord, chat-parser, action-handlers, pipeline-runner, notifications]

# Dependency graph
requires:
  - phase: 06-user-facing-integration/01
    provides: NotificationService, formatters, preferences
  - phase: 06-user-facing-integration/02
    provides: ACTION_HANDLERS, parseCommand, PipelineRunner extensions (pause/resume/retry/resolve/tokens)
provides:
  - "Wired executeAction RPC routing to ACTION_HANDLERS"
  - "chat.message event handling with command parsing and help text"
  - "Plugin startup creates PipelineRunner with stub HostServices"
  - "NotificationService wired at startup when statusIssueId provided"
  - "Root barrel exports for api and notifications modules"
affects: [plugin, integration-tests, e2e]

# Tech tracking
tech-stack:
  added: []
  patterns: [stub-services-at-startup, lazy-host-services, action-routing-via-registry]

key-files:
  created: []
  modified:
    - src/plugin/rpc-handler.ts
    - src/plugin/rpc-handler.test.ts
    - src/plugin/index.ts
    - src/index.ts
    - src/api/schemas.ts
    - src/api/schemas.test.ts
    - src/api/actions.test.ts

key-decisions:
  - "MethodHandler type widened to JsonRpcResponse | JsonRpcErrorResponse union for executeAction error returns"
  - "Stub HostServices pattern: methods log warnings until real services arrive via initialize RPC"
  - "OverrideSchema fixed to accept ESC-prefixed IDs matching actual PipelineRunner escalation format"

patterns-established:
  - "Stub services at startup: PipelineRunner created with warning-only stubs, real services injected later"
  - "Chat-to-action routing: parseCommand -> ACTION_HANDLERS lookup -> handler execution"

requirements-completed: [API-01, API-02, API-03, API-04, API-05, API-06, API-07, CLAW-01, CLAW-04, CLAW-05, CLAW-06, CLAW-07]

# Metrics
duration: 6min
completed: 2026-03-18
---

# Phase 6 Plan 3: RPC Handler Wiring Summary

**executeAction routes to 7 action handlers, chat.message parses Discord commands, PipelineRunner created at startup with stub services**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-18T18:14:50Z
- **Completed:** 2026-03-18T18:21:37Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- executeAction RPC method routes to ACTION_HANDLERS registry by action name with proper error handling
- chat.message events parsed via parseCommand and routed to action handlers; unrecognized messages return help text
- startPlugin creates PipelineRunner with stub HostServices at startup, wires NotificationService when config provides statusIssueId
- Root barrel export extended with api and notifications module re-exports
- Full test suite green (491 tests) with 14 new tests for executeAction and chat.message routing

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire executeAction and chat.message handling in RPC handler** - `f964189` (test: TDD RED) + `a4ded06` (feat: TDD GREEN)
2. **Task 2: Plugin startup wiring and barrel exports** - `5f9e3af` (feat)

_Note: Task 1 followed TDD with separate RED/GREEN commits_

## Files Created/Modified
- `src/plugin/rpc-handler.ts` - executeAction routing, chat.message handling, MethodHandler type fix
- `src/plugin/rpc-handler.test.ts` - 14 new tests for executeAction and chat.message scenarios
- `src/plugin/index.ts` - startPlugin creates PipelineRunner with stub services and optional NotificationService
- `src/index.ts` - Root barrel exports api and notifications modules
- `src/api/schemas.ts` - OverrideSchema fixed to accept ESC-prefixed escalation IDs
- `src/api/schemas.test.ts` - Updated override tests for ESC-prefixed format
- `src/api/actions.test.ts` - Updated override action tests for ESC-prefixed format

## Decisions Made
- MethodHandler type widened to `JsonRpcResponse | JsonRpcErrorResponse` union -- executeAction returns error responses for invalid/unknown actions
- Stub HostServices pattern: PipelineRunner gets warning-only stubs at startup; real services arrive via initialize RPC handshake
- OverrideSchema changed from `z.string().uuid()` to `z.string().refine(ESC-pattern)` to match actual escalation ID format

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] OverrideSchema rejected actual escalation IDs**
- **Found during:** Task 1 (TDD GREEN)
- **Issue:** OverrideSchema required bare UUID format but PipelineRunner creates IDs as `ESC-<uuid>` (line 1097 of pipeline-runner.ts)
- **Fix:** Changed `z.string().uuid()` to `z.string().refine(/^ESC-[\w-]+$/)`, updated 3 test files
- **Files modified:** src/api/schemas.ts, src/api/schemas.test.ts, src/api/actions.test.ts
- **Verification:** All 491 tests pass, TypeScript clean
- **Committed in:** a4ded06 (Task 1 commit)

**2. [Rule 1 - Bug] MethodHandler type too narrow for error responses**
- **Found during:** Task 2 (TypeScript check)
- **Issue:** MethodHandler returned `Promise<JsonRpcResponse>` but executeAction returns `JsonRpcErrorResponse` for invalid params/unknown actions
- **Fix:** Widened type to `Promise<JsonRpcResponse | JsonRpcErrorResponse>`
- **Files modified:** src/plugin/rpc-handler.ts
- **Verification:** TypeScript clean (only pre-existing preferences.test.ts unused import remains)
- **Committed in:** 5f9e3af (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** Both fixes necessary for type safety and correct escalation resolution. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 6 complete: all 3 plans executed
- Plugin is fully controllable via executeAction RPC and Discord chat messages
- All 7 GSD actions routable through both executeAction and chat.message
- PipelineRunner created at startup, stays idle until gsd.start called
- Ready for integration testing and end-to-end validation

## Self-Check: PASSED

All 7 files verified on disk. All 3 commits (f964189, a4ded06, 5f9e3af) verified in git log.

---
*Phase: 06-user-facing-integration*
*Completed: 2026-03-18*
