# Architecture Patterns

**Domain:** AI agent orchestration plugin (Paperclip plugin orchestrating GSD pipeline)
**Researched:** 2026-03-18

## Recommended Architecture

### Pattern: Hierarchical Orchestrator with Pipeline State Machine

This plugin uses a **hierarchical supervisor pattern** layered on top of a **pipeline state machine**. The plugin itself is the supervisor: it owns the pipeline state, spawns specialist agents via Paperclip's adapter system, and routes decisions through a CEO agent that acts as the strategic delegate. Agents communicate exclusively through Paperclip's issue/comment system using structured signal comments.

This is not a swarm or mesh topology. It is a strict tree: Plugin (orchestrator) -> CEO Agent (strategic decisions) -> Specialist Agents (discuss, plan, execute, verify). The plugin never delegates orchestration to agents -- it retains full control of sequencing, state transitions, and error handling.

```
                    +-------------------+
                    |   Discord User    |
                    +--------+----------+
                             |
                    +--------v----------+
                    |     OpenClaw      |
                    | (Gateway Adapter) |
                    +--------+----------+
                             |  WebSocket
                    +--------v----------+
                    |  Paperclip Server |
                    |  (Host Platform)  |
                    +--------+----------+
                             |  JSON-RPC (stdio)
                    +--------v----------+
                    |    GSD Plugin     |
                    |  (Worker Process) |
                    +--------+----------+
                       |     |     |
            +----------+     |     +----------+
            |                |                |
    +-------v------+  +-----v------+  +------v--------+
    | Pipeline FSM |  | GSD Bridge |  | Signal Parser |
    | (state core) |  | (CLI wrap) |  | (comment I/O) |
    +-------+------+  +-----+------+  +------+--------+
            |                |                |
            +-------+--------+--------+-------+
                    |                 |
            +-------v------+  +------v--------+
            | Phase Driver |  | Agent Factory |
            | (sequencer)  |  | (templates)   |
            +-------+------+  +------+--------+
                    |                 |
            +-------v-----------------v-------+
            |      Paperclip Issue/Comment    |
            |      System (agent comms bus)   |
            +-------+-------------------------+
                    |
        +-----------+-----------+
        |           |           |
   +----v---+  +---v----+  +---v-----+
   |  CEO   |  | Disc.  |  | Exec.   |
   | Agent  |  | Agent  |  | Agent   |
   +--------+  +--------+  +---------+
   (Claude Code instances via claude_local adapter)
```

### Component Boundaries

| Component | Responsibility | Communicates With | Boundary Rule |
|-----------|---------------|-------------------|---------------|
| **Plugin Shell** | Entry point, manifest, lifecycle hooks, RPC bridge | Paperclip host (JSON-RPC) | Only component that talks to Paperclip host APIs |
| **Pipeline FSM** | Phase step transitions, pipeline state, retry counters | Phase Driver, Plugin Shell | Pure state logic, no I/O -- receives events, emits transitions |
| **Phase Driver** | Sequences phases (parallel/sequential), merge ordering | Pipeline FSM, Agent Factory, GSD Bridge | Reads roadmap dependencies, decides execution order |
| **GSD Bridge** | Wraps gsd-tools.cjs CLI calls, parses JSON output | Phase Driver, Pipeline FSM, Context Builder | Only component that shells out to gsd-tools.cjs |
| **Signal Parser** | Parses/generates structured GSD_SIGNAL comments | Plugin Shell (events), Phase Driver | Defines the signal protocol schema, validates signals |
| **Agent Factory** | Creates Paperclip issue + agent config from templates | Phase Driver, Context Builder | Creates issues via Paperclip API, never runs agent logic |
| **Context Builder** | Assembles env vars and skill injection per agent type | Agent Factory, GSD Bridge | Reads project state, produces agent context blobs |
| **Agent Templates** | Static definitions for CEO, discusser, planner, executor, verifier | Agent Factory | Pure data, no logic -- template configs only |
| **Notification Bus** | Decision logging, progress events, user-facing messages | Plugin Shell, OpenClaw (via Paperclip) | Formats events for human consumption |
| **Error Recovery** | Classifies failures, manages retry/backoff, stale detection | Pipeline FSM, Phase Driver | Policy layer -- decides what to do with failures |

### Boundary Rules (Critical)

