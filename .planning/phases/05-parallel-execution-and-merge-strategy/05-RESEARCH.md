# Phase 5: Parallel Execution and Merge Strategy - Research

**Researched:** 2026-03-18
**Domain:** Git worktrees, parallel orchestration, sequential merge ordering, PipelineRunner refactoring
**Confidence:** HIGH

## Summary

Phase 5 transforms the sequential pipeline runner from Phase 4 into a parallel executor. The core challenge is: when the execution plan groups independent phases (e.g., `groups: [[1, 3], [2], [4]]`), all phases in a group should execute concurrently -- each in its own git worktree -- while completed results merge into main in roadmap order (not completion order) to prevent git conflicts.

The dependency resolver (`buildExecutionPlan`) already produces parallel execution groups via Kahn's algorithm (Phase 2). The PipelineRunner already drives phases through the discuss-review-plan-execute-verify loop (Phase 4). Phase 5's job is to: (1) create and manage git worktrees for parallel phases, (2) refactor `onPhaseComplete` to start ALL ready phases in a group instead of just the next sequential one, and (3) implement a merge queue that holds completed phase results and merges them into main in roadmap order regardless of when they finish.

No new npm dependencies are needed. The project already has `execa` (used by the bridge executor) for running git commands programmatically. Git worktrees are a built-in git feature available in git 2.5+. The only new code is: a `WorktreeManager` for lifecycle management (create/merge/cleanup), a `MergeQueue` for ordered merging, and modifications to PipelineRunner to parallelize group execution.

**Primary recommendation:** Build a `src/orchestrator/worktree-manager.ts` that wraps git worktree commands via execa, a `src/orchestrator/merge-queue.ts` that holds completed results and merges in order, and modify `PipelineRunner` to start all phases in a group simultaneously and use worktrees for isolation.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| EXEC-01 | Independent phases execute in parallel when roadmap allows | `buildExecutionPlan` already produces parallel groups. PipelineRunner.onPhaseComplete needs refactoring: when a phase completes, check if ALL dependencies for waiting phases are met, and start all newly-unblocked phases simultaneously (not just the next one). Each parallel phase gets its own git worktree for isolation. |
| PIPE-07 | Sequential merge strategy ensures parallel phases commit results in roadmap order without git conflicts | MergeQueue holds completed worktree branches. When a phase finishes, it enqueues its branch. A drain loop merges branches into main in phaseOrder sequence -- if phase 3 finishes before phase 1, phase 3's merge waits until phase 1's merge completes. Uses `git merge --no-ff` for clear merge history. |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| execa | 9.6.x | Execute git worktree/merge commands programmatically | Already installed, used by bridge/executor.ts |
| TypeScript | 5.8.x | Language | Already installed |
| pino | 9.x | Structured logging for worktree and merge operations | Already installed |
| node:path | built-in | Construct worktree paths | Standard Node.js |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| node:fs/promises | built-in | Check worktree directory existence, cleanup | Before/after worktree operations |
| node:os | built-in | tmpdir for worktree base path if needed | Fallback worktree location |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| execa for git commands | simple-git npm package | simple-git has worktree support but adds a dependency; execa is already installed and git CLI is simple enough to wrap directly |
| Git worktrees | Separate git clones per phase | Clones duplicate the repo data; worktrees share the object database, are faster to create, and share refs |
| `git merge --no-ff` | `git cherry-pick` range | Merge preserves branch context and is simpler; cherry-pick can lose merge metadata and requires commit range tracking |
| Custom merge queue | GitHub merge queue | GitHub merge queue is a hosted CI feature; this is local orchestration with no external service |

**Installation:**

No new packages needed. Phase 5 uses only existing dependencies.

## Architecture Patterns

### Recommended Project Structure

