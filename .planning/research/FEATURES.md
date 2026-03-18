# Feature Landscape

**Domain:** AI agent orchestration plugin for automated development workflow (GSD pipeline automation via Paperclip)
**Researched:** 2026-03-18

## Table Stakes

Features users expect. Missing = the plugin feels broken or unusable.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| End-to-end pipeline execution | Core value prop: send brief, get built project. If any phase can't run autonomously, the entire plugin is pointless. | High | Requires: CEO agent, specialist agents, gsd-tools bridge, phase sequencing. This is THE feature. |
| Pipeline state machine | Without explicit states (idle/discussing/planning/executing/verifying/done/failed), there's no way to know what's happening or recover from failures. Every production orchestrator uses state machines (LangGraph, CrewAI, etc). | Medium | Formal FSM with well-defined transitions. Paperclip issues already model work units -- state machine layers on top. |
| Phase dependency resolution | GSD roadmaps declare phase dependencies. Ignoring them means either running everything sequentially (slow) or running everything in parallel (broken). Users expect the system to be smart about this. | Medium | Parse dependency info from gsd-tools.cjs. Topological sort to determine parallel vs sequential phases. |
| Parallel phase execution | If phases A and B are independent, they must run simultaneously. Running them sequentially when they could be parallel is an obvious perf miss that users will immediately question. | High | Git worktree or sequential merge strategy needed. PROJECT.md specifies single branch + sequential merge. |
| Error detection and basic retry | Agents fail -- network issues, context overflow, malformed output. Every production agent framework provides at minimum retry with backoff. Without this, the pipeline breaks on the first transient error. | Medium | Classify errors: transient (retry), agent error (retry with modified context), fatal (escalate). Exponential backoff with jitter. |
| Status visibility via Discord | Users interact via Discord through OpenClaw. If they send a project brief and get silence, the plugin is broken from their perspective. They need to know what's happening at every stage. | Medium | Phase transitions, agent spawning, completion, failures -- all must push status to OpenClaw which forwards to Discord. |
| CEO agent for Q&A decisions | GSD phases have interactive prompts. Without a CEO agent handling these, the pipeline blocks on human input -- defeating the entire purpose of autonomous execution. | High | CEO uses `--auto` flag where possible, makes decisions aligned with project brief for interactive prompts. Needs project context injection. |
| CEO quality gate (discuss -> plan) | The CEO must review CONTEXT.md output from discussion before planning proceeds. Without this, garbage discussion output cascades into garbage plans and garbage code. This is the "bounded autonomy" pattern that every serious orchestrator implements. | Medium | CEO reviews, approves or requests revision. Revision loops back to discuss phase. Gate is between discuss and plan per PROJECT.md. |
| Inter-agent communication protocol | Agents need structured ways to pass results, signal completion, and flag issues. Free-form text between agents leads to parsing failures and lost information. | Medium | GSD_SIGNAL structured comments on Paperclip issues. PROJECT.md already specifies this pattern. JSON payloads with defined schemas. |
| Pipeline control API | REST endpoints for start, status, retry. Without these, the plugin can only be triggered via Discord -- no programmatic control, no integration with other tools. | Low | Paperclip's `definePlugin()` already supports endpoint registration. Thin wrapper around state machine. |
| Sequential merge strategy | Parallel phases producing code must merge without conflicts. Without a merge strategy, parallel execution is actually broken. | High | Phases run in parallel worktrees/contexts but commit results sequentially in dependency order. Conflict detection + resolution or re-execution on failure. |

## Differentiators