1. **Agents never know about the pipeline.** An agent receives a Paperclip issue with instructions and context. It does work, posts comments, updates issue status. It has zero awareness of the pipeline state machine, other phases, or other agents.

2. **The plugin never does AI work.** It orchestrates, parses, routes, and decides. All LLM-powered reasoning happens inside Claude Code agent instances spawned by Paperclip.

3. **GSD Bridge is the only CLI caller.** All `gsd-tools.cjs` invocations go through one module with typed wrappers, error handling, and JSON parsing. No scattered `execSync` calls.

4. **Signal Parser is the only comment interpreter.** When a comment arrives via event, Signal Parser determines if it contains a structured signal. All other components ask Signal Parser, never parse comments directly.

5. **Pipeline FSM is the single source of truth.** All state queries go through the FSM. The Phase Driver asks the FSM what to do next, never decides independently.

## Data Flow

### Primary Pipeline Flow (Happy Path)

```
1. User sends project brief via Discord
   Discord -> OpenClaw -> Paperclip webhook -> Plugin endpoint

2. Plugin creates pipeline, spawns CEO agent
   Plugin Shell -> Pipeline FSM (idle -> initializing)
   Plugin Shell -> Agent Factory -> create CEO issue
   Paperclip -> claude_local adapter -> Claude Code CLI

3. CEO runs /gsd:new-project --auto
   CEO Agent -> file system (creates .planning/, ROADMAP.md, etc.)
   CEO Agent -> posts GSD_SIGNAL:PROJECT_READY comment on issue
   CEO Agent -> marks issue done

4. Plugin detects completion, parses roadmap
   Paperclip event -> Plugin Shell -> Signal Parser (PROJECT_READY)
   Pipeline FSM (initializing -> analyzing)
   Phase Driver -> GSD Bridge -> gsd-tools roadmap analyze
   Phase Driver builds execution plan (parallel groups, dependency order)
   Pipeline FSM (analyzing -> running)

5. For each phase (respecting dependencies):
   a. Phase Driver -> Agent Factory -> create Discusser issue
      Context Builder assembles phase context + project state
      Paperclip spawns Claude Code -> runs /gsd:discuss-phase N --auto
      Agent posts GSD_SIGNAL:DISCUSS_COMPLETE with CONTEXT.md summary

   b. CEO quality gate (reviews CONTEXT.md)
      Phase Driver -> Agent Factory -> create CEO review issue
      CEO posts GSD_SIGNAL:APPROVED or GSD_SIGNAL:REVISION_NEEDED

   c. Phase Driver -> Agent Factory -> create Planner issue
      Planner runs /gsd:plan-phase N --auto
      Posts GSD_SIGNAL:PLAN_COMPLETE

   d. Phase Driver -> Agent Factory -> create Executor issue
      Executor runs /gsd:execute-phase N --auto
      Posts GSD_SIGNAL:EXECUTE_COMPLETE

   e. Phase Driver -> Agent Factory -> create Verifier issue
      Verifier runs /gsd:verify-work N --auto
      Posts GSD_SIGNAL:VERIFY_COMPLETE or GSD_SIGNAL:VERIFY_FAILED

6. Pipeline completion
   Pipeline FSM (running -> completed)
   Notification Bus -> Paperclip activity -> OpenClaw -> Discord
```

### Signal Protocol Flow

Agents communicate with the plugin through structured comments on their assigned Paperclip issues. This is the inter-agent communication bus.

```
Agent writes comment on issue:
---
GSD_SIGNAL:DISCUSS_COMPLETE
phase: 3
status: success
artifacts:
  - .planning/phases/3-auth-system/CONTEXT.md
summary: "Auth context gathered. Recommends JWT with refresh tokens."
---

Paperclip fires issue_comment_created event
Plugin Shell receives event -> Signal Parser extracts signal
Signal Parser validates schema -> returns typed signal object
Phase Driver processes signal -> updates Pipeline FSM
Pipeline FSM transitions -> Phase Driver spawns next agent
```

### Data Flow Direction (Strict)

```
Discord <-> OpenClaw <-> Paperclip <-> Plugin
                                         |
                              Pipeline FSM (state)
                                   |
                              Phase Driver
                              /    |     \
                      GSD Bridge  Agent Factory  Signal Parser
                         |            |              |
                   gsd-tools.cjs  Paperclip API   Issue Comments
                                      |
                               Claude Code Agents
                                      |
                               File System (code)
```

