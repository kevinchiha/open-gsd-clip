# Requirements: GSD Orchestrator (open-gsd-clip)

**Defined:** 2026-03-18
**Core Value:** Send a project brief via Discord, come back later to a fully built and verified codebase

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Pipeline Core

- [x] **PIPE-01**: Plugin registers with Paperclip via definePlugin() and responds to health checks
- [x] **PIPE-02**: Pipeline state machine tracks phase steps (idle -> discussing -> planning -> executing -> verifying -> done/failed) with validated transitions
- [x] **PIPE-03**: Pipeline can be started with a project brief and target project path
- [x] **PIPE-04**: gsd-tools.cjs bridge parses roadmap phases, dependencies, status, and plan indices via typed wrapper
- [x] **PIPE-05**: Signal parser extracts GSD_SIGNAL structured data from Paperclip issue comments
- [x] **PIPE-06**: Phase dependency resolver determines which phases can run in parallel vs must run sequentially based on roadmap data
- [x] **PIPE-07**: Sequential merge strategy ensures parallel phases commit results in roadmap order without git conflicts
- [x] **PIPE-08**: Pipeline executes all phases end-to-end (discuss -> plan -> execute -> verify per phase) without human intervention

### Agent System

- [x] **AGNT-01**: CEO agent runs /gsd:new-project --auto with the user's brief, handling all GSD interactive prompts autonomously
- [x] **AGNT-02**: Discusser agent runs /gsd:discuss-phase N --auto for each phase, producing CONTEXT.md
- [x] **AGNT-03**: Planner agent runs /gsd:plan-phase N for each phase, producing PLAN.md files
- [x] **AGNT-04**: Executor agent runs /gsd:execute-phase N for each phase, implementing code
- [x] **AGNT-05**: Verifier agent runs /gsd:verify-work N for each phase, producing VERIFICATION.md
- [ ] **AGNT-06**: Agent factory creates Paperclip agent definitions from CLAUDE.md templates with injected context (project path, brief, phase number, GSD config)
- [x] **AGNT-07**: Context builder provides each agent type with appropriate environment variables and instructions
- [x] **AGNT-08**: CEO quality gate reviews CONTEXT.md between discuss and plan, approving or requesting revision
- [x] **AGNT-09**: CEO agent can request discussion revision when CONTEXT.md has gaps, triggering re-discussion
- [x] **AGNT-10**: CEO decision audit log records every autonomous decision with timestamp, context, options considered, choice made, and reasoning
- [x] **AGNT-11**: CEO escalates big architectural or scope decisions to user via Discord and waits for response (non-blocking for other phases)
- [x] **AGNT-12**: CEO agent can detect when execution reveals plan problems and trigger re-planning for the affected phase

### Execution & Reliability

- [x] **EXEC-01**: Independent phases execute in parallel when roadmap allows
- [x] **EXEC-02**: Error handler classifies failures into categories (transient, context overflow, test failure, merge conflict, fatal) and applies appropriate recovery strategy
- [x] **EXEC-03**: Retry manager retries failed operations with exponential backoff and jitter
- [x] **EXEC-04**: Stale agent detection identifies hung agents via progress-based health checks (no output for configurable threshold) and respawns them
- [x] **EXEC-05**: Phase-level retry allows retrying a specific failed phase from a specific step without restarting the entire pipeline

### OpenClaw Integration

- [x] **CLAW-01**: User can start a project pipeline by sending a brief via Discord through OpenClaw
- [x] **CLAW-02**: Pipeline pushes status updates to Discord at meaningful transitions (phase started, completed, failed, decision made)
- [x] **CLAW-03**: CEO escalation decisions are delivered to user via Discord with context and options
- [x] **CLAW-04**: User can respond to CEO escalations via Discord to unblock the pipeline
- [x] **CLAW-05**: User can query pipeline status via Discord chat
- [x] **CLAW-06**: User can retry failed phases via Discord commands
- [x] **CLAW-07**: User can pause and resume the pipeline via Discord commands

### Plugin API

- [x] **API-01**: POST /gsd/start endpoint starts a pipeline with brief and project path
- [x] **API-02**: GET /gsd/status endpoint returns full pipeline state and phase progress
- [x] **API-03**: GET /gsd/phases endpoint returns parsed roadmap phases
- [x] **API-04**: POST /gsd/retry/:phase endpoint retries a failed phase from a specific step
- [x] **API-05**: POST /gsd/override endpoint allows user to override a CEO decision
- [x] **API-06**: POST /gsd/pause endpoint pauses the pipeline (stops spawning new agents, lets running agents complete)
- [x] **API-07**: POST /gsd/resume endpoint resumes a paused pipeline from its current state

