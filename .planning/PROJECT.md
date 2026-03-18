# GSD Orchestrator (open-gsd-clip)

## What This Is

A Paperclip plugin that fully automates the GSD (Get Shit Done) development workflow. Instead of manually running `/gsd:new-project`, `/gsd:discuss-phase`, `/gsd:plan-phase`, `/gsd:execute-phase`, and `/gsd:verify-work` one by one — waiting, clearing context, and repeating — this plugin orchestrates a team of AI agents that execute the entire pipeline autonomously. Users interact via Discord through OpenClaw: send a project brief, get updates on decisions, and come back to a fully built project.

## Core Value

Send a project brief via Discord, come back later to a fully built and verified codebase — with every GSD phase discussed, planned, executed, and verified by autonomous agents.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

(None yet — ship to validate)

### Active

<!-- Current scope. Building toward these. -->

- [ ] Paperclip plugin that orchestrates the full GSD pipeline (new-project → discuss → plan → execute → verify per phase)
- [ ] CEO agent that handles Q&A and design decisions during GSD interactive prompts
- [ ] Specialist agents (discusser, planner, executor, verifier) spawned per phase via Claude Code CLI
- [ ] Phase sequencing — parallel execution of independent phases, sequential for dependent ones
- [ ] Sequential merge strategy — phases run in parallel but commit results in order
- [ ] CEO quality gate between discuss and plan (reviews CONTEXT.md, approves or requests revision)
- [ ] Agent signal protocol — structured comments on Paperclip issues for inter-agent communication
- [ ] gsd-tools.cjs bridge — typed wrapper around GSD's existing CLI for roadmap parsing, state management
- [ ] Pipeline state machine — phase step transitions (idle → discussing → planning → executing → verifying → done/failed)
- [ ] REST API endpoints for pipeline control (start, status, retry, pause, resume, override)
- [ ] OpenClaw integration — full chat loop via Discord (start projects, get status updates, approve CEO decisions, retry failures)
- [ ] CEO pings user for big architectural/scope decisions (non-blocking for routine decisions)
- [ ] Error recovery — classify failures, retry with backoff, stale agent detection
- [ ] Decision audit log — tracks all CEO decisions for review
- [ ] Notification system — posts CEO decisions and phase progress as activity events

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- Mobile companion apps — OpenClaw already handles this via Discord on any device
- Custom dashboard UI — Paperclip already has a dashboard with plugin UI slots
- Reimplemented GSD parsing — gsd-tools.cjs handles all file parsing
- Multi-project pipelines — one project at a time for v1 simplicity
- Custom LLM selection per agent — use GSD's model profile system

## Context

**Paperclip** (github.com/paperclipai/paperclip) is an open-source AI agent orchestration platform. It provides:
- `definePlugin()` API with rich context (events, agents, issues, state, actions, endpoints)
- `claude_local` adapter that spawns Claude Code CLI as a child process with session management
- `openclaw_gateway` adapter that connects to OpenClaw via WebSocket
- Issues as work units with comments, checkout/release, and agent wakeup triggers
- 21 domain event types for plugin subscription
- Plugin isolation via worker processes + JSON-RPC 2.0 over stdio
- Agent heartbeat system for triggering work, with concurrency controls

**OpenClaw** (github.com/openclaw/openclaw) is an open-source local-first AI assistant:
- Connected to Discord (user's existing setup)
- Inbound webhook endpoints (`/hooks/agent`) for external triggers
- Agent tools (bash, fetch, browser) for calling external APIs
- Hook scripts for event-driven outbound integration
- Gateway WebSocket protocol for bidirectional communication

**GSD** (github.com/gsd-build/get-shit-done) is a structured development workflow system:
- `/gsd:new-project` → questioning, research, requirements, roadmap
- `/gsd:discuss-phase N` → gather context through Q&A
- `/gsd:plan-phase N` → create detailed execution plans
- `/gsd:execute-phase N` → implement code with wave-based parallelism
- `/gsd:verify-work N` → validate deliverables
- `gsd-tools.cjs` CLI provides roadmap analysis, phase management, state tracking
- `--auto` flag available on commands to skip interactive Q&A
- Roadmap includes dependency information for parallel vs sequential phases

**Integration path:**
- User messages Discord → OpenClaw receives message
- OpenClaw agent/hook forwards to Paperclip plugin API
- Plugin creates CEO task → CEO runs `/gsd:new-project --auto` via Claude Code
- Plugin parses roadmap via gsd-tools.cjs, determines phase dependencies
- For each phase: spawn discuss → CEO review → plan → execute → verify agents
- Status/decisions flow back: Paperclip → OpenClaw → Discord

## Constraints

- **Platform**: Paperclip plugin (must use `definePlugin()` + plugin SDK, TypeScript)
- **Agent runtime**: Claude Code CLI via Paperclip's `claude_local` adapter
- **Git**: Single branch, sequential merges to avoid conflicts between parallel phases
- **Dependencies**: Requires Paperclip running locally, GSD installed, Claude Code CLI available, Node.js 20+
- **Communication**: OpenClaw already connected to Discord — use existing setup

## Key Decisions

<!-- Decisions that constrain future work. Add throughout project lifecycle. -->

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Paperclip plugin architecture | Leverages existing agent orchestration, heartbeat, task system | — Pending |
| CEO agent handles Q&A decisions | Removes human bottleneck while keeping strategic oversight | — Pending |
| gsd-tools.cjs bridge (not reimplementation) | GSD already has robust parsing — wrap, don't rewrite | — Pending |
| Structured comment signals (GSD_SIGNAL) | Lightweight, parseable, fits Paperclip's comment-based agent communication | — Pending |
| Single branch + sequential merge | Avoids git conflicts from parallel phases without branch complexity | — Pending |
| OpenClaw in v1 via full chat loop | User's primary interface is Discord — this is the main UX, not an add-on | — Pending |
| Parallel phases when roadmap allows | Faster pipeline execution — key user value proposition | — Pending |

---
*Last updated: 2026-03-18 after initialization*