```
src/
  orchestrator/
    worktree-manager.ts       # Git worktree lifecycle: create, merge, cleanup
    worktree-manager.test.ts  # Tests for worktree operations
    merge-queue.ts            # Ordered merge queue: holds results, drains in order
    merge-queue.test.ts       # Tests for merge ordering
    pipeline-runner.ts        # MODIFIED: parallel group execution, worktree integration
    pipeline-runner.test.ts   # MODIFIED: parallel execution tests added
    ...                       # Existing orchestrator files unchanged
```

### Pattern 1: Worktree-Per-Phase Isolation

**What:** Each parallel phase gets its own git worktree branching from the current main HEAD. The worktree is created before the phase starts and provides a fully isolated working directory. The branch name follows a convention: `gsd/phase-{N}`. The worktree path is placed alongside the project root: `{projectRoot}/../.gsd-worktrees/phase-{N}`.

**When to use:** Whenever a phase starts and there are other phases running concurrently. For sequential phases (group size = 1), worktree creation is optional but should still be used for consistency.

**Example:**

```typescript
// src/orchestrator/worktree-manager.ts

import { execa } from 'execa';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { createChildLogger } from '../shared/logger.js';

const log = createChildLogger('worktree-manager');

export interface WorktreeInfo {
  phaseNumber: number;
  branchName: string;
  worktreePath: string;
}

export class WorktreeManager {
  private readonly projectPath: string;
  private readonly worktreeBase: string;
  private readonly activeWorktrees = new Map<number, WorktreeInfo>();

  constructor(projectPath: string) {
    this.projectPath = projectPath;
    // Place worktrees alongside the project to avoid nesting
    this.worktreeBase = path.join(
      path.dirname(projectPath),
      '.gsd-worktrees',
    );
  }

  /**
   * Create a worktree for a phase, branching from current HEAD.
   */
  async createWorktree(phaseNumber: number): Promise<WorktreeInfo> {
    const branchName = `gsd/phase-${phaseNumber}`;
    const worktreePath = path.join(this.worktreeBase, `phase-${phaseNumber}`);

    // Ensure base directory exists
    await fs.mkdir(this.worktreeBase, { recursive: true });

    // Create worktree with new branch from HEAD
    await execa('git', ['worktree', 'add', '-b', branchName, worktreePath], {
      cwd: this.projectPath,
    });

    const info: WorktreeInfo = { phaseNumber, branchName, worktreePath };
    this.activeWorktrees.set(phaseNumber, info);

    log.info({ phaseNumber, branchName, worktreePath }, 'Worktree created');
    return info;
  }

  /**
   * Merge a phase branch into main in the main worktree.
   */
  async mergePhase(phaseNumber: number): Promise<void> {
    const info = this.activeWorktrees.get(phaseNumber);
    if (!info) throw new Error(`No worktree for phase ${phaseNumber}`);

    await execa(
      'git',
      ['merge', '--no-ff', '-m', `Merge phase ${phaseNumber}`, info.branchName],
      { cwd: this.projectPath },
    );

    log.info({ phaseNumber, branchName: info.branchName }, 'Phase merged');
  }

  /**
   * Remove a worktree and delete its branch.
   */
  async removeWorktree(phaseNumber: number): Promise<void> {
    const info = this.activeWorktrees.get(phaseNumber);
    if (!info) return;

    await execa('git', ['worktree', 'remove', info.worktreePath, '--force'], {
      cwd: this.projectPath,
    });
    await execa('git', ['branch', '-d', info.branchName], {
      cwd: this.projectPath,
    });

    this.activeWorktrees.delete(phaseNumber);
    log.info({ phaseNumber }, 'Worktree removed');
  }

  /**
   * Get the working directory for a phase (worktree path if parallel, project path if not).
   */
  getWorkingDirectory(phaseNumber: number): string {
    const info = this.activeWorktrees.get(phaseNumber);
    return info?.worktreePath ?? this.projectPath;
  }

  /**
   * Clean up all active worktrees (for shutdown or pipeline completion).
   */
  async cleanupAll(): Promise<void> {
    for (const [phaseNumber] of this.activeWorktrees) {
      await this.removeWorktree(phaseNumber).catch((err) => {
        log.warn({ phaseNumber, err }, 'Failed to cleanup worktree');
      });
    }
  }
}
```