### Observability

- [x] **OBSV-01**: Cost/token tracking records token usage per agent invocation, aggregated by phase
- [x] **OBSV-02**: Phase progress is reported in status updates (e.g., "Phase 3 of 6, planning step")
- [x] **OBSV-03**: User can configure notification preferences (all transitions, failures only, completions only, escalations only)
- [x] **OBSV-04**: Activity events are posted to Paperclip's activity log for dashboard visibility

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Multi-Project

- **MULTI-01**: Queue multiple project requests and execute sequentially
- **MULTI-02**: Run multiple pipelines concurrently with resource management

### Progress Intelligence

- **PROG-01**: Estimate phase completion time based on historical data
- **PROG-02**: Learn from past pipeline runs to improve CEO decision quality

### Advanced Recovery

- **RECOV-01**: Automatic rollback of phase code on verification failure
- **RECOV-02**: Cross-phase conflict resolution when parallel phases produce incompatible code

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Custom LLM selection per agent | GSD already has model profile system -- use it |
| Custom dashboard UI | Paperclip has dashboard with plugin UI slots |
| GSD file parsing reimplementation | gsd-tools.cjs handles all parsing -- wrap, don't rewrite |
| Agent-to-agent free-form chat | Structured GSD_SIGNAL protocol is more reliable than unstructured conversation |
| Autonomous deployment | Pipeline ends at verified committed code -- user deploys manually |
| Browser/web interaction for agents | Agents use terminal, code editor, file system only |
| Real-time streaming of agent output | Structured status updates at transitions, not live streams |
| Git branching per phase | Single branch with sequential merge is simpler and already decided |
| Mobile companion apps | OpenClaw handles Discord on any device |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| PIPE-01 | Phase 1 | Complete |
| PIPE-02 | Phase 2 | Complete |
| PIPE-03 | Phase 4 | Complete |
| PIPE-04 | Phase 1 | Complete |
| PIPE-05 | Phase 1 | Complete |
| PIPE-06 | Phase 2 | Complete |
| PIPE-07 | Phase 5 | Complete |
| PIPE-08 | Phase 4 | Complete |
| AGNT-01 | Phase 3 | Complete |
| AGNT-02 | Phase 3 | Complete |
| AGNT-03 | Phase 3 | Complete |
| AGNT-04 | Phase 3 | Complete |
| AGNT-05 | Phase 3 | Complete |
| AGNT-06 | Phase 3 | Pending |
| AGNT-07 | Phase 3 | Complete |
| AGNT-08 | Phase 4 | Complete |
| AGNT-09 | Phase 4 | Complete |
| AGNT-10 | Phase 4 | Complete |
| AGNT-11 | Phase 6 | Complete |
| AGNT-12 | Phase 4 | Complete |
| EXEC-01 | Phase 5 | Complete |
| EXEC-02 | Phase 4 | Complete |
| EXEC-03 | Phase 4 | Complete |
| EXEC-04 | Phase 4 | Complete |
| EXEC-05 | Phase 4 | Complete |
| CLAW-01 | Phase 6 | Complete |
| CLAW-02 | Phase 6 | Complete |
| CLAW-03 | Phase 6 | Complete |
| CLAW-04 | Phase 6 | Complete |
| CLAW-05 | Phase 6 | Complete |
| CLAW-06 | Phase 6 | Complete |
| CLAW-07 | Phase 6 | Complete |
| API-01 | Phase 6 | Complete |
| API-02 | Phase 6 | Complete |
| API-03 | Phase 6 | Complete |
| API-04 | Phase 6 | Complete |
| API-05 | Phase 6 | Complete |
| API-06 | Phase 6 | Complete |
| API-07 | Phase 6 | Complete |
| OBSV-01 | Phase 6 | Complete |
| OBSV-02 | Phase 6 | Complete |
| OBSV-03 | Phase 6 | Complete |
| OBSV-04 | Phase 6 | Complete |

**Coverage:**
- v1 requirements: 43 total
- Mapped to phases: 43
- Unmapped: 0

---
*Requirements defined: 2026-03-18*
*Last updated: 2026-03-18 after roadmap creation*