**Data never flows upward through agents.** Agents write comments and update issue status. The plugin reads those via Paperclip events. There is no callback, no direct socket, no shared memory between agents and the plugin.

### State Persistence

| What | Where | Why |
|------|-------|-----|
| Pipeline state | Paperclip plugin state (DB-backed) | Survives plugin restarts, Paperclip manages lifecycle |
| Phase progress | GSD STATE.md + ROADMAP.md (filesystem) | GSD owns its own state; plugin reads via GSD Bridge |
| Agent sessions | Paperclip agent_task_sessions table | Paperclip manages agent persistence across heartbeats |
| Decision log | Paperclip activity log + plugin state | Audit trail for CEO decisions |
| Retry counters | Pipeline FSM state (in plugin state) | Persisted so restarts don't reset retry budgets |

## Component Specifications

### Pipeline FSM

The central state machine governing the entire pipeline lifecycle. Implemented as a pure state machine (no side effects in transitions -- effects are triggered by the Phase Driver reacting to state changes).

**States:**

```
idle            -- No pipeline running
initializing    -- CEO agent creating project (new-project)
analyzing       -- Parsing roadmap, building execution plan
running         -- Actively processing phases
paused          -- User-requested pause (agents finish current work)
completed       -- All phases done and verified
failed          -- Unrecoverable failure (retries exhausted)
```

**Phase Sub-States (per phase, tracked in FSM context):**

```
pending         -- Not yet started (dependencies not met)
discussing      -- Discusser agent active
reviewing       -- CEO reviewing discuss output
planning        -- Planner agent active
executing       -- Executor agent active
verifying       -- Verifier agent active
done            -- Phase complete and verified
failed          -- Phase failed (retries exhausted)
blocked         -- Waiting on user decision
```

**Key Transitions:**

```
idle -> initializing           [START_PIPELINE event]
initializing -> analyzing      [PROJECT_READY signal from CEO]
analyzing -> running           [ROADMAP_PARSED internal event]
running -> paused              [PAUSE_REQUESTED API call]
paused -> running              [RESUME_REQUESTED API call]
running -> completed           [ALL_PHASES_DONE internal event]
running -> failed              [MAX_RETRIES_EXCEEDED]
* -> failed                    [UNRECOVERABLE_ERROR]

Per-phase transitions within "running":
pending -> discussing          [DEPENDENCIES_MET]
discussing -> reviewing        [DISCUSS_COMPLETE signal]
reviewing -> discussing        [REVISION_NEEDED signal from CEO]
reviewing -> planning          [APPROVED signal from CEO]
planning -> executing          [PLAN_COMPLETE signal]
executing -> verifying         [EXECUTE_COMPLETE signal]
verifying -> done              [VERIFY_COMPLETE signal]
verifying -> executing         [VERIFY_FAILED, retries remaining]
executing -> failed            [VERIFY_FAILED, retries exhausted]
```

**Implementation recommendation:** Do NOT use XState. A lightweight custom FSM (a typed transition table + context object) is simpler, has zero dependencies, and fits the Paperclip plugin model where state is serialized to plugin DB state. XState's actor model and subscription system would fight against Paperclip's event-driven model rather than complement it.

```typescript
// Conceptual structure (not final implementation)
interface PipelineState {
  status: PipelineStatus;
  phases: Map<number, PhaseState>;
  retryBudgets: Map<string, number>;
  executionPlan: ExecutionPlan;
  startedAt: string;
  lastTransition: string;
}

type PipelineEvent =
  | { type: 'START_PIPELINE'; brief: string }
  | { type: 'PROJECT_READY'; roadmapPath: string }
  | { type: 'SIGNAL_RECEIVED'; signal: GsdSignal }
  | { type: 'AGENT_FAILED'; phaseId: number; error: string }
  | { type: 'PAUSE_REQUESTED' }
  | { type: 'RESUME_REQUESTED' }
  | { type: 'RETRY_PHASE'; phaseId: number };

function transition(state: PipelineState, event: PipelineEvent): PipelineState {
  // Pure function: returns new state, no side effects
}
```

### Phase Driver

Orchestrates the execution order of phases based on the roadmap's dependency graph.

**Responsibilities:**
- Parse dependency graph from `gsd-tools roadmap analyze` output
- Build execution plan: group independent phases for parallel execution
- Enforce sequential merge strategy (phases commit in order even when run in parallel)
- React to FSM state changes and spawn appropriate agents
- Track which phases are eligible to start (dependencies met)

