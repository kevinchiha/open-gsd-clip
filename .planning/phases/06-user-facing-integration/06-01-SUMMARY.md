---
phase: 06-user-facing-integration
plan: 01
subsystem: api, notifications, orchestrator
tags: [zod, notification, token-tracking, preferences, formatters]

requires:
  - phase: 03-agent-spawning
    provides: HostServices interface for issue comment posting
  - phase: 04-sequential-orchestration
    provides: AuditEntry and OrchestratorConfig types for extension
provides:
  - Zod schemas for gsd.start, gsd.retry, gsd.override, preference validation
  - Pipeline event formatters for all 9 event types
  - Notification preference filter with 4 modes
  - NotificationService for activity posting via HostServices
  - TokenTracker for per-phase/role token usage aggregation
  - EscalationRecord type for CEO-to-user escalation flow
affects: [06-02, 06-03]

tech-stack:
  added: []
  patterns: [fire-and-forget notifications, preference-based event filtering, discriminated union event types]

key-files:
  created:
    - src/api/schemas.ts
    - src/api/schemas.test.ts
    - src/notifications/formatters.ts
    - src/notifications/formatters.test.ts
    - src/notifications/preferences.ts
    - src/notifications/preferences.test.ts
    - src/notifications/notification-service.ts
    - src/notifications/notification-service.test.ts
    - src/notifications/index.ts
    - src/orchestrator/token-tracker.ts
    - src/orchestrator/token-tracker.test.ts
  modified:
    - src/orchestrator/types.ts

key-decisions:
  - "Floating point precision fix for costCents accumulation using Math.round to 10 decimal places"
  - "Discriminated union with 9 event types for PipelineNotificationEvent (typed switch exhaustiveness)"
  - "Set-based preference filtering for O(1) event type matching"

patterns-established:
  - "Fire-and-forget notification pattern: log errors, never throw from notify()"
  - "Preference-based event filtering via shouldNotify predicate"
  - "Discriminated union events with exhaustive switch formatting"

requirements-completed: [OBSV-01, OBSV-02, OBSV-03, OBSV-04, CLAW-02, CLAW-03]

duration: 5min
completed: 2026-03-18
---

# Phase 6 Plan 01: Foundation Types Summary

**Zod API schemas, 9-type pipeline event formatters, preference-based notification service, and per-phase token tracker**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-18T17:58:21Z
- **Completed:** 2026-03-18T18:03:00Z
- **Tasks:** 2
- **Files modified:** 12

## Accomplishments
- Zod schemas validating all 4 GSD API actions (start, retry, override, preference) with proper rejection of invalid inputs
- Pipeline event formatters producing human-readable plain text for all 9 event types (no emojis)
- NotificationService posting activity via HostServices with preference filtering and graceful error handling
- TokenTracker accumulating input/output/total tokens and cost per phase and role with pipeline-wide aggregation
- EscalationRecord interface extending orchestrator types for CEO-to-user escalation flow

## Task Commits

Each task was committed atomically:

1. **Task 1: API schemas, formatters, preferences, token tracker** - `8b9c5ce` (test) + `3249c18` (feat)
2. **Task 2: NotificationService with activity posting and barrel export** - `90322fd` (feat)

_Note: TDD tasks have RED (test) then GREEN (feat) commits_

## Files Created/Modified
- `src/api/schemas.ts` - Zod schemas for Start, Retry, Override, Preference request validation
- `src/api/schemas.test.ts` - Schema validation/rejection tests
- `src/notifications/formatters.ts` - Human-readable formatting for 9 pipeline event types
- `src/notifications/formatters.test.ts` - Formatter output tests including no-emoji check
- `src/notifications/preferences.ts` - NotificationPreference type and shouldNotify filter
- `src/notifications/preferences.test.ts` - Preference filter tests for all 4 modes
- `src/notifications/notification-service.ts` - Activity posting via HostServices issue comments
- `src/notifications/notification-service.test.ts` - Service tests with mocked HostServices
- `src/notifications/index.ts` - Barrel export for notifications module
- `src/orchestrator/token-tracker.ts` - Per-phase/role token usage accumulation
- `src/orchestrator/token-tracker.test.ts` - TokenTracker accumulation and aggregation tests
- `src/orchestrator/types.ts` - Extended with EscalationRecord interface

## Decisions Made
- Floating point precision fix for costCents: Math.round to 10 decimal places avoids accumulation drift (0.3+0.6 issue)
- Set-based preference filtering for O(1) event type matching instead of switch/if chains
- Discriminated union with 9 event types enables exhaustive switch in formatPipelineEvent

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed floating point precision in TokenTracker costCents accumulation**
- **Found during:** Task 1 (TokenTracker implementation)
- **Issue:** Adding 0.3 + 0.6 produced 0.8999999999999999 instead of 0.9
- **Fix:** Applied Math.round to 10 decimal places in addUsage helper
- **Files modified:** src/orchestrator/token-tracker.ts
- **Verification:** Test for accumulated costCents passes with exact equality
- **Committed in:** 3249c18 (Task 1 feat commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix)
**Impact on plan:** Essential for correctness of token cost tracking. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All foundation modules ready for Plan 02 (RPC handler integration) and Plan 03 (PipelineRunner wiring)
- NotificationService ready to be injected into PipelineRunner
- TokenTracker ready to be wired into agent invocation callbacks
- Zod schemas ready for RPC handler method validation

---
*Phase: 06-user-facing-integration*
*Completed: 2026-03-18*
