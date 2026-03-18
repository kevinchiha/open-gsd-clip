# Project Research Summary

**Project:** GSD Orchestrator (open-gsd-clip)
**Domain:** AI agent orchestration plugin — Paperclip plugin automating the GSD development pipeline via Claude Code CLI and OpenClaw/Discord
**Researched:** 2026-03-18
**Confidence:** HIGH

## Executive Summary

open-gsd-clip is a Paperclip plugin that fully automates the GSD development workflow. The plugin receives project briefs via Discord through OpenClaw, orchestrates a hierarchy of Claude Code CLI agents (CEO, discusser, planner, executor, verifier) across GSD's pipeline phases, and delivers a fully built and verified codebase — all without human intervention except for escalated strategic decisions. Research across all four domains confirms this is a well-scoped orchestration problem with established patterns: a strict hierarchical supervisor topology where the plugin owns all sequencing and state, agents know nothing about the pipeline, and all inter-agent communication flows through structured Paperclip issue comments (GSD_SIGNAL protocol).

The recommended implementation strategy is to build the plugin against Paperclip's PLUGIN_SPEC.md directly (no SDK yet published), implement a lightweight custom pipeline FSM rather than XState (XState's actor model fights Paperclip's event-driven model), and wrap gsd-tools.cjs via execa rather than reimplementing any GSD logic. The stack is TypeScript 5.8 on Node.js 22, with Zod 4 for schema validation, pino for structured logging, and vitest for testing. The most critical architectural decision — already validated — is that the plugin orchestrates by creating Paperclip primitives (issues, wakeups, signals) rather than spawning Claude Code processes directly; Paperclip's `claude_local` adapter is the execution engine.

The top risks are: (1) context window exhaustion silently corrupting long execution phases, which must be addressed by scoping agent tasks narrowly and using wave-based sub-tasks from day one; (2) git state corruption from parallel phases on a single branch, best mitigated by git worktrees per phase rather than a commit mutex; and (3) the "bag of agents" error multiplication pattern, which demands typed GSD_SIGNAL schemas at every agent boundary and a substantive CEO quality gate rather than a rubber-stamp. The build order is dictated by component dependencies and must proceed in four layers: foundation (plugin shell + GSD bridge), core state (pipeline FSM + signal parser), agent communication (templates + context builder + agent factory), and orchestration (phase driver + error recovery), with user-facing surfaces last.

## Key Findings

### Recommended Stack

The plugin runs on Node.js 22 LTS with TypeScript 5.8 — matching the Paperclip platform's own toolchain. The Paperclip SDK packages (`@paperclipai/shared`, `@paperclipai/adapter-utils`) provide the type foundation, but the plugin-specific SDK (`@paperclipai/plugin-sdk`) is not yet published to npm. The plugin must therefore implement the JSON-RPC stdio protocol manually against PLUGIN_SPEC.md. This is viable — the protocol is simple and well-documented.

**Core technologies:**
- **Node.js 22 LTS**: Runtime — matches Paperclip platform, LTS until April 2027
- **TypeScript 5.8**: Language — full Node.js 22 compatibility, avoid TS 6.0 RC and 7.0 preview
- **Zod 4.x**: Validation — Paperclip uses Zod throughout; match version to avoid duplicate instances
- **Custom pipeline FSM (typed transition table)**: State machine — lightweight, serializable to Paperclip plugin DB; XState's actor model fights Paperclip's event-driven model
- **execa 9.6**: gsd-tools.cjs CLI wrapper — promise API, zombie cleanup, typed errors; never import gsd-tools.cjs directly
- **pino 9.x**: Logging — structured JSON to stderr; raw console.log corrupts the JSON-RPC stdio protocol
- **vitest 4.x**: Testing — TypeScript-native, superior for async state machine testing
- **tsup 8.x**: Build — bundled output with multiple entry points for Paperclip plugin distribution

**Critical version constraints:** Do NOT use `@paperclipai/plugin-sdk` (not on npm). Do NOT use TypeScript 6.0 RC or 7.0 preview. Match Zod version exactly to `@paperclipai/shared` peer dependency to avoid duplicate schema instances.

### Expected Features

Research identifies 11 must-have features for v1 and a clear set of features to defer. The dependency graph is explicit: pipeline FSM is the foundation for everything; gsd-tools bridge and signal protocol enable agents; CEO agent enables autonomy; sequential pipeline proves correctness; then parallelism adds performance; quality gates add reliability; error handling adds resilience; and Discord status visibility completes the UX.