### Pattern 2: Ordered Merge Queue

**What:** When a parallel phase completes, its result (branch name) is enqueued in the merge queue. The queue tracks which phases are ready to merge and which are still running. It drains in roadmap order: a phase can only merge when all lower-numbered phases in the same group have already merged. This guarantees conflict-free merges because each merge applies on top of the previous one.

**When to use:** After every PHASE_COMPLETED event, check if the merge queue can drain.

**Example:**

```typescript
// src/orchestrator/merge-queue.ts

import { createChildLogger } from '../shared/logger.js';

const log = createChildLogger('merge-queue');

export class MergeQueue {
  /** Phases that have completed and are waiting to merge. */
  private readonly completed = new Set<number>();
  /** The next phase that should merge (in roadmap order). */
  private nextToMerge: number;
  /** Full ordered list of phases for this group. */
  private readonly mergeOrder: number[];
  /** Callback to perform the actual merge. */
  private readonly onMerge: (phaseNumber: number) => Promise<void>;

  constructor(
    mergeOrder: number[],
    onMerge: (phaseNumber: number) => Promise<void>,
  ) {
    this.mergeOrder = mergeOrder;
    this.nextToMerge = mergeOrder[0] ?? 0;
    this.onMerge = onMerge;
  }

  /**
   * Mark a phase as completed and attempt to drain.
   */
  async enqueue(phaseNumber: number): Promise<void> {
    this.completed.add(phaseNumber);
    log.info({ phaseNumber, nextToMerge: this.nextToMerge }, 'Phase enqueued for merge');
    await this.drain();
  }

  /**
   * Drain all phases that can be merged in order.
   */
  private async drain(): Promise<void> {
    for (const phase of this.mergeOrder) {
      if (phase < this.nextToMerge) continue; // Already merged
      if (!this.completed.has(phase)) break;  // Not ready yet -- stop

      await this.onMerge(phase);
      this.completed.delete(phase);
      // Advance pointer
      const idx = this.mergeOrder.indexOf(phase);
      this.nextToMerge = this.mergeOrder[idx + 1] ?? -1;

      log.info({ merged: phase, nextToMerge: this.nextToMerge }, 'Phase merged in order');
    }
  }

  /**
   * Check if all phases have been merged.
   */
  isComplete(): boolean {
    return this.nextToMerge === -1;
  }
}
```

### Pattern 3: Parallel Group Execution in PipelineRunner

**What:** The current PipelineRunner processes phases one at a time: `onPhaseComplete` finds the next pending phase and starts it. For Phase 5, this changes: when a phase completes, check ALL pending phases to see if their dependencies are now met, and start all unblocked phases simultaneously. Each parallel phase uses a worktree for isolation.

**Key changes to PipelineRunner:**
1. Add `WorktreeManager` as a dependency
2. Add `MergeQueue` instances per execution group
3. Refactor `handleProjectReady` to start ALL phases in the first group (not just the first one)
4. Refactor `onPhaseComplete` to: (a) enqueue in merge queue, (b) after merge, check all pending phases for unblocked dependencies, (c) start all newly-unblocked phases
5. Modify agent spawning to pass the worktree path as the working directory

**When to use:** Always -- the new behavior subsumes sequential execution (a sequential plan produces groups of size 1, which behaves identically to Phase 4).

**Example:**

