---
phase: 6
slug: user-facing-integration
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-18
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.x |
| **Config file** | `vitest.config.ts` (exists) |
| **Quick run command** | `npx vitest run src/api/ src/notifications/ src/orchestrator/token-tracker.test.ts --reporter=verbose` |
| **Full suite command** | `npx vitest run --reporter=verbose` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/api/ src/notifications/ src/orchestrator/token-tracker.test.ts --reporter=verbose`
- **After every plan wave:** Run `npx vitest run --reporter=verbose`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 1 | API-01 | unit | `npx vitest run src/api/actions.test.ts -t "gsd.start" -x` | ❌ W0 | ⬜ pending |
| 06-01-02 | 01 | 1 | API-02 | unit | `npx vitest run src/api/actions.test.ts -t "gsd.status" -x` | ❌ W0 | ⬜ pending |
| 06-01-03 | 01 | 1 | API-03 | unit | `npx vitest run src/api/actions.test.ts -t "gsd.phases" -x` | ❌ W0 | ⬜ pending |
| 06-01-04 | 01 | 1 | API-04 | unit | `npx vitest run src/api/actions.test.ts -t "gsd.retry" -x` | ❌ W0 | ⬜ pending |
| 06-01-05 | 01 | 1 | API-05 | unit | `npx vitest run src/api/actions.test.ts -t "gsd.override" -x` | ❌ W0 | ⬜ pending |
| 06-01-06 | 01 | 1 | API-06 | unit | `npx vitest run src/api/actions.test.ts -t "gsd.pause" -x` | ❌ W0 | ⬜ pending |
| 06-01-07 | 01 | 1 | API-07 | unit | `npx vitest run src/api/actions.test.ts -t "gsd.resume" -x` | ❌ W0 | ⬜ pending |
| 06-02-01 | 02 | 1 | CLAW-02 | unit | `npx vitest run src/notifications/notification-service.test.ts -t "phase_completed" -x` | ❌ W0 | ⬜ pending |
| 06-02-02 | 02 | 1 | CLAW-03 | unit | `npx vitest run src/notifications/notification-service.test.ts -t "escalation" -x` | ❌ W0 | ⬜ pending |
| 06-02-03 | 02 | 1 | OBSV-03 | unit | `npx vitest run src/notifications/preferences.test.ts -t "filter" -x` | ❌ W0 | ⬜ pending |
| 06-02-04 | 02 | 1 | OBSV-02 | unit | `npx vitest run src/notifications/formatters.test.ts -t "progress" -x` | ❌ W0 | ⬜ pending |
| 06-02-05 | 02 | 1 | OBSV-04 | unit | `npx vitest run src/notifications/notification-service.test.ts -t "activity" -x` | ❌ W0 | ⬜ pending |
| 06-03-01 | 03 | 2 | CLAW-01 | unit | `npx vitest run src/api/actions.test.ts -t "chat start" -x` | ❌ W0 | ⬜ pending |
| 06-03-02 | 03 | 2 | CLAW-04 | unit | `npx vitest run src/api/actions.test.ts -t "resolve escalation" -x` | ❌ W0 | ⬜ pending |
| 06-03-03 | 03 | 2 | CLAW-05 | unit | `npx vitest run src/api/actions.test.ts -t "chat status" -x` | ❌ W0 | ⬜ pending |
| 06-03-04 | 03 | 2 | CLAW-06 | unit | `npx vitest run src/api/actions.test.ts -t "chat retry" -x` | ❌ W0 | ⬜ pending |
| 06-03-05 | 03 | 2 | CLAW-07 | unit | `npx vitest run src/api/actions.test.ts -t "chat pause" -x` | ❌ W0 | ⬜ pending |
| 06-03-06 | 03 | 2 | AGNT-11 | unit | `npx vitest run src/orchestrator/pipeline-runner.test.ts -t "escalation" -x` | ❌ W0 | ⬜ pending |
| 06-03-07 | 03 | 2 | OBSV-01 | unit | `npx vitest run src/orchestrator/token-tracker.test.ts -t "record" -x` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/api/schemas.ts` — Zod schemas for API action validation
- [ ] `src/api/actions.test.ts` — covers API-01 through API-07, CLAW-01, CLAW-04-07
- [ ] `src/api/chat-parser.test.ts` — Chat parser unit tests
- [ ] `src/notifications/notification-service.test.ts` — covers CLAW-02, CLAW-03, OBSV-04
- [ ] `src/notifications/preferences.test.ts` — covers OBSV-03
- [ ] `src/notifications/formatters.test.ts` — covers OBSV-02
- [ ] `src/orchestrator/token-tracker.test.ts` — covers OBSV-01
- [ ] `src/orchestrator/pipeline-runner.test.ts` (modify) — Add escalation, pause/resume tests

*Existing infrastructure covers vitest framework. All test files are new (Wave 0).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Discord message delivery via OpenClaw | CLAW-02 | Requires live Discord channel + OpenClaw relay | Start pipeline, verify Discord channel receives status update |
| Discord escalation response flow | CLAW-04 | Requires live Discord interaction | Trigger escalation, respond in Discord, verify pipeline resumes |
| Paperclip activity log visibility | OBSV-04 | Requires Paperclip dashboard | Post activity event, verify it appears in Paperclip activity feed |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
