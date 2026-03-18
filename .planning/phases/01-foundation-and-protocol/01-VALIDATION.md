---
phase: 1
slug: foundation-and-protocol
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-18
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x |
| **Config file** | `vitest.config.ts` (Wave 0 creation) |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run --coverage` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run --coverage`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 0 | PIPE-01 | setup | `npx tsc --noEmit` | ❌ W0 | ⬜ pending |
| 01-01-02 | 01 | 1 | PIPE-01 | integration | `npx vitest run src/plugin/rpc-handler.test.ts -t "initialize"` | ❌ W0 | ⬜ pending |
| 01-01-03 | 01 | 1 | PIPE-01 | integration | `npx vitest run src/plugin/rpc-handler.test.ts -t "health"` | ❌ W0 | ⬜ pending |
| 01-01-04 | 01 | 1 | PIPE-01 | integration | `npx vitest run src/plugin/integration.test.ts` | ❌ W0 | ⬜ pending |
| 01-02-01 | 02 | 1 | PIPE-04 | unit | `npx vitest run src/bridge/discovery.test.ts` | ❌ W0 | ⬜ pending |
| 01-02-02 | 02 | 1 | PIPE-04 | integration | `npx vitest run src/bridge/commands.test.ts -t "analyzeRoadmap"` | ❌ W0 | ⬜ pending |
| 01-02-03 | 02 | 1 | PIPE-04 | integration | `npx vitest run src/bridge/commands.test.ts -t "getPhase"` | ❌ W0 | ⬜ pending |
| 01-02-04 | 02 | 1 | PIPE-04 | integration | `npx vitest run src/bridge/commands.test.ts -t "getState"` | ❌ W0 | ⬜ pending |
| 01-02-05 | 02 | 1 | PIPE-04 | integration | `npx vitest run src/bridge/commands.test.ts -t "findPhase"` | ❌ W0 | ⬜ pending |
| 01-02-06 | 02 | 1 | PIPE-04 | unit | `npx vitest run src/bridge/executor.test.ts -t "timeout"` | ❌ W0 | ⬜ pending |
| 01-03-01 | 03 | 1 | PIPE-05 | unit | `npx vitest run src/signals/parser.test.ts -t "extract"` | ❌ W0 | ⬜ pending |
| 01-03-02 | 03 | 1 | PIPE-05 | unit | `npx vitest run src/signals/schemas.test.ts` | ❌ W0 | ⬜ pending |
| 01-03-03 | 03 | 1 | PIPE-05 | unit | `npx vitest run src/signals/parser.test.ts -t "non-signal"` | ❌ W0 | ⬜ pending |
| 01-03-04 | 03 | 1 | PIPE-05 | unit | `npx vitest run src/signals/schemas.test.ts -t "strip"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `package.json` — project scaffolding with all dependencies
- [ ] `tsconfig.json` — TypeScript configuration with nodenext module resolution
- [ ] `vitest.config.ts` — vitest configuration for ESM TypeScript project
- [ ] `biome.json` — Biome configuration with console.log ban rule
- [ ] `src/plugin/rpc-handler.test.ts` — plugin RPC integration tests
- [ ] `src/plugin/integration.test.ts` — child process round-trip test
- [ ] `src/bridge/commands.test.ts` — bridge integration tests against fixture
- [ ] `src/bridge/executor.test.ts` — executor unit tests
- [ ] `src/bridge/discovery.test.ts` — discovery logic tests
- [ ] `src/signals/parser.test.ts` — signal parser unit tests
- [ ] `src/signals/schemas.test.ts` — signal schema validation tests
- [ ] `tests/fixtures/` — test fixture project with ROADMAP.md and STATE.md

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