```typescript
// Key changes in PipelineRunner (pseudo-code for planning):

// In handleProjectReady, after building execution plan:
// Start ALL phases in the first group, not just the first one
for (const phaseNumber of executionPlan.groups[0]) {
  await this.startPhase(phaseNumber);
}

// New method: startPhase (handles worktree creation + DEPENDENCIES_MET)
private async startPhase(phaseNumber: number): Promise<void> {
  // Create worktree if there are parallel phases
  if (this.hasParallelPhases()) {
    await this.worktreeManager.createWorktree(phaseNumber);
  }
  await this.handlePhaseEvent(phaseNumber, { type: 'DEPENDENCIES_MET' });
}

// In onPhaseComplete, replace sequential "find next pending":
private async onPhaseComplete(phaseNumber: number): Promise<void> {
  // 1. Enqueue completed phase in merge queue
  await this.mergeQueue.enqueue(phaseNumber);

  // 2. Cleanup worktree after merge
  await this.worktreeManager.removeWorktree(phaseNumber);

  // 3. Check if all phases done
  if (this.allPhasesDone()) {
    // transition to completed
    return;
  }

  // 4. Find all pending phases whose dependencies are now met
  const readyPhases = this.findReadyPhases();
  for (const ready of readyPhases) {
    await this.startPhase(ready);
  }
}
```

### Pattern 4: Agent Working Directory Override

**What:** When spawning an agent for a phase running in a worktree, the agent must operate in the worktree path, not the main project path. The `executionWorkspaceSettings.mode` stays `'isolated'` (Paperclip creates its own isolation on top), but the `cwd` in the agent's context points to the worktree.

**When to use:** In every agent spawn method (spawnDiscusser, spawnPlanner, spawnExecutor, spawnVerifier) when the phase has a worktree.

**Example:**

```typescript
// Modified agent spawn: use worktree path as the working directory
private async spawnDiscusser(phaseNumber: number): Promise<void> {
  const projectPath = this.worktreeManager.getWorkingDirectory(phaseNumber);

  const spawn = await retryWithBackoff(
    () =>
      spawnAgent(
        this.services,
        this.companyId,
        this.agents!.discusser.agentId,
        {
          role: 'discusser',
          projectPath, // <-- worktree path instead of main project path
          phaseNumber,
          gsdCommand: `/gsd:discuss-phase ${phaseNumber} --auto`,
        },
      ),
    this.config.retry,
  );

  await this.setAgentOnPhase(phaseNumber, spawn.issueId, spawn.runId);
}
```

### Anti-Patterns to Avoid

- **Checking out the same branch in multiple worktrees:** Git prohibits this. Each worktree must have a unique branch. Use `gsd/phase-{N}` naming convention.
- **Merging in completion order:** If phase 3 finishes before phase 1, merging phase 3 first creates a divergent history. Always merge in roadmap order.
- **Running git operations on the main worktree while parallel phases are active:** The main worktree should remain on main branch and only perform merge operations. Never run GSD commands in the main worktree during parallel execution.
- **Nested worktrees:** Worktree paths must be OUTSIDE the main project directory. Place them in a sibling directory like `../.gsd-worktrees/`.
- **Forgetting worktree cleanup:** If the pipeline fails or is interrupted, stale worktrees block future runs (can't create a branch that's checked out elsewhere). Always clean up in error handlers and shutdown.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Parallel execution groups | Custom dependency analysis | `buildExecutionPlan()` from Phase 2 resolver | Already produces correct groups via Kahn's algorithm |
| Phase FSM transitions | Custom state tracking | `phaseTransition()` + `pipelineTransition()` from Phase 2 | Pure functions already validate all transitions |
| Agent spawning | New spawn mechanism | `spawnAgent()` from Phase 3 invoker | Already handles Paperclip API calls with isolated workspaces |
| Exponential backoff | New retry logic | `retryWithBackoff()` from Phase 4 error handler | Already has full jitter, configurable limits |
| Serial event processing | Custom concurrency control | `SerialEventQueue` from Phase 4 | Already prevents race conditions between events |
| Failure cascade | Manual dependent tracking | `cascadeFailure()` from Phase 2 FSM | BFS cascade already handles diamond dependencies |
| Git command execution | `node:child_process` wrapper | `execa` (already installed) | Promise-based, timeout support, better error handling |

**Key insight:** Phase 5 adds exactly two new capabilities: (1) git worktree lifecycle management and (2) ordered merge queueing. Everything else -- execution plan, FSM transitions, agent spawning, error recovery -- is reused from Phases 2-4. The primary work is refactoring PipelineRunner to dispatch multiple phases per group and route each to its worktree.

