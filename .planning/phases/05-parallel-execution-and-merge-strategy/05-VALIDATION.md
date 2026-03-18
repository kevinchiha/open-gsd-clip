---
phase: 5
slug: parallel-execution-and-merge-strategy
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-18
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.x |
| **Config file** | `vitest.config.ts` (exists) |
| **Quick run command** | `npx vitest run src/orchestrator/worktree-manager.test.ts src/orchestrator/merge-queue.test.ts --reporter=verbose` |
| **Full suite command** | `npx vitest run --reporter=verbose` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/orchestrator/ --reporter=verbose`
- **After every plan wave:** Run `npx vitest run --reporter=verbose`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 01 | 1 | EXEC-01 | unit | `npx vitest run src/orchestrator/worktree-manager.test.ts -t "create" -x` | ❌ W0 | ⬜ pending |
| 05-01-02 | 01 | 1 | PIPE-07 | unit | `npx vitest run src/orchestrator/worktree-manager.test.ts -t "merge" -x` | ❌ W0 | ⬜ pending |
| 05-01-03 | 01 | 1 | PIPE-07 | unit | `npx vitest run src/orchestrator/worktree-manager.test.ts -t "remove" -x` | ❌ W0 | ⬜ pending |
| 05-01-04 | 01 | 1 | PIPE-07 | unit | `npx vitest run src/orchestrator/worktree-manager.test.ts -t "prune" -x` | ❌ W0 | ⬜ pending |
| 05-02-01 | 02 | 1 | PIPE-07 | unit | `npx vitest run src/orchestrator/merge-queue.test.ts -t "order" -x` | ❌ W0 | ⬜ pending |
| 05-02-02 | 02 | 1 | PIPE-07 | unit | `npx vitest run src/orchestrator/merge-queue.test.ts -t "failed" -x` | ❌ W0 | ⬜ pending |
| 05-02-03 | 02 | 1 | PIPE-07 | unit | `npx vitest run src/orchestrator/merge-queue.test.ts -t "complete" -x` | ❌ W0 | ⬜ pending |
| 05-03-01 | 03 | 2 | EXEC-01 | unit | `npx vitest run src/orchestrator/pipeline-runner.test.ts -t "parallel" -x` | ❌ W0 | ⬜ pending |
| 05-03-02 | 03 | 2 | EXEC-01 | unit | `npx vitest run src/orchestrator/pipeline-runner.test.ts -t "dependent" -x` | ❌ W0 | ⬜ pending |
| 05-03-03 | 03 | 2 | PIPE-07 | unit | `npx vitest run src/orchestrator/pipeline-runner.test.ts -t "mixed" -x` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/orchestrator/worktree-manager.test.ts` — stubs for EXEC-01, PIPE-07 worktree lifecycle
- [ ] `src/orchestrator/merge-queue.test.ts` — stubs for PIPE-07 ordered merging
- [ ] `src/orchestrator/pipeline-runner.test.ts` (modify) — add parallel execution test stubs

*Existing infrastructure covers test framework — vitest is already configured.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Paperclip `isolated` mode with worktrees | EXEC-01 | Requires live Paperclip agent | Create a worktree, spawn Paperclip agent with `mode: 'isolated'` and `cwd` set to worktree path, verify agent operates correctly |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
