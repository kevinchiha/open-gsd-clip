---
phase: 2
slug: pipeline-state-machine
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-18
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.x |
| **Config file** | vitest.config.ts (created in Phase 1 or Wave 0) |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run --reporter=verbose --coverage` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run --reporter=verbose --coverage`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| (populated by planner) | | | PIPE-02 | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| (populated by planner) | | | PIPE-06 | unit | `npx vitest run` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/pipeline/fsm.test.ts` — stubs for PIPE-02 (pipeline FSM transitions)
- [ ] `src/pipeline/phase-fsm.test.ts` — stubs for PIPE-02 (per-phase sub-state transitions)
- [ ] `src/pipeline/dependency-resolver.test.ts` — stubs for PIPE-06 (dependency resolution, cycle detection)
- [ ] `src/pipeline/serialization.test.ts` — stubs for PIPE-02 (state serialization/deserialization)
- [ ] vitest configuration if not already present from Phase 1

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| (none expected) | | | |

*All phase behaviors have automated verification — FSM is pure logic.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