## Common Pitfalls

### Pitfall 1: Worktree Branch Already Exists

**What goes wrong:** `git worktree add -b gsd/phase-3` fails because the branch already exists from a previous (failed or interrupted) run.
**Why it happens:** Pipeline crashed after creating the worktree but before cleaning it up. Or a retry creates a worktree for a phase that already has one.
**How to avoid:** Before creating a worktree, check if the branch exists (`git branch --list gsd/phase-{N}`). If it does, delete the stale branch first. Also add cleanup in the `WorktreeManager.createWorktree` method that first tries to remove any existing worktree/branch for that phase.
**Warning signs:** `fatal: a branch named 'gsd/phase-3' already exists` error from git.

### Pitfall 2: Merge Conflicts Between Parallel Phases

**What goes wrong:** Phase 1 and Phase 3 both modify the same file (e.g., `package.json` or `src/index.ts`). When merging in order (1 then 3), phase 3's merge conflicts with phase 1's changes.
**Why it happens:** The GSD roadmap declares phases as independent, but they touch overlapping files.
**How to avoid:** (1) The dependency resolver should catch true dependencies via the roadmap. (2) For residual conflicts, the error handler already classifies `merge_conflict` errors. (3) On merge conflict, abort the merge, update the worktree branch via rebase from main, and re-execute the phase. This is handled by the existing `RETRY_PHASE` mechanism.
**Warning signs:** `git merge` exits non-zero with conflict markers. Error handler classifies as `merge_conflict`.

### Pitfall 3: Main Worktree State Corruption During Parallel Execution

**What goes wrong:** An agent or GSD command runs in the main worktree while parallel phases are active, modifying files that parallel branches expect to be stable.
**Why it happens:** Agent spawn with `projectPath` pointing to main instead of the worktree.
**How to avoid:** ALL agent spawns during parallel execution must use the worktree path from `WorktreeManager.getWorkingDirectory(phaseNumber)`. The main worktree should only be used for merge operations.
**Warning signs:** Agents report unexpected file changes or failures reading expected state files.

### Pitfall 4: Merge Queue Deadlock

**What goes wrong:** Phase 1 fails, phase 3 completes, but phase 3 can never merge because phase 1 will never complete. The merge queue blocks forever.
**Why it happens:** The merge queue waits for phases in order, but a failed phase will never be enqueued.
**How to avoid:** When a phase fails, mark it as "skipped" in the merge queue so the queue can advance past it. The failure cascade already handles dependent phases; the merge queue just needs to know that a failed phase should be skipped.
**Warning signs:** Pipeline has completed/failed phases but the merge queue never drains.

### Pitfall 5: Stale Worktree Prevents Subsequent Runs

**What goes wrong:** After an interrupted run, `git worktree add` refuses to create a worktree because the old one still references a locked branch.
**Why it happens:** `git worktree remove` was never called due to a crash, and `git worktree prune` was not run.
**How to avoid:** On pipeline startup, run `git worktree prune` to clean stale references. In `WorktreeManager` constructor or `init()`, prune stale worktrees before creating new ones. Also implement `cleanupAll()` called from `PipelineRunner.destroy()`.
**Warning signs:** `fatal: 'gsd/phase-X' is already checked out` when starting a new pipeline run.

### Pitfall 6: Worktree Out of Sync After Earlier Phase Merge

**What goes wrong:** Phase 3's worktree was created from HEAD at pipeline start. Phase 1 completes and merges into main, adding new files. Phase 3's worktree doesn't see those changes.
**Why it happens:** Worktrees branch from the HEAD at creation time. Later merges to main don't propagate.
**How to avoid:** This is actually the DESIRED behavior for independent phases. Since phases are independent (no dependency), they should not need each other's changes. If they do, the roadmap dependencies are wrong. For dependent phases (which run after the group completes), the next group's worktrees are created after all merges from the current group are done, so they see the latest state.
**Warning signs:** Only a real problem if the roadmap incorrectly declares phases as independent.

