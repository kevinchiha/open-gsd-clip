---
phase: 04-sequential-pipeline-execution
plan: 04
subsystem: orchestrator
tags: [pipeline-runner, orchestration-loop, ceo-quality-gate, phase-lifecycle, event-dispatch]

# Dependency graph
requires:
  - phase: 04-sequential-pipeline-execution
    provides: "Error handler, audit log, health monitor, event queue, quality gate from Plans 01-03"
  - phase: 03-agent-spawning
    provides: "ensureAgentsExist, spawnAgent, mapSignalToPhaseEvent from agents module"
  - phase: 02-state-machines
    provides: "Pipeline FSM, phase FSM, execution plan resolver, serialization"
  - phase: 01-foundation
    provides: "Signal parser, RPC handler, logger, types"
provides:
  - PipelineRunner class driving full discuss->review->plan->execute->verify lifecycle
  - onEvent handler wired to orchestrator for agent completion dispatch
  - Barrel export at src/orchestrator/index.ts for clean public API
affects: [05-parallel-execution, 06-ux-discord-bot]

# Tech tracking
tech-stack:
  added: []
  patterns: [closure-const-capture, revision-count-tracking, sequential-phase-advancement]

key-files:
  created:
    - src/orchestrator/pipeline-runner.ts
    - src/orchestrator/pipeline-runner.test.ts
    - src/orchestrator/index.ts
  modified:
    - src/plugin/rpc-handler.ts
    - src/plugin/rpc-handler.test.ts

key-decisions:
  - "Local const capture pattern for TypeScript closure narrowing -- extract agentId/projectPath before retryWithBackoff closures"
  - "Revision limit triggers discussing->STEP_FAILED (not direct fail from reviewing) since reviewing FSM has no STEP_FAILED transition"
  - "buildCeoReviewContext/buildRevisionContext not used in PipelineRunner -- CEO review uses custom issue creation, not standard spawnAgent"
  - "Mock AuditLog in tests to avoid filesystem operations at /test project path"

patterns-established:
  - "Orchestrator-to-RPC wiring: createRpcHandler(orchestrator?) injects PipelineRunner optionally"
  - "Phase advancement dispatch: switch on phase.status after FSM transition to spawn next agent"
  - "Revision counting via Map<phaseNumber, count> with configurable maxRevisions limit"

requirements-completed: [PIPE-03, PIPE-08, AGNT-12, EXEC-05]

# Metrics
duration: 10min
completed: 2026-03-18
---

# Phase 4 Plan 4: Pipeline Runner and Orchestrator Wiring Summary

**PipelineRunner driving full phase lifecycle (discuss->review->plan->execute->verify) with CEO quality gates, error retry, revision limits, and RPC handler integration**

## Performance

- **Duration:** 10 min
- **Started:** 2026-03-18T16:50:32Z
- **Completed:** 2026-03-18T17:00:32Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- PipelineRunner drives end-to-end sequential execution: start -> PROJECT_READY -> per-phase discuss->review->plan->execute->verify loop
- CEO quality gate with revision count limits (configurable maxRevisions, default 3)
- Error classification and retry with backoff integrated via classifyError + retryWithBackoff
- Phase-level retry resets phase to pending via RETRY_PHASE event
- Verification failure transitions back to executing (phase FSM: verifying + STEP_FAILED -> executing)
- State persisted after every FSM transition via serialize
- SerialEventQueue prevents race conditions on concurrent agent completion events
- onEvent handler dispatches heartbeat.run.status events to orchestrator
- Barrel export provides clean public API for all orchestrator modules
- 344 tests pass across entire project, TypeScript strict compilation clean

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement PipelineRunner core with TDD** - `da35ab4` (feat)
2. **Task 2: Wire onEvent to orchestrator, update RPC handler, create barrel export** - `3360912` (feat)

_Note: TDD task -- tests written first (RED), implementation to pass (GREEN), then lint cleanup_

## Files Created/Modified
- `src/orchestrator/pipeline-runner.ts` - PipelineRunner class: start, handleAgentCompletion, phase lifecycle, agent spawning, revision tracking, state persistence
- `src/orchestrator/pipeline-runner.test.ts` - 10 tests: start, PROJECT_READY, full phase loop, revision handling, retry, replan, all-phases-done, serial events
- `src/orchestrator/index.ts` - Barrel export for all orchestrator module APIs
- `src/plugin/rpc-handler.ts` - Updated createRpcHandler to accept optional PipelineRunner, onEvent dispatches to orchestrator
- `src/plugin/rpc-handler.test.ts` - 4 new tests for orchestrator wiring, backward compatibility

## Decisions Made
- Local const capture for TypeScript closure narrowing: `const agentId = this.agents.x.agentId` before `retryWithBackoff(() => ...)` closures avoids `string | undefined` type errors
- Revision limit exceeded triggers `reviewing -> discussing (REVISION_NEEDED) -> STEP_FAILED` two-step transition since the reviewing FSM state does not accept STEP_FAILED directly
- buildCeoReviewContext and buildRevisionContext are not used by PipelineRunner -- CEO review creates custom issues with buildReviewIssueDescription instead of standard spawnAgent
- AuditLog mocked in pipeline-runner tests to avoid filesystem writes at test project paths

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed closure type narrowing for TypeScript strict mode**
- **Found during:** Task 2 (biome + tsc verification)
- **Issue:** Biome replaced `this.agents!.x` with `this.agents?.x` producing `string | undefined`, which TypeScript strict mode rejects as argument to `spawnAgent(string)`
- **Fix:** Extracted local const variables (`const agentId = this.agents.x.agentId`) after null guard, giving TypeScript definite assignment
- **Files modified:** src/orchestrator/pipeline-runner.ts
- **Verification:** `npx tsc --noEmit` passes clean
- **Committed in:** 3360912 (Task 2 commit)

**2. [Rule 1 - Bug] Fixed revision limit transition path**
- **Found during:** Task 1 (test 5: revision limit exceeded)
- **Issue:** Phase FSM `reviewing` state has no `STEP_FAILED` transition, so direct failure from reviewing was rejected as invalid
- **Fix:** Transition reviewing -> discussing (via REVISION_NEEDED) first, then discussing -> failed (via STEP_FAILED)
- **Files modified:** src/orchestrator/pipeline-runner.ts
- **Verification:** Test "fails phase when revision count exceeds maxRevisions" passes
- **Committed in:** da35ab4 (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** Both fixes necessary for correct FSM behavior and TypeScript strict compliance. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 4 (Sequential Pipeline Execution) is now complete with all 4 plans done
- PipelineRunner provides the orchestration core for Phase 5 (Parallel Execution) to extend with concurrent phase support
- Barrel export at src/orchestrator/index.ts gives Phase 5 and Phase 6 clean import paths
- All 344 tests pass, TypeScript strict compilation clean

---
*Phase: 04-sequential-pipeline-execution*
*Completed: 2026-03-18*