**Parallel Execution Model:**

```
Roadmap declares:
  Phase 1: no deps       -> Group A
  Phase 2: depends on 1  -> Group B
  Phase 3: no deps       -> Group A
  Phase 4: depends on 2  -> Group C

Execution:
  Group A: Phase 1 + Phase 3 run in parallel
  Group B: Phase 2 starts after Phase 1 completes
  Group C: Phase 4 starts after Phase 2 completes

Merge Order (sequential regardless of completion order):
  Phase 1 merges first -> Phase 2 -> Phase 3 -> Phase 4
```

**Merge Queue:** When parallel phases complete out of order, completed phases wait in a merge queue. The driver processes the queue in roadmap order. Each merge involves:
1. Verify the phase's work branch/changes are clean
2. Merge into main working tree
3. Run any post-merge verification
4. Mark phase as fully done in FSM

### GSD Bridge

Typed TypeScript wrapper around `gsd-tools.cjs` CLI invocations.

```typescript
// Conceptual interface
interface GsdBridge {
  // Project initialization
  initNewProject(cwd: string): Promise<InitContext>;

  // Roadmap operations
  analyzeRoadmap(cwd: string): Promise<RoadmapAnalysis>;
  getPhase(cwd: string, phaseNum: number): Promise<PhaseDefinition>;

  // State operations
  getState(cwd: string): Promise<ProjectState>;
  updateState(cwd: string, field: string, value: string): Promise<void>;

  // Phase operations
  findPhase(cwd: string, phaseNum: number): Promise<PhasePath>;
  completePhase(cwd: string, phaseNum: number): Promise<void>;

  // Verification
  verifyPhaseCompleteness(cwd: string, phaseNum: number): Promise<CompletenessReport>;
  validateConsistency(cwd: string): Promise<ConsistencyReport>;

  // Progress
  getProgress(cwd: string): Promise<ProgressMetrics>;
}
```

**Implementation:** Each method calls `child_process.execFile('node', ['gsd-tools.cjs', ...args, '--cwd', cwd])`, parses the JSON output, and returns typed results. Errors are caught at the bridge level and classified (retryable vs fatal).

### Signal Parser

Defines and enforces the structured comment protocol for agent-to-plugin communication.

**Signal Format:**

```
---
GSD_SIGNAL:<SIGNAL_TYPE>
phase: <number>
status: <success|failure|blocked>
artifacts:
  - <file_path>
summary: "<human-readable summary>"
error: "<error message if status=failure>"
decision_needed: <true|false>
decision_context: "<what needs deciding>"
---
```

**Signal Types:**

| Signal | Emitted By | Consumed By | Meaning |
|--------|-----------|-------------|---------|
| PROJECT_READY | CEO | Phase Driver | Roadmap created, ready to parse |
| DISCUSS_COMPLETE | Discusser | Phase Driver | Context gathered for phase |
| APPROVED | CEO | Phase Driver | Discuss output approved |
| REVISION_NEEDED | CEO | Phase Driver | Discuss output needs rework |
| PLAN_COMPLETE | Planner | Phase Driver | Execution plan ready |
| EXECUTE_COMPLETE | Executor | Phase Driver | Code implemented |
| VERIFY_COMPLETE | Verifier | Phase Driver | Verification passed |
| VERIFY_FAILED | Verifier | Phase Driver, Error Recovery | Verification found issues |
| DECISION_NEEDED | CEO | Notification Bus | User input required |
| DECISION_MADE | CEO | Phase Driver | CEO made autonomous decision |
| AGENT_ERROR | Any | Error Recovery | Unhandled agent failure |
| STALE_HEARTBEAT | Plugin (internal) | Error Recovery | Agent not responding |

### Agent Factory

Creates Paperclip issues with appropriate context for each agent role. Does NOT run agents -- Paperclip's heartbeat system handles spawning.

**Process:**
1. Receives request from Phase Driver: "create discusser for phase 3"
2. Calls Context Builder for the agent's context blob
3. Selects Agent Template for the role
4. Creates Paperclip issue via API with:
   - Title: `[GSD] Phase 3: Discuss - Auth System`
   - Description: assembled from template + context
   - Assignee: the designated agent for this role
   - Parent: pipeline's root issue
   - Labels/metadata for tracking