**Must have (table stakes):**
- Pipeline state machine — foundation; everything else depends on this
- gsd-tools.cjs bridge — agents cannot interact with GSD without it
- Inter-agent communication protocol (GSD_SIGNAL) — structured comments with typed schemas
- CEO agent for Q&A decisions — the autonomy enabler; without it the pipeline blocks on human input
- End-to-end pipeline execution (sequential first) — prove correctness before parallelizing
- Phase dependency resolution — parse roadmap to determine parallel vs sequential execution
- Parallel phase execution + sequential merge strategy — the performance payoff
- CEO quality gate (discuss → plan) — prevents garbage-in-garbage-out cascades
- Error detection and basic retry — transient failures will happen
- Status visibility via Discord — users must know what is happening
- Pipeline control API (start, status, retry) — programmatic control baseline

**Should have (competitive differentiators):**
- CEO decision audit log — full traceability, builds trust in autonomous operation
- Intelligent error classification — different recovery strategies per failure class
- Phase-level retry — retry only the failed phase, not the full pipeline
- CEO escalation to human — bounded autonomy for strategic decisions
- Stale agent detection — detect and replace hung Claude Code processes
- Pipeline pause/resume — user can intervene without killing everything

**Defer (v2+):**
- Dynamic re-planning — highest complexity; v1 runs the plan as-is
- Cost/token tracking per phase — add after collecting baseline data
- Progress estimation — needs historical data that does not exist yet
- Notification preferences — v1 sends all notifications; filtering is polish
- Multi-project pipelines — one project at a time; proven in v1 first

**Explicit anti-features (never build):**
- Custom LLM selection, standalone dashboard UI, GSD parsing reimplementation, agent-to-agent free-form chat, autonomous deployment, browser automation for agents, real-time streaming of agent output to Discord, per-phase git branching

### Architecture Approach

The plugin uses a strict hierarchical supervisor topology: Plugin (orchestrator) owns the pipeline state and all sequencing decisions; CEO agent acts as strategic delegate for decisions; specialist agents (discusser, planner, executor, verifier) execute isolated work tasks with no knowledge of the pipeline. Data never flows directly between agents — it always passes through the plugin. The plugin shell is the only component that speaks to Paperclip's host APIs; GSD Bridge is the only component that invokes gsd-tools.cjs; Signal Parser is the only component that interprets issue comments; Pipeline FSM is the single source of truth for pipeline state.

**Major components:**
1. **Plugin Shell** — Entry point, `definePlugin()` manifest, JSON-RPC lifecycle bridge to Paperclip
2. **Pipeline FSM** — Pure state transition function: idle → initializing → analyzing → running → completed/failed, with per-phase sub-states; serialized to Paperclip plugin DB after each transition
3. **GSD Bridge** — Typed execa wrapper around gsd-tools.cjs; the only CLI caller in the system
4. **Signal Parser** — Defines and validates the GSD_SIGNAL structured comment protocol; the only comment interpreter
5. **Phase Driver** — Reads dependency graph, builds parallel execution groups, enforces sequential merge ordering, reacts to FSM transitions by spawning agents
6. **Agent Factory + Context Builder** — Creates Paperclip issues with assembled context for each agent role; Paperclip's heartbeat system handles actual spawning
7. **Error Recovery** — Classifies failures (transient, stale, deterministic, catastrophic) and applies differentiated recovery strategies
8. **Notification Bus** — Formats pipeline events for Discord via Paperclip activity → OpenClaw

**Key patterns to follow:** Event-driven reaction (never poll Paperclip for agent completion; subscribe to issue events); immutable state transitions (FSM is a pure function; side effects triggered by Phase Driver comparing state); agent ignorance (agents receive a task and context, know nothing about the pipeline); context assembly at spawn time (all context in issue description + env vars; agents cannot call back to plugin); idempotent operations (every operation safe to restart from persisted state).

### Critical Pitfalls

1. **Context window exhaustion silently corrupts execution phases** — Claude Code auto-compacts at 95% context, losing file paths, debugging state, and partially-completed work. Prevent by scoping agent tasks to wave-based sub-tasks targeting 60% context usage; put critical state in files, not conversation history; set `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=70`.

2. **Git state corruption from parallel phase execution** — Even with sequential merge intent, parallel agents issuing concurrent git commands corrupt working tree state. Use git worktrees per parallel phase (the Anthropic-endorsed pattern) or implement a strict commit mutex; never allow agents to run `git add .`.

3. **The "17x error multiplication" bag-of-agents trap** — Without typed schemas at every agent boundary, a bad CEO decision propagates through planner → executor → verifier, multiplying damage 17x vs single-agent. Prevent with Zod-validated GSD_SIGNAL schemas at every handoff and a substantive (not rubber-stamp) CEO quality gate with specific validation criteria.

