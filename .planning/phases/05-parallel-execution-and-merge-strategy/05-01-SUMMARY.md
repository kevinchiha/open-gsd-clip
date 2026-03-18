---
phase: 05-parallel-execution-and-merge-strategy
plan: 01
subsystem: orchestrator
tags: [git-worktree, merge-queue, parallel-execution, execa]

# Dependency graph
requires:
  - phase: 04-sequential-pipeline-execution
    provides: PipelineRunner, error-handler, health-monitor infrastructure
provides:
  - WorktreeManager for git worktree lifecycle (create, merge, remove, prune)
  - MergeQueue for ordered merge with skip-on-failure
affects: [05-02 (PipelineRunner parallel refactor)]

# Tech tracking
tech-stack:
  added: []
  patterns: [worktree-per-phase isolation, ordered merge queue with skip-on-failure, stale-state cleanup on init]

key-files:
  created:
    - src/orchestrator/worktree-manager.ts
    - src/orchestrator/worktree-manager.test.ts
    - src/orchestrator/merge-queue.ts
    - src/orchestrator/merge-queue.test.ts
  modified: []

key-decisions:
  - "Mock type casting via `as unknown as Mock` for execa -- execa's ResultPromise type is too complex for vi.mocked"
  - "Index-based drain pointer in MergeQueue instead of phase-number tracking -- simpler, handles edge cases naturally"
  - "Stale branch cleanup before worktree creation handles Pitfall 1 (interrupted runs)"

patterns-established:
  - "Worktree-per-phase: each parallel phase gets gsd/phase-{N} branch in ../.gsd-worktrees/phase-{N}"
  - "Merge queue drain: iterate mergeOrder, skip failed, merge completed, break on not-ready"
  - "Best-effort cleanup: cleanupAll catches individual failures to ensure maximum cleanup"

requirements-completed: [EXEC-01, PIPE-07]

# Metrics
duration: 6min
completed: 2026-03-18
---

# Phase 5 Plan 1: WorktreeManager and MergeQueue Summary

**Git worktree lifecycle manager and ordered merge queue for parallel phase execution via execa**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-18T17:08:15Z
- **Completed:** 2026-03-18T17:13:47Z
- **Tasks:** 2
- **Files created:** 4

## Accomplishments
- WorktreeManager wraps git worktree create/merge/remove/prune operations via execa
- WorktreeManager handles stale worktrees from interrupted runs (Pitfall 1, 5 from research)
- MergeQueue drains in roadmap order regardless of completion order (Pitfall 2 from research)
- MergeQueue skips failed phases to prevent deadlock (Pitfall 4 from research)
- 27 tests all passing (18 worktree-manager + 9 merge-queue), TypeScript strict mode clean

## Task Commits

Each task was committed atomically (TDD: test then feat):

1. **Task 1: WorktreeManager -- git worktree lifecycle**
   - `9cd236f` (test) - Failing tests for WorktreeManager
   - `5fba58e` (feat) - Implement WorktreeManager
2. **Task 2: MergeQueue -- ordered merge with skip-on-failure**
   - `8d5ec19` (test) - Failing tests for MergeQueue
   - `c92f1cc` (feat) - Implement MergeQueue + fix test types for tsc

_Note: TDD tasks have RED (test) then GREEN (feat) commits_

## Files Created/Modified
- `src/orchestrator/worktree-manager.ts` - Git worktree lifecycle: create, merge, remove, prune, cleanupAll, hasParallelPhases (209 lines)
- `src/orchestrator/worktree-manager.test.ts` - 18 tests covering all worktree operations (313 lines)
- `src/orchestrator/merge-queue.ts` - Ordered merge queue with skip-on-failure drain loop (128 lines)
- `src/orchestrator/merge-queue.test.ts` - 9 tests covering in-order, out-of-order, skip, edge cases (151 lines)

## Decisions Made
- Used `as unknown as Mock` for execa mock type in tests -- execa 9.x returns ResultPromise which is too complex for vi.mocked to type correctly
- MergeQueue uses index-based pointer into mergeOrder array instead of tracking phase numbers -- naturally handles empty mergeOrder (index 0 >= length 0 -> set to -1 -> immediately complete)
- Stale branch check before createWorktree: `git branch --list gsd/phase-{N}` then cleanup if found -- handles Pitfall 1 from research

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TypeScript strict compilation errors in test file**
- **Found during:** Task 2 verification (tsc --noEmit)
- **Issue:** execa's complex ResultPromise type caused TS2493 (tuple length) and TS2345 (mockImplementation signature) errors
- **Fix:** Changed mock typing from `vi.mocked(execa)` to `execa as unknown as Mock`, removed `as never` casts, added helper function `findCall` for cleaner call assertions
- **Files modified:** src/orchestrator/worktree-manager.test.ts
- **Verification:** `tsc --noEmit` passes clean
- **Committed in:** c92f1cc (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Type fix necessary for strict TypeScript compilation. No scope creep.

## Issues Encountered
None -- plan executed smoothly with TDD RED/GREEN flow.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- WorktreeManager and MergeQueue are ready for Plan 2 (PipelineRunner parallel refactor)
- WorktreeManager exports: `WorktreeManager`, `WorktreeInfo`
- MergeQueue exports: `MergeQueue`
- Both modules use createChildLogger for structured logging (pino, stderr-only)

## Self-Check: PASSED

- All 4 source/test files exist
- All 4 task commits verified (9cd236f, 5fba58e, 8d5ec19, c92f1cc)
- worktree-manager.test.ts: 313 lines (min: 80)
- merge-queue.test.ts: 151 lines (min: 60)
- 90 orchestrator tests pass, 0 regressions
- TypeScript strict compilation clean

---
*Phase: 05-parallel-execution-and-merge-strategy*
*Completed: 2026-03-18*
