---
phase: 05-parallel-execution-and-merge-strategy
plan: 02
subsystem: orchestrator
tags: [parallel-execution, worktree-integration, merge-queue, dependency-resolution]

# Dependency graph
requires:
  - phase: 05-parallel-execution-and-merge-strategy
    plan: 01
    provides: WorktreeManager for git worktree lifecycle, MergeQueue for ordered merging
  - phase: 04-sequential-pipeline-execution
    provides: PipelineRunner sequential pipeline, error-handler, health-monitor
provides:
  - PipelineRunner with parallel group dispatch and worktree integration
  - Dependency-based phase unblocking (findReadyPhases)
  - Ordered merge via MergeQueue on phase completion
  - Barrel export with WorktreeManager, WorktreeInfo, MergeQueue
affects: [06-ux-and-polish (final integration)]

# Tech tracking
tech-stack:
  added: []
  patterns: [parallel-group-dispatch, dependency-based-phase-unblocking, worktree-per-phase-agent-spawn, merge-on-complete]

key-files:
  created: []
  modified:
    - src/orchestrator/pipeline-runner.ts
    - src/orchestrator/pipeline-runner.test.ts
    - src/orchestrator/index.ts

key-decisions:
  - "Derive phaseInputs from execution plan groups (not hardcoded) so dependency tracking matches actual plan"
  - "derivePhaseInputs: phases in group N depend on all phases in group N-1 (immediate predecessor group only)"
  - "Fire-and-forget worktree cleanup in destroy() to avoid changing sync API signature"
  - "MergeQueue onMerge callback chains mergePhase then removeWorktree for cleanup after merge"

patterns-established:
  - "startPhase: createWorktree then DEPENDENCIES_MET for consistent phase initialization"
  - "findReadyPhases: filter pending phases whose dependsOn are all in done status"
  - "Worktree path override: all spawn methods use worktreeManager.getWorkingDirectory fallback to state.projectPath"
  - "Cascade failure propagation: markFailed on both root cause and cascade-failed dependents"

requirements-completed: [EXEC-01, PIPE-07]

# Metrics
duration: 8min
completed: 2026-03-18
---

# Phase 5 Plan 2: PipelineRunner Parallel Execution Summary

**PipelineRunner refactored for parallel group dispatch with worktree isolation and ordered merge queue integration**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-18T17:16:52Z
- **Completed:** 2026-03-18T17:25:01Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- PipelineRunner starts ALL phases in first execution group simultaneously (not just the first one)
- Agent spawn methods use worktree paths for parallel phase isolation
- Completed phases enqueue in MergeQueue for roadmap-order merging
- Failed phases marked in MergeQueue to unblock later merges (including cascade failures)
- findReadyPhases uses dependency analysis to start newly-unblocked phases after completion
- Sequential plans (all groups of size 1) behave identically to Phase 4 behavior
- 16 pipeline-runner tests pass (6 new parallel tests added), 377 total tests project-wide

## Task Commits

Each task was committed atomically (TDD: test then feat):

1. **Task 1: Parallel execution with worktree integration (TDD)**
   - `dafbd9c` (test) - Add failing tests for parallel execution
   - `ace7283` (feat) - Implement parallel execution in PipelineRunner
2. **Task 2: Barrel export and full verification**
   - `374c7e2` (chore) - Update barrel export, fix import ordering

_Note: TDD tasks have RED (test) then GREEN (feat) commits_

## Files Created/Modified
- `src/orchestrator/pipeline-runner.ts` - Parallel group dispatch, worktree integration, merge queue, findReadyPhases, derivePhaseInputs (981 lines, +99 from Phase 4)
- `src/orchestrator/pipeline-runner.test.ts` - 6 new parallel execution tests added to existing suite (1270 lines, +413 from Phase 4)
- `src/orchestrator/index.ts` - Barrel export with WorktreeManager, WorktreeInfo, MergeQueue (47 lines)

## Decisions Made
- Derived phaseInputs from execution plan groups instead of hardcoding -- ensures dependency tracking matches the actual execution plan regardless of how buildExecutionPlan is configured (or mocked in tests)
- derivePhaseInputs: phases in group N depend on all phases in group N-1 (immediate predecessor group). This is the correct inverse of how the resolver groups phases
- Fire-and-forget `void cleanupAll().catch()` in destroy() to avoid changing the sync API signature used by callers
- MergeQueue onMerge callback chains mergePhase then removeWorktree for immediate cleanup after each phase merges

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed phaseInputs derivation from execution plan groups**
- **Found during:** Task 1 (dependent phase waits test failing)
- **Issue:** Hardcoded sequential phaseInputs in handleProjectReady didn't match mocked parallel execution plan, causing findReadyPhases to use wrong dependency data
- **Fix:** Added derivePhaseInputs() that extracts dependency relationships from execution plan groups, ensuring phaseInputs always match the actual plan
- **Files modified:** src/orchestrator/pipeline-runner.ts
- **Verification:** All 16 pipeline-runner tests pass including dependent-phase-waits
- **Committed in:** ace7283 (Task 1 feat commit)

**2. [Rule 1 - Bug] Fixed test issueId mismatch in merge queue failure test**
- **Found during:** Task 1 (failed phase marked in merge queue test failing)
- **Issue:** Test sent a completion with issueId 'issue-p1-discuss' but phase 1 had 'issue-1' as its activeAgentIssueId (from default spawnAgent mock)
- **Fix:** Updated test to use the correct issueId ('issue-1') that matches the phase's activeAgentIssueId
- **Files modified:** src/orchestrator/pipeline-runner.test.ts
- **Verification:** markFailed test passes, verifies MergeQueue.markFailed called with correct phase number
- **Committed in:** ace7283 (Task 1 feat commit)

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** Both fixes necessary for correct test behavior and implementation alignment. No scope creep.

## Issues Encountered
None beyond the auto-fixed deviations above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 5 is now complete: WorktreeManager (Plan 01) + MergeQueue (Plan 01) + PipelineRunner parallel refactor (Plan 02)
- Full parallel execution pipeline operational: parallel groups start simultaneously, merge in order, handle failures
- Ready for Phase 6 (UX and Polish) which adds the final integration layer

## Self-Check: PASSED

- All 3 modified files exist (pipeline-runner.ts, pipeline-runner.test.ts, index.ts)
- All 3 task commits verified (dafbd9c, ace7283, 374c7e2)
- pipeline-runner.test.ts: 1270 lines (min: 200)
- 16 pipeline-runner tests pass (6 new parallel tests)
- 377 total project tests pass, 0 regressions
- TypeScript strict compilation clean
- Biome clean on modified files

---
*Phase: 05-parallel-execution-and-merge-strategy*
*Completed: 2026-03-18*