4. **50K token overhead per Claude Code spawn** — Each fresh Claude Code subprocess pays 50K tokens for system prompt loading before doing any work. For 20 agent spawns (5 phases × 4 steps), this is 1M tokens of overhead. Apply 4-layer isolation on every spawn: scoped cwd, `.git/HEAD` to block CLAUDE.md traversal, minimal plugin directory, project-only settings source.

5. **State inconsistency across three state stores** — Paperclip issue status, GSD filesystem state (`.planning/`), and plugin pipeline FSM can drift apart on crash. Designate GSD files on disk as the single ground truth; plugin FSM derives from GSD state; Paperclip issue status is a projection. Read GSD state before every transition to confirm preconditions.

6. **CEO autonomous bad decisions silently propagating** — The CEO will not say "I don't know" without explicit prompting. Define a concrete decision taxonomy (ROUTINE / NOTABLE / STRATEGIC) with scope/tech/architecture always classified as STRATEGIC. Implement a preview window for NOTABLE decisions. Include explicit confidence threshold escalation instruction in CEO system prompt.

7. **Stale agents consuming resources silently** — A hung Claude Code process is OS-alive but produces no output. Progress-based health checks (time-since-last-stream-json-event) are required, not just PID checks. Set hard per-step timeouts (discuss: 10min, plan: 15min, execute: 30min per wave, verify: 15min). Kill escalation: SIGTERM → 5s → SIGKILL.

8. **GSD interactive prompts breaking autonomous flow** — `--auto` flag skips known Q&A but edge cases still trigger interactive prompts that hang in `-p` mode. Test every GSD command path in fully autonomous mode before building the pipeline on top. Use `--dangerously-skip-permissions` or comprehensive `--allowedTools` in sandboxed agent environments.

## Implications for Roadmap

Based on the component dependency graph from ARCHITECTURE.md and the MVP prioritization from FEATURES.md, the natural build order is four layers with a user-facing layer last. Research strongly suggests not parallelizing too early — prove sequential pipeline correctness first, then add parallelism and quality gates, then polish UX surfaces.

### Phase 1: Foundation and Protocol