Features that set this plugin apart. Not expected from a v1, but would significantly increase value.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| CEO decision audit log | Full traceability of every autonomous decision. Users can review why the CEO chose architecture X over Y, why it approved a discussion output, why it retried a phase. Builds trust in autonomous execution. "Trust but verify" is the 2026 pattern. | Low | Append-only log with timestamp, decision context, options considered, choice made, reasoning. Low complexity because it's just structured logging -- but high value for user confidence. |
| Intelligent error classification | Beyond basic retry: categorize failures (transient, context overflow, test failure, merge conflict, stale agent) and apply different recovery strategies for each. Most orchestrators just retry blindly; smart classification dramatically improves recovery rates. | Medium | Pattern matching on error output. Context overflow -> summarize and retry. Test failure -> feed test output back to executor. Merge conflict -> re-execute phase with updated base. |
| CEO escalation to human | For high-stakes decisions (architecture changes, scope expansion, ambiguous requirements), CEO pings the Discord user and waits for input rather than guessing. This is the "bounded autonomy" pattern -- autonomous for routine decisions, human-in-the-loop for critical ones. | Medium | Decision classification: routine (auto-decide) vs critical (escalate). Non-blocking for the pipeline where possible -- other phases continue while waiting. Timeout + default behavior if human doesn't respond. |
| Pipeline pause/resume | User can pause a running pipeline, review partial results, then resume. Valuable when the user sees early results heading in the wrong direction. Every mature orchestrator (LangGraph, Vercel's workflow library) supports this. | Medium | State machine already captures current state. Pause = stop spawning new agents, let running agents complete. Resume = restart from paused state. Requires checkpoint persistence. |
| Cost/token tracking per phase | Each GSD phase consumes tokens. Users want to know: how much did discussion cost vs execution? Is one phase disproportionately expensive? Enables budget management and optimization. | Low | Track Claude Code CLI token usage per agent invocation. Aggregate by phase. Report in status updates and audit log. Claude API already exposes token counts. |
| Phase-level retry (not full pipeline) | When phase 3 fails, retry just phase 3 -- not the entire pipeline from scratch. Saves 60%+ of wasted computation (per checkpointing research). | Medium | Requires clean phase boundaries and state persistence. Each phase's inputs/outputs must be independently checkpointable. GSD's file-based artifacts (CONTEXT.md, plans, code) make this natural. |
| Stale agent detection | Agents that stop producing output (hung Claude Code process, network timeout) need to be detected and replaced. Without this, a single hung agent blocks the entire pipeline indefinitely. | Medium | Heartbeat monitoring. Paperclip already has agent heartbeat system. If an agent misses heartbeats beyond threshold, kill and respawn. |
| Progress estimation | Rough estimates of how long each phase will take, based on phase complexity and historical data. Users want "Phase 3 of 6, ~15 min remaining" not just "running". | Low | Track historical phase durations. Simple rolling average. Display in Discord status updates. Accuracy improves over time. Not critical for v1 but delightful. |
| Dynamic re-planning | If execution reveals that the original plan was wrong (e.g., a dependency doesn't work as expected), the CEO can modify the plan rather than blindly continuing. Devin v3.0 added this in 2026 -- it's becoming expected for sophisticated orchestrators. | High | CEO monitors execution results, detects plan deviations, can trigger re-planning. Requires CEO to understand the full project context and have authority to modify the roadmap. Complex because it touches every part of the pipeline. |
| Notification preferences | Let users configure what notifications they receive: all phase transitions, only failures, only completion, only CEO escalations. Avoids notification fatigue for long pipelines. | Low | Configuration stored per project or per user. Filter notification events before forwarding to OpenClaw. Simple but polished. |

## Anti-Features

Features to explicitly NOT build.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Custom LLM selection per agent | PROJECT.md explicitly scopes this out. GSD already has a model profile system. Reimplementing model selection adds complexity without value and fragments the config surface. | Use GSD's existing model profile system. Agents inherit model config from GSD. |
| Custom dashboard UI | Paperclip already provides a dashboard with plugin UI slots. Building a standalone dashboard means maintaining a frontend, auth, deployment -- none of which is the plugin's value prop. | Use Paperclip's existing dashboard slots for any visual UI. Discord via OpenClaw is the primary interface. |
| GSD file parsing reimplementation | gsd-tools.cjs already does this well. Reimplementing means tracking GSD format changes, maintaining a parallel parser, and introducing subtle incompatibilities. | Use gsd-tools.cjs bridge. Wrap the CLI, don't rewrite it. |
| Multi-project pipelines | Running multiple projects simultaneously in v1 massively increases complexity: resource contention, priority scheduling, cross-project dependencies. Ship single-project first, learn from it. | One pipeline at a time. Queue additional project requests. Multi-project is a future feature after v1 stability is proven. |
| Agent-to-agent free-form chat | Letting agents have unstructured conversations leads to unpredictable behavior, hallucinated protocols, and impossible-to-debug interactions. The 2026 consensus is structured communication beats free-form for production systems. | Structured GSD_SIGNAL protocol with defined message schemas. Agents communicate through structured comments, not conversation. |
| Autonomous deployment | The plugin builds code, it should NOT deploy it. Deploying untested-in-production code without human review violates the "bounded autonomy" principle and creates real-world damage risk. | Pipeline ends at "verified code committed." User reviews and deploys manually. Deployment integration is a future feature with explicit human approval gates. |
| Browser/web interaction for agents | Adding browser automation (Playwright, Puppeteer) to agents massively increases the failure surface and resource requirements. Agents should work with code, files, and CLI tools only. | Agents use terminal, code editor, and file system. If web research is needed, the CEO agent can use GSD's existing research phase which handles it. |
| Real-time streaming of agent output | Streaming every line of Claude Code's output to Discord would flood the chat, hit rate limits, and provide no actionable information. It's noise, not signal. | Structured status updates at meaningful transitions (phase started, phase completed, decision made, error occurred). Summary, not stream. |
| Git branching strategy per phase | Creating separate branches per phase adds merge complexity, branch management overhead, and conflict resolution needs. The single-branch sequential merge strategy is simpler and proven. | Single branch. Phases commit sequentially in order. PROJECT.md already made this decision. |

## Feature Dependencies

```
Pipeline state machine -> Everything else (foundation for all features)
  |
  +-> End-to-end pipeline execution
  |     |
  |     +-> CEO agent for Q&A decisions
  |     |     |
  |     |     +-> CEO quality gate (discuss -> plan)
  |     |     +-> CEO escalation to human
  |     |     +-> CEO decision audit log
  |     |
  |     +-> Phase dependency resolution
  |     |     |
  |     |     +-> Parallel phase execution
  |     |           |
  |     |           +-> Sequential merge strategy
  |     |
  |     +-> Inter-agent communication protocol (GSD_SIGNAL)
  |     |
  |     +-> gsd-tools.cjs bridge (required by all phase agents)
  |
  +-> Error detection and basic retry
  |     |
  |     +-> Intelligent error classification
  |     +-> Stale agent detection
  |     +-> Phase-level retry
  |
  +-> Pipeline control API (start, status, retry)
  |     |
  |     +-> Pipeline pause/resume
  |
  +-> Status visibility via Discord (OpenClaw integration)
        |
        +-> Notification preferences
        +-> Cost/token tracking per phase
        +-> Progress estimation
```

## MVP Recommendation

**Prioritize (v1 must-ship):**

1. **Pipeline state machine** -- Foundation. Build this first. Everything depends on it.
2. **gsd-tools.cjs bridge** -- Without this, agents can't interact with GSD at all.
3. **Inter-agent communication protocol** -- Agents need structured communication before they can do useful work.
4. **CEO agent for Q&A decisions** -- The autonomy enabler. Without the CEO, the pipeline blocks on human input.
5. **End-to-end pipeline execution (sequential)** -- Run phases one at a time first. Prove the pipeline works before parallelizing.
6. **Phase dependency resolution** -- Parse the roadmap to understand what can parallelize.
7. **Parallel phase execution + sequential merge** -- The performance payoff. Move from sequential to parallel after proving the pipeline.
8. **CEO quality gate** -- The first quality checkpoint. Prevents garbage-in-garbage-out cascades.
9. **Error detection and basic retry** -- Transient failures will happen. Basic retry with backoff is minimum viable reliability.
10. **Status visibility via Discord** -- Users must see what's happening. Without this, the UX is "send message, wait in darkness."
11. **Pipeline control API** -- Start, status, retry at minimum. Programmatic control enables everything else.

**Defer to post-v1:**

- **CEO escalation to human** -- v1 can have the CEO auto-decide everything. Escalation adds UX complexity (timeout handling, non-blocking waits). Ship after v1 proves the pipeline works.
- **Pipeline pause/resume** -- Requires checkpoint persistence. v1 can require restarting failed pipelines. Add pause/resume once the state machine is battle-tested.
- **Dynamic re-planning** -- Highest complexity feature. v1 runs the plan as-is. Re-planning requires the CEO to understand when plans are failing and how to fix them -- a significant AI challenge on top of the orchestration challenge.
- **Notification preferences** -- v1 sends all notifications. Filtering is polish.
- **Progress estimation** -- Needs historical data that doesn't exist yet. Ship after collecting phase duration data from real runs.
- **Cost/token tracking** -- Valuable but not blocking. Can be added as a logging concern without changing the core pipeline.

**Ordering rationale:** The dependency graph dictates order. State machine is foundation. gsd-tools and communication protocol enable agents. CEO enables autonomy. Sequential pipeline proves correctness. Parallelism adds performance. Quality gates add reliability. Error handling adds resilience. Status visibility completes the user experience. Everything after that is optimization and polish.

## Sources

- [Addy Osmani - The future of agentic coding: conductors to orchestrators](https://addyosmani.com/blog/future-agentic-coding/)
- [Mike Mason - AI Coding Agents in 2026: Coherence Through Orchestration](https://mikemason.ca/writing/ai-coding-agents-jan-2026/)
- [Deloitte - Unlocking exponential value with AI agent orchestration](https://www.deloitte.com/us/en/insights/industry/technology/technology-media-and-telecom-predictions/2026/ai-agent-orchestration.html)
- [Microsoft - AI Agent Orchestration Patterns](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/ai-agent-design-patterns)
- [IBM - What is AI Agent Orchestration](https://www.ibm.com/think/topics/ai-agent-orchestration)
- [Galileo - Multi-Agent AI Failure Recovery That Actually Works](https://galileo.ai/blog/multi-agent-ai-system-failure-recovery)
- [LangGraph - Agent Orchestration Framework](https://www.langchain.com/langgraph)
- [Cognition - Devin AI Guide 2026](https://aitoolsdevpro.com/ai-tools/devin-guide/)
- [Claude Code - Orchestrate teams of Claude Code sessions](https://code.claude.com/docs/en/agent-teams)
- [GitHub Copilot - Coding Agent](https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent)
- [CrewAI vs LangGraph: Why Production Systems Need State Machines](https://christianmendieta.ca/crewai-vs-langgraph-why-production-systems-need-state-machines/)
- [Fast.io - AI Agent Rollback Strategy](https://fast.io/resources/ai-agent-rollback-strategy/)
- [Statsig - Token usage tracking](https://www.statsig.com/perspectives/tokenusagetrackingcontrollingaicosts)
- [QuantumBlack - Agentic workflows for software development](https://medium.com/quantumblack/agentic-workflows-for-software-development-dc8e64f4a79d)