## Code Examples

### Checking Dependencies Are Met

```typescript
// Helper to determine which pending phases can now start
function findReadyPhases(
  state: PipelineState,
  executionPlan: ExecutionPlan,
  phaseInputs: PhaseInput[],
): number[] {
  const ready: number[] = [];
  const donePhases = new Set(
    state.phases
      .filter((p) => p.status === 'done')
      .map((p) => p.phaseNumber),
  );

  for (const phase of state.phases) {
    if (phase.status !== 'pending') continue;

    const input = phaseInputs.find((p) => p.phaseNumber === phase.phaseNumber);
    if (!input) continue;

    const allDepsMet = input.dependsOn.every((dep) => donePhases.has(dep));
    if (allDepsMet) {
      ready.push(phase.phaseNumber);
    }
  }

  return ready.sort((a, b) => a - b);
}
```

### Merge Queue with Skip-on-Failure

```typescript
// Extended MergeQueue that handles failed phases
async markFailed(phaseNumber: number): Promise<void> {
  // Remove from expected merges, advance pointer if needed
  const idx = this.mergeOrder.indexOf(phaseNumber);
  if (idx !== -1) {
    this.skipped.add(phaseNumber);
    log.info({ phaseNumber }, 'Phase marked as failed in merge queue');
    await this.drain(); // May unblock subsequent merges
  }
}

private async drain(): Promise<void> {
  for (const phase of this.mergeOrder) {
    if (phase < this.nextToMerge) continue;
    if (this.skipped.has(phase)) {
      // Skip failed phase, advance pointer
      const idx = this.mergeOrder.indexOf(phase);
      this.nextToMerge = this.mergeOrder[idx + 1] ?? -1;
      continue;
    }
    if (!this.completed.has(phase)) break;

    await this.onMerge(phase);
    this.completed.delete(phase);
    const idx = this.mergeOrder.indexOf(phase);
    this.nextToMerge = this.mergeOrder[idx + 1] ?? -1;
  }
}
```

### Git Worktree Prune on Startup

```typescript
// Called during WorktreeManager initialization
async pruneStaleWorktrees(): Promise<void> {
  await execa('git', ['worktree', 'prune'], { cwd: this.projectPath });
  log.info('Pruned stale worktrees');

  // Also clean up any leftover gsd/phase-* branches not in active worktrees
  const { stdout } = await execa(
    'git', ['branch', '--list', 'gsd/phase-*'],
    { cwd: this.projectPath },
  );
  const staleBranches = stdout
    .split('\n')
    .map((b) => b.trim())
    .filter(Boolean);

  for (const branch of staleBranches) {
    await execa('git', ['branch', '-D', branch], { cwd: this.projectPath })
      .catch(() => { /* ignore -- branch might be in use */ });
  }
}
```

### PipelineRunner Integration Point