**Rationale:** Nothing else can be built or tested without a working plugin that registers with Paperclip and can call gsd-tools. Establishing the JSON-RPC entry point and GSD bridge first creates a testable base layer for all subsequent work.
**Delivers:** Working Paperclip plugin skeleton (`definePlugin()` manifest, lifecycle, event subscription), typed GSD Bridge with all gsd-tools.cjs commands wrapped, project scaffold with TypeScript 5.8 / Zod 4 / vitest / tsup configuration.
**Addresses:** gsd-tools.cjs bridge (table stakes #2 from FEATURES.md)
**Avoids:** Plugin isolation model confusion (STACK.md open question #4); gsd-tools import pitfall (import as library vs subprocess)

### Phase 2: Core State Machine and Signal Protocol

**Rationale:** The pipeline FSM and Signal Parser are pure functions with no I/O — highly testable in isolation. Building them before any agent integration allows exhaustive unit testing of all state transitions and signal schemas. These are the foundation that Phase Driver and Agent Factory depend on.
**Delivers:** Complete pipeline FSM with all states (idle → initializing → analyzing → running → completed/failed) and per-phase sub-states; GSD_SIGNAL protocol with all signal types and Zod schemas; state persistence serialization to Paperclip plugin DB; 100% unit test coverage on FSM transitions.
**Addresses:** Pipeline state machine (table stakes #1); inter-agent communication protocol (table stakes #3)
**Avoids:** State inconsistency (Pitfall 5); monolithic state object anti-pattern; three sources of truth problem

### Phase 3: Agent Spawning Infrastructure

**Rationale:** Agent Factory, Context Builder, and Agent Templates form the plugin's primary output mechanism. Building these before Phase Driver allows manual testing of individual agent types (spawn a discusser, inspect its Paperclip issue, verify context is correct) before wiring up full orchestration. This is also where Pitfall 4 (token bloat) and Pitfall 8 (GSD interactive prompts) must be solved — before building the pipeline on top.
**Delivers:** Agent templates for all five roles (CEO, discusser, planner, executor, verifier); Context Builder assembling correct context per role; Agent Factory creating Paperclip issues; 4-layer isolation on every spawn to prevent 50K token overhead; verified autonomous operation of every GSD command path.
**Addresses:** CEO agent for Q&A decisions (table stakes #4); test every GSD --auto path
**Avoids:** Token bloat per spawn (Pitfall 4); GSD interactive prompt hangs (Pitfall 8); fat agent prompts with pipeline logic (anti-pattern 2)

### Phase 4: Sequential Pipeline Execution

**Rationale:** Connect FSM, Phase Driver, and Agent Factory into a working end-to-end pipeline running phases sequentially. Prove correctness on a real project before adding parallelism — sequential execution is simpler to debug, and the CEO quality gate must be validated in context. Error Recovery and stale agent detection must be built here.
**Delivers:** Working end-to-end pipeline (new-project → discuss → CEO review → plan → execute → verify) for a single sequential phase; CEO quality gate between discuss and plan; basic error classification and retry with exponential backoff; stale agent detection with progress-based health checks and hard timeouts; CEO audit log.
**Addresses:** End-to-end pipeline (table stakes #5); CEO quality gate (table stakes #8); error detection and retry (table stakes #9); CEO decision audit log (differentiator)
**Avoids:** 17x error multiplication (Pitfall 3); CEO bad decisions silently propagating (Pitfall 6); stale agents (Pitfall 7); context window exhaustion (Pitfall 1) — wave-based execution baked in here

### Phase 5: Parallel Execution and Merge Strategy

**Rationale:** Phase dependency resolution and parallel execution are the performance payoff. They build on a proven sequential pipeline. Git worktree strategy (not single-branch) is the correct architecture based on Pitfall 2 research — this decision must be made and implemented atomically.
**Delivers:** Roadmap dependency graph parsing via GSD Bridge; topological sort for parallel phase grouping; git worktree per parallel phase with sequential merge queue; Phase Driver orchestrating multiple concurrent phases; full pipeline execution from project brief to multi-phase verified codebase.
**Addresses:** Phase dependency resolution (table stakes #6); parallel phase execution + sequential merge (table stakes #7)
**Avoids:** Git state corruption (Pitfall 2) — worktrees are the architectural answer

### Phase 6: OpenClaw Integration and User-Facing Polish

**Rationale:** Discord status visibility and the pipeline control API are the user-facing surface. They depend on a working pipeline and should be built last. OpenClaw integration is the primary UX, not an add-on — but it cannot be meaningfully tested until the pipeline works end-to-end.
**Delivers:** REST endpoints for pipeline control (start, status, pause, resume, retry, override); Notification Bus with meaningful phase progress events (not noise); full OpenClaw chat loop for starting projects, getting status, approving CEO escalations, retrying failures; phase-level retry (retry phase N, not full pipeline).
**Addresses:** Status visibility via Discord (table stakes #10); pipeline control API (table stakes #11); CEO escalation to human (differentiator); phase-level retry (differentiator); notification design per UX pitfalls
**Avoids:** Silent pipeline UX pitfall; over-verbose notification pitfall; no-intervention-mid-pipeline pitfall

### Phase Ordering Rationale

- **Foundation before state before agents before orchestration:** This order is dictated by the component dependency graph — you cannot test Phase Driver without Agent Factory; cannot test Agent Factory without Signal Parser; cannot test Signal Parser without the plugin shell registering with Paperclip.
- **Sequential before parallel:** Running all phases sequentially first is not a shortcut — it is the correct way to validate correctness before adding the complexity of concurrent agent state and merge coordination.
- **Infrastructure pitfalls addressed early:** Context window exhaustion (Pitfall 1), token bloat (Pitfall 4), and GSD interactive prompt hangs (Pitfall 8) are addressed in Phase 3 — before any pipeline is built on top. Retrofitting these is extremely painful.
- **Git strategy locked in Phase 5:** The git worktree vs single-branch decision is architectural and affects every agent's workflow. Research recommends worktrees; this cannot be changed after Phase 4.

### Research Flags

Phases likely needing deeper `/gsd:research-phase` during planning:

- **Phase 1:** Plugin SDK not published — need to fully map the manual JSON-RPC stdio implementation requirements from PLUGIN_SPEC.md. The plugin isolation model (in-process module vs out-of-process worker) may require empirical investigation against the running Paperclip version.
- **Phase 3:** Agent spawning integration with Paperclip's `claude_local` adapter requires hands-on investigation. The 4-layer isolation pattern needs empirical validation in the target environment. OpenClaw gateway integration depth (direct WebSocket vs adapter only) needs resolution.
- **Phase 5:** Git worktree behavior with Paperclip's filesystem assumptions and the specific GSD phase directory structure needs investigation. Merge queue sequencing under concurrent completions needs detailed design.

Phases with standard patterns (may skip research-phase):

- **Phase 2:** Pure state machine and schema design. Well-understood patterns; unit testing approach is standard. TypeScript FSM implementation is straightforward given the full state diagram in ARCHITECTURE.md.
- **Phase 4:** Sequential orchestration with one active agent per step is the simplest orchestration model. Error classification patterns are well-documented. Standard exponential backoff with jitter.
- **Phase 6:** REST endpoint registration through Paperclip's `definePlugin()` is documented. Notification formatting is product/UX work, not technical research.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All core packages verified on npm with correct versions. Paperclip monorepo source reviewed directly. The only uncertainty is Zod version alignment with `@paperclipai/shared` peer dependencies — needs empirical check. |
| Features | HIGH | Feature prioritization grounded in well-documented industry patterns (LangGraph, CrewAI, Devin). Dependency graph is internally consistent and aligns with the architectural component boundaries. |
| Architecture | HIGH | Architecture derived from direct review of Paperclip PLUGIN_SPEC.md, heartbeat docs, and core concepts. Component boundaries and data flow are unambiguous. The FSM design dissent (custom vs XState) is well-reasoned — custom FSM aligns better with Paperclip's serialization model. |
| Pitfalls | HIGH | All 8 pitfalls sourced from high-confidence references: official Claude Code docs, Anthropic GitHub issues, Towards Data Science research, GitHub Blog engineering posts. Most are empirically documented failure modes, not inferences. |

**Overall confidence:** HIGH

### Gaps to Address

- **Plugin SDK publication:** Monitor `@paperclipai/plugin-sdk` npm release and Paperclip Discussion #258. If published before Phase 1 implementation begins, evaluate whether it provides a higher-level abstraction that simplifies the JSON-RPC layer.
- **Zod version alignment:** Verify the exact Zod version pinned in `@paperclipai/shared@0.3.x` peer dependencies before writing any schema code. A version mismatch creates silent runtime failures.
- **Direct OpenClaw WebSocket need:** Determine during Phase 1 whether all Discord communication can flow through Paperclip's `openclaw_gateway` adapter, or whether the plugin needs a direct WebSocket to OpenClaw for notifications outside of agent heartbeat cycles. This determines whether `ws` is a runtime dependency.
- **Plugin isolation model in current Paperclip version:** PLUGIN_SPEC.md describes out-of-process workers with JSON-RPC over stdio. If the current Paperclip v0.3.x ships in-process ES module loading instead, the plugin entry point structure differs. Verify empirically against the running Paperclip installation before Phase 1 is complete.
- **Git worktree compatibility with Paperclip's workspace model:** Verify that Paperclip's `claude_local` adapter correctly handles agents operating from git worktree directories rather than the main working tree. This assumption underlies the entire Phase 5 parallel strategy.

## Sources

### Primary (HIGH confidence)
- Paperclip GitHub Repository — platform architecture, source code, PLUGIN_SPEC.md
- Paperclip DeepWiki (monorepo structure, architecture overview) — component relationships
- Paperclip Heartbeat Documentation — agent execution lifecycle
- Paperclip Core Concepts docs — domain entities (issues, agents, heartbeats, sessions)
- GSD Tools Architecture (DeepWiki) — gsd-tools.cjs CLI reference and command surface
- Official Claude Code headless docs — `-p` flag, `--output-format stream-json`, `--resume`
- Official Claude Code subagent docs — `maxTurns`, isolation, worktree support
- Node.js GitHub issues on zombie processes — child process cleanup requirements
- Claude Code GitHub issues — known spawning failures and crash modes
- Azure AI Agent Design Patterns (Microsoft) — orchestration reference architecture

### Secondary (MEDIUM confidence)
- Paperclip v0.3.1 release notes — version surface
- OpenClaw Gateway Protocol docs — WebSocket protocol details
- GSD GitHub repository — command surface and `--auto` flag behavior
- XState npm (v5.28.0), Zod npm (v4.3.6), execa npm (v9.6.1), vitest npm (v4.1.0) — version verification
- Towards Data Science — "17x error trap" multi-agent failure research
- DEV Community — Claude Code subagent 50K token bloat analysis and 4-layer isolation fix
- GitHub Blog — multi-agent workflow engineering patterns
- Community git worktree patterns for parallel AI agents
- Hierarchical agent systems patterns (ruh.ai)
- Event-driven multi-agent system patterns (Confluent)
- Galileo AI — human-in-the-loop escalation pattern design

### Tertiary (LOW confidence)
- TypeScript 5.8 announcement — version compatibility details (well-documented but not empirically tested in this context)
- `ws` npm (v8.19.0) — may not be needed at all; depends on OpenClaw architecture gap resolution

---
*Research completed: 2026-03-18*
*Ready for roadmap: yes*
