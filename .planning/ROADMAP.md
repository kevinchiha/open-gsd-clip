# Roadmap: GSD Orchestrator (open-gsd-clip)

## Overview

Build a Paperclip plugin that fully automates the GSD development pipeline. The build progresses in dependency order: first establish the plugin foundation and protocol layer that everything depends on, then the state machine that governs transitions, then the agent spawning infrastructure, then prove correctness with sequential end-to-end execution, then add parallel execution for performance, and finally wire up the user-facing surfaces (Discord via OpenClaw, REST API, observability). Each phase delivers a testable, verifiable capability that the next phase builds upon.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation and Protocol** - Plugin shell, GSD bridge, and signal parser establish the base layer everything depends on (completed 2026-03-18)
- [x] **Phase 2: Pipeline State Machine** - FSM tracks pipeline/phase state transitions; dependency resolver determines execution order (completed 2026-03-18)
- [ ] **Phase 3: Agent Spawning Infrastructure** - Agent factory, templates, and context builder can create correctly configured agents for all five roles
- [ ] **Phase 4: Sequential Pipeline Execution** - End-to-end pipeline runs all phases sequentially with CEO quality gate, error recovery, and audit logging
- [ ] **Phase 5: Parallel Execution and Merge Strategy** - Independent phases execute concurrently with sequential merge ordering to avoid git conflicts
- [ ] **Phase 6: User-Facing Integration** - Discord chat loop via OpenClaw, REST API endpoints, CEO escalation to user, and observability complete the UX

## Phase Details

### Phase 1: Foundation and Protocol
**Goal**: A working Paperclip plugin that can register, respond to health checks, call gsd-tools.cjs for roadmap/state data, and parse structured GSD_SIGNAL comments
**Depends on**: Nothing (first phase)
**Requirements**: PIPE-01, PIPE-04, PIPE-05
**Success Criteria** (what must be TRUE):
  1. Plugin registers with Paperclip via definePlugin() and responds to health check events
  2. gsd-tools.cjs bridge can parse a real roadmap and return typed phase data (names, dependencies, status)
  3. Signal parser correctly extracts and validates GSD_SIGNAL structured data from Paperclip issue comment strings
  4. Project builds, lints, and passes all unit tests with TypeScript 5.8 / Zod 4 / vitest toolchain
**Plans:** 4/4 plans complete

Plans:
- [ ] 01-01-PLAN.md — Project scaffolding, shared module, and test fixtures
- [ ] 01-02-PLAN.md — Plugin shell (JSON-RPC transport, handler, integration test)
- [ ] 01-03-PLAN.md — GSD bridge (discovery, executor, schemas, typed commands)
- [ ] 01-04-PLAN.md — Signal parser (12 signal types, schemas, extraction, formatting)

### Phase 2: Pipeline State Machine
**Goal**: Pipeline state transitions are fully modeled, validated, and serializable -- and the dependency resolver can determine which phases run in parallel vs sequentially
**Depends on**: Phase 1
**Requirements**: PIPE-02, PIPE-06
**Success Criteria** (what must be TRUE):
  1. Pipeline FSM enforces valid state transitions (idle -> initializing -> analyzing -> running -> completed/failed) and rejects invalid ones
  2. Per-phase sub-state machine tracks step transitions (idle -> discussing -> planning -> executing -> verifying -> done/failed) with validated transitions
  3. FSM state serializes to and deserializes from Paperclip plugin DB format without data loss
  4. Dependency resolver reads roadmap phase dependencies and produces correct parallel execution groups (phases with no unmet dependencies can run together)
**Plans:** 3/3 plans complete

