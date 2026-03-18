---
phase: 4
slug: sequential-pipeline-execution
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-18
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.x |
| **Config file** | `vitest.config.ts` (exists) |
| **Quick run command** | `npx vitest run src/orchestrator/ --reporter=verbose` |
| **Full suite command** | `npx vitest run --reporter=verbose` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/orchestrator/ --reporter=verbose`
- **After every plan wave:** Run `npx vitest run --reporter=verbose`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | PIPE-03 | unit | `npx vitest run src/orchestrator/pipeline-runner.test.ts -t "start"` | ❌ W0 | ⬜ pending |
| 04-01-02 | 01 | 1 | PIPE-08 | unit | `npx vitest run src/orchestrator/pipeline-runner.test.ts -t "phase loop"` | ❌ W0 | ⬜ pending |
| 04-01-03 | 01 | 1 | EXEC-05 | unit | `npx vitest run src/orchestrator/pipeline-runner.test.ts -t "retry phase"` | ❌ W0 | ⬜ pending |
| 04-01-04 | 01 | 1 | AGNT-12 | unit | `npx vitest run src/orchestrator/pipeline-runner.test.ts -t "replan"` | ❌ W0 | ⬜ pending |
| 04-02-01 | 02 | 1 | AGNT-08 | unit | `npx vitest run src/orchestrator/quality-gate.test.ts -t "CEO review"` | ❌ W0 | ⬜ pending |
| 04-02-02 | 02 | 1 | AGNT-09 | unit | `npx vitest run src/orchestrator/quality-gate.test.ts -t "revision"` | ❌ W0 | ⬜ pending |
| 04-02-03 | 02 | 1 | AGNT-10 | unit | `npx vitest run src/orchestrator/audit-log.test.ts -t "record"` | ❌ W0 | ⬜ pending |
| 04-03-01 | 03 | 1 | EXEC-02 | unit | `npx vitest run src/orchestrator/error-handler.test.ts -t "classify"` | ❌ W0 | ⬜ pending |
| 04-03-02 | 03 | 1 | EXEC-03 | unit | `npx vitest run src/orchestrator/error-handler.test.ts -t "backoff"` | ❌ W0 | ⬜ pending |
| 04-03-03 | 03 | 1 | EXEC-04 | unit | `npx vitest run src/orchestrator/health-monitor.test.ts -t "stale"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/orchestrator/pipeline-runner.test.ts` — stubs for PIPE-03, PIPE-08, AGNT-12, EXEC-05
- [ ] `src/orchestrator/quality-gate.test.ts` — stubs for AGNT-08, AGNT-09
- [ ] `src/orchestrator/audit-log.test.ts` — stubs for AGNT-10
- [ ] `src/orchestrator/error-handler.test.ts` — stubs for EXEC-02, EXEC-03
- [ ] `src/orchestrator/health-monitor.test.ts` — stubs for EXEC-04

*Existing infrastructure covers test framework — vitest already configured.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| End-to-end pipeline with real agents | PIPE-08 | Requires Paperclip running with configured agents | Start pipeline with test brief, verify all phases complete |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