5. Returns issue ID to Phase Driver for tracking

### Context Builder

Assembles the information each agent type needs to do its job.

| Agent Type | Context Includes |
|-----------|-----------------|
| **CEO** | Project brief, ROADMAP.md, REQUIREMENTS.md, decision history, user preferences |
| **Discusser** | Phase definition from roadmap, existing codebase context, prior phase outputs |
| **Planner** | CONTEXT.md from discuss, phase definition, execution constraints, template paths |
| **Executor** | Plan files, codebase map, phase directory, test requirements, merge strategy rules |
| **Verifier** | Plan files, implemented code diff, verification checklist, acceptance criteria |

Context is injected via:
- Issue description (primary context)
- Environment variables (PAPERCLIP_* vars + GSD-specific vars)
- Skill injection (Paperclip's runtime skill system for agent instructions)

### Agent Templates

Static configuration objects defining each agent role.

```typescript
interface AgentTemplate {
  role: 'ceo' | 'discusser' | 'planner' | 'executor' | 'verifier';
  adapterType: 'claude_local';
  systemPromptPath: string;       // Path to role-specific CLAUDE.md
  gsdCommand: string;             // e.g., '/gsd:discuss-phase'
  gsdFlags: string[];             // e.g., ['--auto']
  expectedSignals: SignalType[];  // What signals this agent should emit
  timeoutMs: number;              // Max runtime before stale detection
  retryable: boolean;             // Whether failures can be retried
}
```

### Error Recovery

Classifies failures and determines recovery strategy.

**Failure Classes:**

| Class | Examples | Strategy |
|-------|----------|----------|
| **Transient** | Claude API rate limit, network timeout, process crash | Retry with exponential backoff (max 3 attempts) |
| **Stale** | Agent heartbeat timeout, no signal after expected time | Kill agent, respawn with fresh context |
| **Deterministic** | GSD validation failure, missing prerequisites | Do not retry -- escalate to CEO or user |
| **Catastrophic** | Corrupt state, irrecoverable git state | Halt pipeline, notify user, preserve state for debugging |

**Stale Agent Detection:**
- Each agent type has an expected maximum runtime (from template)
- Phase Driver starts a timer when spawning each agent
- If no signal received within timeout: emit STALE_HEARTBEAT
- Error Recovery kills the stale agent and respawns (up to retry budget)

**Recovery Flow:**
```
Agent failure detected
  -> Error Recovery classifies failure
  -> If retryable: decrement retry budget, re-enter current phase sub-state
  -> If not retryable: transition to blocked, notify CEO
  -> CEO decides: retry with different approach, skip phase, or escalate to user
  -> If user escalation: DECISION_NEEDED signal -> Discord notification
```

### Notification Bus

Formats pipeline events for human consumption and routes them through Paperclip's activity system to OpenClaw/Discord.

**Event Types Surfaced to User:**

| Event | Discord Message |
|-------|----------------|
| Pipeline started | "Starting project: {name}. {N} phases detected." |
| Phase completed | "Phase {N} ({name}) complete. {progress}% done." |
| CEO decision made | "CEO decided: {summary}. Reason: {rationale}" |
| Decision needed | "@user: Decision needed for {context}. Reply to approve/reject." |
| Phase failed | "Phase {N} failed after {retries} attempts: {error}" |
| Pipeline complete | "Project complete. All {N} phases verified." |

## Patterns to Follow

### Pattern 1: Event-Driven Reaction (Not Polling)

**What:** The plugin reacts to Paperclip events (issue status changes, comments) rather than polling for agent completion.

**When:** Always. This is the core communication model.

**Why:** Paperclip's event system exists specifically for this. Polling wastes resources and adds latency. The plugin subscribes to events, the Signal Parser filters for relevant signals, and the Phase Driver reacts.

```typescript
// Plugin subscribes to events in definePlugin
definePlugin({
  events: {
    'issue.comment.created': async (ctx, event) => {
      const signal = signalParser.parse(event.comment.body);
      if (signal) {
        const newState = pipelineFsm.transition(currentState, {
          type: 'SIGNAL_RECEIVED',
          signal,
        });
        await phaseDriver.react(newState, signal);
      }
    },
    'issue.status.changed': async (ctx, event) => {
      // Handle agent completing/failing via issue status
    },
  },
});
```

### Pattern 2: Immutable State Transitions

**What:** Pipeline FSM transitions are pure functions. The transition function takes current state + event, returns new state. Side effects happen after the transition, driven by the Phase Driver comparing old and new state.

**When:** All state changes.

**Why:** Makes the pipeline debuggable, testable, and replayable. If something goes wrong, you can inspect the state history. Also enables persisting state to Paperclip's plugin DB after each transition.

### Pattern 3: Agent Ignorance

**What:** Agents are given a task and context. They do not know they are part of a pipeline, do not know about other agents, and do not coordinate with each other.

**When:** Always. This is a hard boundary.

**Why:** Simplifies agent prompts enormously. Each agent is a focused specialist with a clear job. The plugin handles all coordination. This also means agents can be replaced, upgraded, or reconfigured without changing the pipeline logic.

### Pattern 4: Context Assembly at Spawn Time

**What:** All context an agent needs is assembled and injected when the issue is created. Agents never call back to the plugin for more context.

**When:** Agent creation via Agent Factory.

**Why:** Claude Code instances run as independent processes. They cannot call plugin APIs. All information must be in the issue description, environment variables, or injected skills.

### Pattern 5: Idempotent Operations

**What:** Every pipeline operation should be safe to retry. If the plugin crashes and restarts, it reads persisted state and resumes from the last committed transition.

**When:** All state transitions and agent spawning.

**Why:** Paperclip plugins can restart. Agents can time out. The pipeline must survive interruptions. The FSM reads its last persisted state on startup and determines what to do next.

## Anti-Patterns to Avoid

### Anti-Pattern 1: Agent-to-Agent Direct Communication

**What:** Agents passing information to each other directly (shared files, direct API calls, environment variable passing between agents).

**Why bad:** Creates invisible dependencies. Breaks the supervisor model. Makes debugging impossible -- you cannot trace data flow through the system.

**Instead:** All inter-agent data flows through the pipeline. Agent A writes artifacts (files, comments). The plugin reads them. The plugin injects relevant artifacts into Agent B's context at spawn time. The plugin is always the intermediary.

### Anti-Pattern 2: Fat Agent Prompts with Pipeline Logic

**What:** Telling agents "after you finish discussing, the planner will run, so make sure to format your output for the planner."

**Why bad:** Couples agents to pipeline implementation. Makes agents fragile to pipeline changes. Agents should not know or care what happens after they finish.

**Instead:** Agents follow GSD's existing output conventions (CONTEXT.md, plan files, etc.). The Context Builder knows how to translate outputs into inputs for the next agent.

### Anti-Pattern 3: Polling for Agent Completion

**What:** A timer loop checking "is the agent done yet?" by querying issue status.

**Why bad:** Wastes resources, adds latency (poll interval), and fights against Paperclip's event-driven architecture.

**Instead:** Subscribe to issue events. React when status changes or signals arrive.

### Anti-Pattern 4: Monolithic State Object

**What:** Storing all pipeline state in one giant JSON blob that every component reads and writes.

**Why bad:** Race conditions when parallel phases update simultaneously. Difficult to reason about which component changed what.

**Instead:** Pipeline FSM owns the authoritative state. Components request specific data through the FSM interface. Updates go through typed events/transitions.

### Anti-Pattern 5: Reimplementing GSD Logic

**What:** Parsing ROADMAP.md directly, implementing phase state transitions in plugin code, duplicating gsd-tools functionality.

**Why bad:** GSD already has robust, tested parsing and state management. Duplicating it creates drift, bugs, and maintenance burden.

**Instead:** Use GSD Bridge for all GSD operations. If gsd-tools.cjs does not have a command you need, add it to gsd-tools.cjs (upstream contribution), do not reimplement in the plugin.

## Scalability Considerations

| Concern | v1 (1 project) | Future (multi-project) | Notes |
|---------|-----------------|----------------------|-------|
| Concurrent agents | 3-5 parallel (CPU/memory bound) | Queue with concurrency limits | Paperclip already has concurrency controls |
| State storage | Plugin state DB (small) | Same (pipeline state is lightweight) | GSD files are the bulk, on filesystem |
| Event throughput | ~10 events/minute peak | Partition by project | Paperclip WebSocket handles this |
| Git conflicts | Sequential merge queue | Per-project merge queues | Already designed for this via merge strategy |
| Agent cost | Budget tracking via Paperclip | Budget per project/phase | Paperclip has per-agent budget controls |

## Suggested Build Order

Based on component dependencies, the build order should be:

### Layer 0: Foundation (must exist first)

1. **Plugin Shell** -- The `definePlugin()` entry point, manifest, basic lifecycle. Everything depends on this to register with Paperclip.
2. **GSD Bridge** -- Typed wrapper around gsd-tools.cjs. Most components need roadmap/state data.

**Rationale:** Cannot test anything without a working plugin that can call gsd-tools.

### Layer 1: Core State (depends on Layer 0)

3. **Pipeline FSM** -- The state machine with all transitions defined and tested. Pure logic, no I/O, highly testable.
4. **Signal Parser** -- Comment parsing/generation. Also pure logic, highly testable.

**Rationale:** These are pure functions that can be unit tested exhaustively before any integration work.

### Layer 2: Agent Communication (depends on Layers 0-1)

5. **Agent Templates** -- Static config definitions for each role. Trivial to write once the contract is clear.
6. **Context Builder** -- Assembles context blobs. Depends on GSD Bridge for state reading.
7. **Agent Factory** -- Creates Paperclip issues with context. Depends on templates and context builder.

**Rationale:** Agent Factory is the plugin's primary output mechanism. Once this works, you can manually trigger individual agents and observe their behavior.

### Layer 3: Orchestration (depends on Layers 0-2)

8. **Phase Driver** -- The sequencer that ties FSM to Agent Factory. This is the most complex component.
9. **Error Recovery** -- Failure classification, retry logic, stale detection. Depends on FSM and Phase Driver.

**Rationale:** Phase Driver is where the real orchestration complexity lives. Build it after all the pieces it coordinates are solid.

### Layer 4: User Interface (depends on Layers 0-3)

10. **Notification Bus** -- Activity events and Discord-facing messages.
11. **REST Endpoints** -- Pipeline control API (start, status, pause, resume, retry).
12. **OpenClaw Integration** -- Full chat loop for Discord interaction.

**Rationale:** These are the user-facing surfaces. They should be last because they depend on a working pipeline, and getting the core right matters more than pretty output.

### Dependency Graph

```
Layer 0: Plugin Shell ---- GSD Bridge
              |                |
Layer 1: Pipeline FSM    Signal Parser
              |          /    |
Layer 2: Agent Templates  Context Builder
              |               |
          Agent Factory ------+
              |
Layer 3: Phase Driver
              |
          Error Recovery
              |
Layer 4: Notification Bus
          REST Endpoints
          OpenClaw Integration
```

## Sources

- [Paperclip GitHub Repository](https://github.com/paperclipai/paperclip) - Platform source code and documentation (HIGH confidence)
- [Paperclip Plugin Specification](https://github.com/paperclipai/paperclip/blob/master/doc/plugins/PLUGIN_SPEC.md) - definePlugin API, plugin lifecycle, JSON-RPC model (HIGH confidence)
- [Paperclip Heartbeat Documentation](https://paperclipai.info/blogs/explain_heartbeat/) - Agent execution lifecycle (HIGH confidence)
- [Paperclip Core Concepts](https://github.com/paperclipai/paperclip/blob/master/docs/start/core-concepts.md) - Domain entities and concepts (HIGH confidence)
- [Paperclip Monorepo Structure (DeepWiki)](https://deepwiki.com/paperclipai/paperclip/1.2-monorepo-structure) - Architecture overview (HIGH confidence)
- [GSD Tools Architecture (DeepWiki)](https://deepwiki.com/gsd-build/get-shit-done/9.1-overview-and-architecture) - gsd-tools.cjs CLI reference (HIGH confidence)
- [Azure AI Agent Design Patterns](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/ai-agent-design-patterns) - Industry orchestration patterns (MEDIUM confidence)
- [Hierarchical Agent Systems Patterns](https://www.ruh.ai/blogs/hierarchical-agent-systems) - Manager/worker pattern reference (MEDIUM confidence)
- [Confluent Event-Driven Multi-Agent Systems](https://www.confluent.io/blog/event-driven-multi-agent-systems/) - Event-driven communication patterns (MEDIUM confidence)
- [Agent Orchestration Patterns Comparison](https://gurusup.com/blog/agent-orchestration-patterns) - Swarm vs mesh vs hierarchical analysis (MEDIUM confidence)