Plans:
- [ ] 02-01-PLAN.md — Pipeline/phase state types and both FSM transition functions
- [ ] 02-02-PLAN.md — DAG dependency resolver (Kahn's algorithm with parallel group extraction)
- [ ] 02-03-PLAN.md — Zod serialization schemas, round-trip persistence, and barrel export

### Phase 3: Agent Spawning Infrastructure
**Goal**: The plugin can create correctly configured Paperclip agent issues for all five roles (CEO, discusser, planner, executor, verifier) with proper context, isolation, and autonomous GSD command execution
**Depends on**: Phase 2
**Requirements**: AGNT-01, AGNT-02, AGNT-03, AGNT-04, AGNT-05, AGNT-06, AGNT-07
**Success Criteria** (what must be TRUE):
  1. Agent factory creates valid Paperclip issues for each of the five agent roles with correct CLAUDE.md template content
  2. Context builder injects the right environment variables and instructions per agent type (project path, brief, phase number, GSD config, role-specific flags)
  3. CEO agent can run /gsd:new-project --auto against a real project brief and produce a valid roadmap without hanging on interactive prompts
  4. Each specialist agent (discusser, planner, executor, verifier) can run its respective /gsd command autonomously against a real phase
  5. Agent spawning applies 4-layer isolation to prevent 50K token overhead per Claude Code subprocess
**Plans**: TBD

Plans:
- [ ] 03-01: TBD
- [ ] 03-02: TBD
- [ ] 03-03: TBD

### Phase 4: Sequential Pipeline Execution
**Goal**: A complete end-to-end pipeline runs all phases sequentially (discuss -> CEO review -> plan -> execute -> verify per phase) with quality gates, error recovery, stale agent detection, and full decision audit logging
**Depends on**: Phase 3
**Requirements**: PIPE-03, PIPE-08, AGNT-08, AGNT-09, AGNT-10, AGNT-12, EXEC-02, EXEC-03, EXEC-04, EXEC-05
**Success Criteria** (what must be TRUE):
  1. Pipeline can be started with a project brief and path, and runs new-project -> discuss -> CEO review -> plan -> execute -> verify for each phase without human intervention
  2. CEO quality gate reviews CONTEXT.md after discussion and either approves (proceeds to planning) or requests revision (re-triggers discussion with specific feedback)
  3. Failed operations are classified by type (transient, context overflow, test failure, merge conflict, fatal) and retried with exponential backoff where appropriate
  4. Stale agents are detected via progress-based health checks (no output for configurable threshold) and respawned with hard per-step timeouts
  5. Every CEO decision is recorded in an audit log with timestamp, context, options considered, choice made, and reasoning
**Plans**: TBD

Plans:
- [ ] 04-01: TBD
- [ ] 04-02: TBD
- [ ] 04-03: TBD

### Phase 5: Parallel Execution and Merge Strategy
**Goal**: Independent phases execute concurrently using git worktrees, with completed results merged in roadmap order to avoid conflicts
**Depends on**: Phase 4
**Requirements**: EXEC-01, PIPE-07
**Success Criteria** (what must be TRUE):
  1. Independent phases (no unmet dependency) execute in parallel, each in its own git worktree
  2. Parallel phase results are merged into the main branch in roadmap order regardless of completion order
  3. A pipeline with mixed independent and dependent phases correctly parallelizes the independent ones and sequences the dependent ones
**Plans**: TBD

Plans:
- [ ] 05-01: TBD
- [ ] 05-02: TBD

### Phase 6: User-Facing Integration
**Goal**: Users interact with the full pipeline through Discord via OpenClaw (start projects, get status, approve escalations, retry failures, pause/resume) backed by REST API endpoints and observability
**Depends on**: Phase 5
**Requirements**: CLAW-01, CLAW-02, CLAW-03, CLAW-04, CLAW-05, CLAW-06, CLAW-07, API-01, API-02, API-03, API-04, API-05, API-06, API-07, AGNT-11, OBSV-01, OBSV-02, OBSV-03, OBSV-04
**Success Criteria** (what must be TRUE):
  1. User can send a project brief via Discord and the pipeline starts autonomously
  2. User receives meaningful status updates in Discord at phase transitions (started, completed, failed, decision made) without notification spam
  3. CEO escalation decisions are delivered to the user via Discord with context and options, and the user can respond to unblock the pipeline
  4. User can query status, retry failed phases, and pause/resume the pipeline via Discord commands
  5. REST API endpoints (start, status, phases, retry, override, pause, resume) provide programmatic pipeline control
**Plans**: TBD

Plans:
- [ ] 06-01: TBD
- [ ] 06-02: TBD
- [ ] 06-03: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation and Protocol | 4/4 | Complete    | 2026-03-18 |
| 2. Pipeline State Machine | 1/3 | Complete    | 2026-03-18 |
| 3. Agent Spawning Infrastructure | 0/0 | Not started | - |
| 4. Sequential Pipeline Execution | 0/0 | Not started | - |
| 5. Parallel Execution and Merge Strategy | 0/0 | Not started | - |
| 6. User-Facing Integration | 0/0 | Not started | - |