```typescript
// Modified handleProjectReady -- start all phases in first group
private async handleProjectReady(): Promise<void> {
  // ... existing analysis code ...

  // Initialize worktree manager
  this.worktreeManager = new WorktreeManager(this.state.projectPath);
  await this.worktreeManager.pruneStaleWorktrees();

  // Store phase inputs for dependency checking
  this.phaseInputs = phaseInputs;

  // Create merge queue for full phase order
  this.mergeQueue = new MergeQueue(
    executionPlan.phaseOrder,
    async (phaseNumber) => {
      await this.worktreeManager!.mergePhase(phaseNumber);
      await this.worktreeManager!.removeWorktree(phaseNumber);
    },
  );

  // Start ALL phases in the first execution group
  const firstGroup = executionPlan.groups[0] ?? [];
  for (const phaseNumber of firstGroup) {
    await this.startPhase(phaseNumber);
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Sequential phase execution | Parallel execution groups from DAG resolver | Phase 5 (this phase) | Multiple independent phases run simultaneously, reducing total pipeline time |
| Single working directory | Git worktree per parallel phase | Phase 5 (this phase) | Agents don't interfere with each other's file system state |
| Merge on completion | Ordered merge queue | Phase 5 (this phase) | Deterministic merge order prevents conflicts from non-deterministic completion |
| Phase 4 PipelineRunner | Refactored PipelineRunner with parallel dispatch | Phase 5 (this phase) | Backward-compatible: sequential plans (group size 1) behave identically |

**Deprecated/outdated:**
- Phase 4's sequential `onPhaseComplete` logic (finding "next pending phase") is replaced by dependency-aware "find all ready phases" logic.

## Open Questions

1. **Paperclip `isolated` mode interaction with worktrees**
   - What we know: Paperclip's `executionWorkspaceSettings: { mode: 'isolated' }` creates its own git worktree for agent execution. Our worktree provides the base project directory; Paperclip may nest another worktree inside.
   - What's unclear: Whether Paperclip's isolation creates a worktree-from-a-worktree (which git supports) or if it uses a different mechanism. The STATE.md blocker notes: "Git worktree compatibility with Paperclip's claude_local adapter needs empirical validation in Phase 5."
   - Recommendation: For now, implement with `mode: 'isolated'` and set `cwd` to the worktree path. If Paperclip's isolation fails from a worktree, fall back to `mode: 'project_primary'` since our worktree already provides isolation. Flag this for empirical testing during execution.

2. **Worktree base directory location**
   - What we know: Worktrees must be outside the main project directory to avoid nesting confusion. A sibling directory like `../.gsd-worktrees/` is clean.
   - What's unclear: Whether the target project's parent directory is always writable (e.g., if the project is at the root of a mount).
   - Recommendation: Default to `path.join(path.dirname(projectPath), '.gsd-worktrees')`. Allow override via `OrchestratorConfig`. Fall back to `os.tmpdir()` if the default fails.

3. **PhaseInput storage for dependency checking at runtime**
   - What we know: `buildExecutionPlan` takes `PhaseInput[]` and returns `ExecutionPlan` (groups + phaseOrder). But the `ExecutionPlan` type doesn't store the original dependency information -- only the computed groups.
   - What's unclear: When checking "are all dependencies met for phase X?", we need the original `dependsOn` data.
   - Recommendation: Store the `PhaseInput[]` array on PipelineRunner (or on PipelineState) alongside the `ExecutionPlan`. This is a small addition to the state model.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 3.x |
| Config file | `vitest.config.ts` (exists) |
| Quick run command | `npx vitest run src/orchestrator/worktree-manager.test.ts src/orchestrator/merge-queue.test.ts --reporter=verbose` |
| Full suite command | `npx vitest run --reporter=verbose` |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EXEC-01 | Independent phases start simultaneously when group has >1 phase | unit | `npx vitest run src/orchestrator/pipeline-runner.test.ts -t "parallel" -x` | Wave 0 (modify existing) |
| EXEC-01 | Worktree created per parallel phase with unique branch | unit | `npx vitest run src/orchestrator/worktree-manager.test.ts -t "create" -x` | Wave 0 |
| EXEC-01 | Dependent phases wait for dependencies to complete | unit | `npx vitest run src/orchestrator/pipeline-runner.test.ts -t "dependent" -x` | Wave 0 (modify existing) |
| PIPE-07 | Phase results merge in roadmap order regardless of completion order | unit | `npx vitest run src/orchestrator/merge-queue.test.ts -t "order" -x` | Wave 0 |
| PIPE-07 | Failed phase skipped in merge queue, unblocking later merges | unit | `npx vitest run src/orchestrator/merge-queue.test.ts -t "failed" -x` | Wave 0 |
| PIPE-07 | Worktree cleanup after merge | unit | `npx vitest run src/orchestrator/worktree-manager.test.ts -t "remove" -x` | Wave 0 |
| PIPE-07 | Mixed pipeline (independent + dependent) correctly parallelizes and sequences | unit | `npx vitest run src/orchestrator/pipeline-runner.test.ts -t "mixed" -x` | Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run src/orchestrator/ --reporter=verbose`
- **Per wave merge:** `npx vitest run --reporter=verbose`
- **Phase gate:** Full suite green + typecheck before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/orchestrator/worktree-manager.ts` -- git worktree lifecycle (create, merge, remove, prune)
- [ ] `src/orchestrator/worktree-manager.test.ts` -- covers EXEC-01 worktree creation, PIPE-07 merge + cleanup
- [ ] `src/orchestrator/merge-queue.ts` -- ordered merge queue with skip-on-failure
- [ ] `src/orchestrator/merge-queue.test.ts` -- covers PIPE-07 ordered merging, failed phase skipping
- [ ] `src/orchestrator/pipeline-runner.ts` (modify) -- parallel group dispatch, worktree integration
- [ ] `src/orchestrator/pipeline-runner.test.ts` (modify) -- parallel execution, mixed pipeline tests

No test framework gaps -- vitest is already configured.

## Sources

### Primary (HIGH confidence)

- [Existing codebase Phase 2] -- `src/pipeline/resolver.ts`: `buildExecutionPlan()` produces parallel execution groups via Kahn's algorithm. `src/pipeline/types.ts`: `ExecutionPlan` type with `groups: number[][]` and `phaseOrder: number[]`. Directly inspected.
- [Existing codebase Phase 4] -- `src/orchestrator/pipeline-runner.ts`: `PipelineRunner` class with sequential `onPhaseComplete` logic, agent spawning methods, all using `this.state.projectPath`. Directly inspected.
- [Existing codebase Phase 3] -- `src/agents/invoker.ts`: `spawnAgent()` with `executionWorkspaceSettings: { mode: 'isolated' }` and `AgentContext.projectPath` for working directory. Directly inspected.
- [Git official docs](https://git-scm.com/docs/git-worktree) -- git worktree add/remove/list/prune commands, branch uniqueness constraint, shared object database.
- [Existing codebase] -- `src/bridge/executor.ts`: `execa` already installed and used for child process execution with timeout support.

### Secondary (MEDIUM confidence)

- [Nx Blog: Git Worktrees for AI Agents](https://nx.dev/blog/git-worktrees-ai-agents) -- Practical patterns for using worktrees with AI coding agents, worktree-per-task isolation model.
- [d4b: Git Worktrees for Parallel AI Development](https://www.d4b.dev/blog/2026-02-08-git-worktrees-for-parallel-ai-assisted-development) -- Worktree lifecycle management, branch naming conventions, cleanup patterns.
- [Ken Muse: Using Git Worktrees for Concurrent Development](https://www.kenmuse.com/blog/using-git-worktrees-for-concurrent-development/) -- Concurrent operations, lock file handling, branch restrictions.

### Tertiary (LOW confidence)

- [Paperclip GitHub releases](https://github.com/paperclipai/paperclip/releases) -- `execution_workspace_settings` and `execution_workspace_policy` exist in migrations 0026/0027. Exact interaction of `isolated` mode with nested worktrees needs empirical validation.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new packages; execa already installed, git worktree is a stable built-in feature (since git 2.5, 2015)
- Architecture: HIGH -- WorktreeManager and MergeQueue are well-scoped modules. PipelineRunner refactoring is surgical: change `onPhaseComplete` from "find next" to "find all ready", change agent spawn paths to use worktree dirs. All upstream APIs (resolver, FSM, spawner) verified from source.
- Pitfalls: HIGH -- branch uniqueness constraint, merge ordering, stale worktree cleanup, and merge conflict handling all derived from git documentation and codebase constraints
- Merge strategy: HIGH -- sequential merge in roadmap order with skip-on-failure is a straightforward queue pattern. The `--no-ff` flag preserves merge commits for clear history.
- Paperclip worktree interaction: LOW -- empirical validation needed per STATE.md blocker. Code should handle fallback gracefully.

**Research date:** 2026-03-18
**Valid until:** 2026-04-18 (30 days -- git worktrees are a stable feature, Paperclip interaction is the only uncertainty)
