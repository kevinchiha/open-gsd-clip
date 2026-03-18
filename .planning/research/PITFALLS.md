# Pitfalls Research

**Domain:** AI agent orchestration plugin (Paperclip + Claude Code CLI + GSD workflow)
**Researched:** 2026-03-18
**Confidence:** HIGH (multiple verified sources, real-world failure reports)

## Critical Pitfalls

### Pitfall 1: Context Window Exhaustion Silently Destroys Agent Work

**What goes wrong:**
Claude Code auto-compacts at ~95% context usage (200K tokens), silently summarizing the entire conversation history. When this happens mid-task (e.g., during `execute-phase`), the agent loses file paths, error messages, debugging state, and partially-completed work. It then re-reads files to recover, filling context again and entering a degradation loop. GSD commands like `/gsd:execute-phase` can be long-running with heavy tool use, making this especially likely during execution phases.

**Why it happens:**
Each Claude Code session accumulates context from tool calls (file reads, bash output, git operations). GSD execution phases involve reading plans, writing code, running tests, and iterating -- easily consuming 150K+ tokens in a single phase. Developers build the orchestrator assuming agents can complete any task in a single session without context pressure.

**How to avoid:**
- Scope agent tasks narrowly. Instead of "execute entire phase," break into wave-based sub-tasks that each fit within ~60% of the context window.
- Use GSD's existing wave-based execution model -- each wave becomes a separate Claude Code invocation with `--resume` to continue the session, or a fresh session with a focused prompt.
- Set `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` to a lower value (e.g., 70%) so compaction happens earlier and more gracefully.
- Put critical state (current wave, completed files, remaining tasks) in `CLAUDE.md` or structured files that survive compaction, not in conversation history.
- Monitor token usage via `stream-json` output events and trigger graceful handoff before exhaustion.

**Warning signs:**
- Agents taking longer than expected on execution phases (they are re-reading files post-compaction).
- Agent output referencing "let me re-read..." or "I need to check..." for files it already processed.
- Token usage in `stream-json` events approaching 150K.
- Agents producing partial or inconsistent code after long sessions.

**Phase to address:**
Core agent lifecycle management (early phase). Must be baked into the specialist agent spawning logic from the start -- not bolted on later.

---

### Pitfall 2: Git State Corruption from Parallel Phase Execution

**What goes wrong:**
Even with a "single branch, sequential merge" strategy, parallel agents can corrupt git state in subtle ways. Agent A completes and commits while Agent B is still running. Agent B's working directory now has uncommitted changes that conflict with Agent A's commit. When Agent B tries to commit, git rejects it or creates a broken merge. Worse: if both agents run `git add .` or `git commit`, they can interleave commits in unpredictable order.

**Why it happens:**
The project plans parallel execution of independent phases on a single branch. While the roadmap says "sequential merges," the actual git operations happen inside Claude Code sessions that the orchestrator does not directly control. Claude Code agents issue their own git commands based on GSD's execution flow, and the orchestrator cannot atomically serialize commits without explicit coordination.

**How to avoid:**
- Use git worktrees (the community-proven pattern for parallel AI agents). Each parallel phase gets its own worktree with its own branch. Merge sequentially into main after verification. This is the approach endorsed by the Claude Code team at Anthropic.
- If staying single-branch: implement a commit mutex. Only one agent can be in "commit mode" at a time. Use a lock file or Paperclip issue state to coordinate.
- Never let agents run `git add .` or `git add -A`. Constrain `--allowedTools` to specific git commands, or use GSD's commit patterns that add specific files.
- Stage a "merge agent" that handles all git integration after phase agents complete their work in isolated directories or worktrees.

**Warning signs:**
- Merge conflict errors in agent logs.
- Agents reporting "working tree is not clean" errors.
- Commits appearing in unexpected order in git log.
- Test failures after merging that did not appear in individual phase verification.

**Phase to address:**
Phase execution and parallel coordination (must be decided architecturally before any parallel execution is built). This is foundational -- changing the git strategy later requires reworking every agent's workflow.

---

### Pitfall 3: The "Bag of Agents" Anti-Pattern (17x Error Multiplication)

**What goes wrong:**
Without structured coordination topology, errors multiply exponentially across agents. A bad decision by the CEO agent (e.g., approving a flawed CONTEXT.md) propagates to the planner, which creates a bad plan, which the executor faithfully implements, which the verifier may not catch because it checks against the bad plan. Research from Towards Data Science documents this as the "17x error trap" -- in uncoordinated multi-agent systems, a single upstream error creates ~17x the downstream damage compared to a single-agent system.

**Why it happens:**
Developers focus on making each agent work individually (CEO answers questions, planner creates plans, executor writes code) without designing the validation boundaries between them. Each handoff is an unvalidated boundary where errors can slip through and compound.

**How to avoid:**
- Typed schemas at every agent boundary. The CEO's CONTEXT.md approval must validate against a schema. The planner's output must match a plan schema. The executor's deliverables must be checkable.
- Closed-loop feedback: if the verifier fails, it does not just report "failed" -- it produces structured feedback that routes back to the correct upstream agent (executor, planner, or even CEO).
- CEO quality gates must be substantive, not rubber-stamps. The CEO agent should have specific validation criteria for each phase transition, not just "looks good."
- Use GSD_SIGNAL structured comments with typed payloads, not free-form text, for all inter-agent communication.

**Warning signs:**
- Verifier consistently passing phases (means it is not catching anything, not that everything is perfect).
- Downstream agents asking the same questions the CEO already answered (context not propagating).
- Executor producing code that does not match the plan (plan was ambiguous or malformed).
- Pipeline completing "successfully" but the final codebase does not match the original project brief.

**Phase to address:**
Agent signal protocol design and CEO quality gates (must be designed before building individual agents). The coordination topology determines everything downstream.

---

### Pitfall 4: Claude Code Subprocess Token Bloat (50K Per Spawn)

**What goes wrong:**
Each Claude Code CLI subprocess consumes ~50K tokens on its first turn just from system prompt injection -- loading `CLAUDE.md`, MCP tool descriptions, plugin skills, and user settings. In a pipeline with 5 phases x 4 steps (discuss, plan, execute, verify) = 20 agent spawns, that is 1M tokens burned on overhead alone before any actual work happens. This creates massive cost and latency.

**Why it happens:**
Claude Code re-reads global settings on every spawn. Without isolation, it loads `~/CLAUDE.md`, all enabled plugins, all MCP server tool descriptions (10-20K tokens alone), and user-level settings. The orchestrator spawns fresh processes for each step, and each one pays this initialization tax.

**How to avoid:**
- Apply the 4-layer isolation pattern for every agent spawn:
  1. Set `cwd` to a scoped workspace directory (not user home).
  2. Create `.git/HEAD` in workspace to block upward CLAUDE.md traversal.
  3. Point `--plugin-dir` to an empty directory (or minimal plugin set).
  4. Use `--setting-sources project,local` to exclude user-level configuration.
- Use `--resume` with session IDs to continue existing sessions rather than spawning fresh ones for sequential steps within the same phase (discuss -> CEO review -> plan within one session).
- Use `--append-system-prompt` with focused instructions instead of loading broad CLAUDE.md files.
- Consider persistent `stream-json` connections for agents that need multiple turns, sending system prompt only once.

**Warning signs:**
- High API costs relative to actual work output.
- Agent startup taking 10-30 seconds before producing any output.
- Token usage metrics showing large spikes at session start that dwarf actual task tokens.

**Phase to address:**
Agent spawning infrastructure (core implementation phase). This optimization should be built into the `claude_local` adapter usage from the beginning, not retrofitted.

---

### Pitfall 5: State Inconsistency Between Three Sources of Truth

**What goes wrong:**
The system has three independent state stores: (1) Paperclip issues and their status, (2) GSD's `.planning/` state files on disk (roadmap, phase status, CONTEXT.md), and (3) the plugin's pipeline state machine in memory/database. These drift apart. The pipeline state says "phase 3 executing" but GSD's state file says "phase 3 planned" because the agent crashed before GSD updated its state. Or Paperclip's issue says "in progress" but the pipeline already moved on.

**Why it happens:**
Each state update is a separate operation with no transaction boundaries. GSD updates files on disk. Paperclip updates issue status via API. The pipeline state machine updates its own store. Any failure between these updates leaves the system in an inconsistent state. This is fundamentally a distributed consensus problem without the tooling to solve it.

**How to avoid:**
- Designate ONE authoritative source of truth. Recommendation: GSD's files on disk are the ground truth (they are what the agents actually read/write). The pipeline state machine derives from GSD state. Paperclip issue status is a projection.
- On every state transition, read GSD state first to confirm the expected precondition before advancing.
- Implement a reconciliation loop that periodically checks GSD files against pipeline state and heals divergence.
- Never update pipeline state optimistically. Only mark a phase as "discussing" after confirming the GSD discuss command actually started.
- Log every state transition with timestamps and source, so debugging inconsistency is possible.

**Warning signs:**
- Pipeline dashboard showing different status than what git/files show.
- Agents attempting to execute a phase that has not been planned according to GSD state files.
- Retry logic creating duplicate work because it cannot determine what actually completed.
- "Phase already completed" errors when the pipeline thinks it is still in progress.

**Phase to address:**
Pipeline state machine design (foundational phase). The state management strategy must be designed before building phase transitions. Retrofitting a single source of truth is extremely painful.

---

### Pitfall 6: CEO Agent Making Unchecked Autonomous Decisions

**What goes wrong:**
The CEO agent, designed to handle Q&A decisions during GSD interactive prompts, starts making architectural and scope decisions that should involve humans. It approves removing a feature from scope. It decides to use a different database than specified. It answers design questions with plausible but wrong answers because it lacks domain context the human has. These decisions propagate silently through the pipeline and are only discovered when the final product does not match expectations.

**Why it happens:**
The line between "routine decisions" and "strategic decisions" is hard to draw programmatically. LLMs are confidently wrong -- the CEO agent will not say "I do not know" unless explicitly prompted to. The human gets notifications about decisions but does not review them in real time (that is the point of autonomous operation). By the time the human reviews the audit log, downstream work is already based on bad decisions.

**How to avoid:**
- Classify decisions explicitly. Define a taxonomy: ROUTINE (CEO decides alone), NOTABLE (CEO decides, notifies immediately), STRATEGIC (CEO pauses pipeline, waits for human approval).
- Decision classification criteria should be concrete: anything touching scope, technology choice, dependency addition, or architecture is STRATEGIC. Everything else is ROUTINE.
- Implement a decision preview window. For NOTABLE decisions, wait N minutes before proceeding -- giving the human a window to object via Discord without blocking the pipeline for routine work.
- The CEO agent's system prompt must include explicit instructions to escalate uncertainty: "If you are less than 80% confident in your answer, classify as STRATEGIC and ask the human."
- Maintain a decision audit log that is reviewable mid-pipeline, not just post-mortem.

**Warning signs:**
- CEO agent never escalating to human (means classification is too permissive, not that all decisions are routine).
- Downstream agents diverging from the original project brief.
- User surprised by decisions when reviewing the audit log.
- CEO making technology or architecture decisions not present in the original brief.

**Phase to address:**
CEO agent design and decision protocol (early phase, before building the full pipeline). The decision taxonomy must be defined and tested before autonomous operation begins.

---

### Pitfall 7: Stale Agents That Consume Resources Silently

**What goes wrong:**
A Claude Code subprocess hangs (waiting for input, stuck in a tool call, API timeout without response, or the process itself becomes a zombie). The orchestrator's heartbeat check does not detect it because the process is still "alive" at the OS level. The pipeline stalls waiting for the agent to report completion. Resources (API quota, system processes, memory) are consumed with no progress.

**Why it happens:**
Claude Code CLI can hang in several ways: waiting for permission prompts that never come in `-p` mode, infinite loops in tool execution, network timeouts on API calls that do not propagate cleanly, or Node.js child process zombie states. The Paperclip heartbeat system checks if agents are alive, but "alive" is not the same as "making progress." A hung process has a PID and responds to signals but produces no output.

**How to avoid:**
- Implement progress-based health checks, not just process-alive checks. Use `stream-json` output to detect time-since-last-meaningful-output. If no new events for N minutes (configurable per step type -- longer for execution, shorter for discussion), treat as stale.
- Set `maxTurns` on agent configurations to prevent infinite agentic loops.
- Set hard timeouts per step type: discuss (10 min), plan (15 min), execute (30 min per wave), verify (15 min). Kill and retry on timeout.
- Listen for the `close` event on child processes (fires after both `exit` and stdio stream closure), not just `exit`.
- Use `--allowedTools` to prevent agents from entering states that cause hangs (e.g., interactive commands, long-running servers).
- Implement a kill escalation: SIGTERM -> wait 5s -> SIGKILL -> clean up session state.

**Warning signs:**
- Pipeline phase durations exceeding 2x the expected time.
- No `stream-json` events from an agent for extended periods.
- System process count growing over time (zombie accumulation).
- Paperclip reporting agent as "active" but no progress in issues/comments.

**Phase to address:**
Agent lifecycle management (core implementation phase). Must be built alongside agent spawning -- not as an afterthought.

---

### Pitfall 8: GSD Interactive Prompts Breaking Autonomous Flow

**What goes wrong:**
GSD commands are designed for interactive use with a human developer. Even with `--auto` flag, edge cases trigger interactive prompts: confirmation dialogs, clarification questions during discuss phase, "do you want to continue?" prompts after errors, or file conflict resolution dialogs. In autonomous mode via `-p`, these prompts either hang (waiting for stdin that never comes) or cause the agent to hallucinate a response.

**Why it happens:**
GSD's `--auto` flag was designed to skip known Q&A points, but it cannot anticipate every interactive prompt. GSD commands invoke Claude Code internally, which itself may trigger permission prompts, tool approval dialogs, or clarification requests. The orchestrator pipes prompts through Claude Code's `-p` flag, but nested interactivity (GSD calling Claude Code calling tools) creates layers where prompts can escape.

**How to avoid:**
- Use `--dangerously-skip-permissions` or configure comprehensive `--allowedTools` lists for every agent to eliminate permission prompts entirely within the sandbox.
- Wrap GSD commands in the agent's system prompt instructions rather than invoking GSD as a subprocess-within-a-subprocess. Have the agent read GSD's plan files and execute the work directly, using `gsd-tools.cjs` for state management only.
- Test every GSD command path in fully autonomous mode before integrating. Map every possible interactive prompt and ensure each has a non-interactive fallback.
- Add a stdin timeout to any subprocess: if it reads from stdin for more than 5 seconds, assume it is hanging on a prompt and kill it.

**Warning signs:**
- Agents producing output like "Do you want to continue? (y/n)" in their logs.
- Agent sessions stalling at predictable points in GSD's workflow.
- Inconsistent behavior between GSD commands that work autonomously and ones that do not.

**Phase to address:**
GSD integration layer (early implementation). Must be thoroughly tested before building the full pipeline on top of it.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Polling for agent status instead of streaming | Simpler implementation, no stream parsing | Delayed failure detection, wasted API calls, missed real-time events | Never -- stream-json is available and not harder to implement |
| Storing pipeline state only in memory | Fast development, no DB setup | State lost on plugin restart, no recovery after crash | Only during initial prototyping; must add persistence before any real use |
| Single retry strategy for all failure types | Less code, one retry config | API rate limits treated same as logic errors; retrying bad prompts wastes tokens | Never -- failure classification is essential for agent systems |
| Skipping the CEO quality gate | Faster pipeline execution | Bad plans propagate, rework multiplies downstream | Only for phases with trivially simple scope (single-file changes) |
| Free-form text for agent-to-agent communication | Faster to implement, more flexible | Parsing failures, ambiguous signals, silent misinterpretation | Only during prototyping; migrate to typed GSD_SIGNAL schemas before production |
| Using `git add .` in agent commands | Simpler git operations | Accidentally commits temporary files, debug logs, secrets | Never -- always use explicit file lists |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Claude Code CLI (`-p` flag) | Assuming exit code 0 means success | Parse JSON output for `result` field; exit code 0 can still mean the agent gave up or produced wrong output |
| Claude Code CLI (spawning) | Spawning from Node.js with inherited stdio | Use `pipe` for stdio, not `inherit`. Handle EBADF and ENOENT errors specifically. Set explicit `env` to avoid leaking parent environment |
| Paperclip `claude_local` adapter | Assuming session persists across heartbeats | Sessions may be killed between heartbeats. Always check session validity before sending commands. Use `--resume` with stored session IDs |
| OpenClaw WebSocket gateway | Assuming persistent connection | WebSocket connections drop. Implement reconnection with exponential backoff. Queue outbound messages during reconnection. Reconcile state after reconnect |
| GSD `gsd-tools.cjs` | Calling it as a subprocess and parsing stdout | Use it as a Node.js module import where possible. Subprocess invocation adds overhead and parsing fragility |
| GSD `--auto` flag | Assuming `--auto` eliminates all interactivity | `--auto` only skips known Q&A points. Other prompts (permissions, errors, confirmations) may still appear. Test every code path |
| Paperclip issue comments | Using comments as a message queue | Comments are append-only and unordered in concurrent scenarios. Use structured signal format (GSD_SIGNAL) with sequence numbers for ordering |
| Git operations from agents | Letting agents run arbitrary git commands | Whitelist specific git commands via `--allowedTools`. Prevent `git push`, `git rebase`, `git reset --hard` from agent scope |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Spawning fresh Claude Code process per pipeline step | 50K token overhead per spawn, 10-30s startup latency per agent | Use session resumption (`--resume`), 4-layer isolation, persistent connections | Immediately -- every pipeline run pays this tax from day one |
| Full CLAUDE.md loaded into every agent context | Agents spending 20-30% of context on irrelevant instructions | Use `--append-system-prompt` with role-specific instructions. Keep CLAUDE.md minimal or use per-agent project instructions | At 3+ agents running concurrently |
| Synchronous pipeline waiting for each step | Total pipeline time = sum of all step durations | Parallelize independent phases. Pipeline discussion of phase N+1 while executing phase N where dependencies allow | At 4+ phases -- linear execution becomes unacceptably slow |
| Polling Paperclip API for status updates | Unnecessary API calls, delayed detection, wasted compute | Use Paperclip's event subscription system (21 event types). React to events, do not poll for them | At any scale -- polling is always worse than events in this architecture |
| Unbounded agent output in stream-json | Memory growth from accumulating parsed events, eventual OOM | Process stream events incrementally. Only buffer what is needed for current decision. Discard processed events | At 10+ concurrent agents producing stream output |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Running agents with `--dangerously-skip-permissions` globally | Agent can execute any shell command, read/write any file, exfiltrate data | Scope `--allowedTools` to exact commands needed per agent role. Use Paperclip's permission model. Only bypass permissions in a sandboxed environment |
| Passing API keys through agent prompts | Keys visible in conversation history, logs, and compaction summaries | Use environment variables. Set keys in the process environment, not in prompts or CLAUDE.md |
| Agent-generated git commits without content review | Malicious or accidental commits of secrets, backdoors, or destructive changes | Verifier agent must scan for secrets before commit. Use git hooks for secret scanning. Never auto-push to remote without human approval |
| OpenClaw webhook endpoint without authentication | Anyone can trigger pipelines, inject commands, or read status | Authenticate webhook endpoints with shared secrets. Validate message signatures. Rate-limit incoming requests |
| Unrestricted Bash access for executor agents | Agent can install packages, modify system files, access network | Whitelist specific Bash commands. Block network access except for known endpoints. Use container isolation if available |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Pipeline runs silently with no progress updates | User sends project brief, gets nothing for 30+ minutes, assumes it is broken | Push progress events for every phase transition. Show "Phase 2/5: Planning authentication module" not just "Running..." |
| CEO decision notifications are too verbose | User gets 50 Discord messages about trivial decisions, starts ignoring them | Only notify for NOTABLE and STRATEGIC decisions. Batch ROUTINE decisions into periodic summaries |
| CEO decision notifications are too sparse | User does not know a critical decision was made until reviewing the final output | Always notify immediately for STRATEGIC decisions. Include enough context for the user to evaluate without opening the tool |
| Error messages expose internal implementation details | User sees "GSD_SIGNAL parse error at line 42" instead of actionable information | Translate internal errors to user-facing messages: "Phase 3 execution failed -- the AI agent encountered an error writing tests. Retrying..." |
| No way to intervene mid-pipeline | User sees a bad decision but cannot stop execution without killing everything | Implement pause/resume endpoints. Allow overriding a specific phase's plan without restarting the entire pipeline |
| Final output has no summary of what was built | User gets "Pipeline complete" but does not know what was actually implemented | Generate a completion report: what was built, what decisions were made, what tests pass, what to review |

## "Looks Done But Isn't" Checklist

- [ ] **Agent spawning:** Often missing process cleanup on failure -- verify that crashed agents release their Paperclip issue checkout and git locks
- [ ] **Phase verification:** Often checks "tests pass" but not "tests are meaningful" -- verify the verifier checks test coverage and relevance, not just green status
- [ ] **CEO quality gate:** Often rubber-stamps CONTEXT.md -- verify the CEO actually validates content against the original project brief, not just checks formatting
- [ ] **Error recovery:** Often retries the same failed operation -- verify retry logic varies the approach (different prompt, smaller scope, skip and escalate)
- [ ] **Sequential merge:** Often commits in order but does not verify integration -- verify that merged code passes full test suite after each merge, not just individual phase tests
- [ ] **Pipeline state persistence:** Often persists current state but not transition history -- verify the audit log captures every state transition with context, enabling full replay
- [ ] **OpenClaw notifications:** Often sends start/end notifications but not progress -- verify intermediate progress events fire for long-running phases
- [ ] **Stale agent detection:** Often checks process alive but not progress -- verify health checks measure output activity, not just PID existence
- [ ] **Decision audit log:** Often logs the decision but not the reasoning -- verify each entry includes what was decided, why, what alternatives were considered, and confidence level

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Context window exhaustion mid-task | MEDIUM | Detect via stream-json token events. Save current progress to disk. Spawn new session with `--resume` or fresh session with saved context. Resume from last checkpoint |
| Git state corruption | HIGH | Identify last good commit via git reflog. Reset to that commit. Re-run affected phases from GSD state files. This is why worktrees are strongly preferred -- isolation prevents this entirely |
| Error multiplication through pipeline | HIGH | Halt pipeline. Human reviews CEO decisions and phase outputs from audit log. Identify first bad decision. Reset pipeline to that phase. Re-run with corrected input and tighter CEO constraints |
| Token bloat from missing isolation | LOW | Implement 4-layer isolation on next spawn. No recovery needed -- just cost already incurred. Monitor token usage going forward to verify fix |
| State inconsistency (3 sources of truth) | MEDIUM | Run reconciliation: read GSD files as ground truth. Update pipeline state to match. Update Paperclip issues to match. Log all corrections. Investigate root cause of drift |
| CEO bad decision propagated downstream | HIGH | Identify decision in audit log. Calculate blast radius (which phases consumed bad decision). Roll back affected phases. Re-run with human override for the bad decision point |
| Stale/zombie agent | LOW | Kill process tree (SIGKILL if SIGTERM fails). Release Paperclip issue checkout. Update pipeline state to "failed." Retry phase from beginning with fresh agent |
| GSD interactive prompt hang | LOW | Kill hung process. Add the discovered prompt to the known-prompts list. Update `--allowedTools` or agent system prompt to prevent recurrence. Retry with updated config |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Context window exhaustion | Agent lifecycle management | Each agent completes tasks within 60% context usage. No auto-compaction events in production runs |
| Git state corruption | Parallel execution architecture | All parallel phases produce clean merges. No conflict errors in CI. Git history is linear and correct |
| 17x error multiplication | Agent signal protocol + CEO quality gates | Verifier catches injected errors. CEO rejects intentionally flawed CONTEXT.md in testing. Error containment tests pass |
| Token bloat per spawn | Agent spawning infrastructure | First-turn token usage < 10K per agent (vs 50K without isolation). Cost per pipeline run within budget |
| State inconsistency | Pipeline state machine design | Reconciliation check shows zero drift after 10 full pipeline runs. Kill-and-recover test restores correct state |
| CEO autonomous bad decisions | CEO agent design + decision protocol | STRATEGIC decisions always escalate. CEO never answers questions outside its confidence threshold. Audit log is complete and reviewable |
| Stale/zombie agents | Agent lifecycle management | No zombie processes after 100 pipeline runs. Stale detection fires within 2 minutes of hang. Resource cleanup verified |
| GSD interactive prompt hangs | GSD integration layer | All GSD commands complete in fully autonomous mode. No stdin reads detected in production agent logs |

## Sources

- [Multi-agent workflows often fail. Here's how to engineer ones that don't.](https://github.blog/ai-and-ml/generative-ai/multi-agent-workflows-often-fail-heres-how-to-engineer-ones-that-dont/) -- GitHub Blog on typed schemas and agent coordination (HIGH confidence)
- [Why Your Multi-Agent System is Failing: Escaping the 17x Error Trap](https://towardsdatascience.com/why-your-multi-agent-system-is-failing-escaping-the-17x-error-trap-of-the-bag-of-agents/) -- Towards Data Science on error multiplication and coordination topology (HIGH confidence)
- [Why Claude Code Subagents Waste 50K Tokens Per Turn](https://dev.to/jungjaehoon/why-claude-code-subagents-waste-50k-tokens-per-turn-and-how-to-fix-it-41ma) -- DEV Community on subprocess token bloat and 4-layer isolation fix (HIGH confidence)
- [Run Claude Code programmatically](https://code.claude.com/docs/en/headless) -- Official Claude Code docs on `-p` flag, `--output-format`, `--resume`, and `stream-json` (HIGH confidence)
- [Create custom subagents](https://code.claude.com/docs/en/sub-agents) -- Official Claude Code docs on subagent architecture, `maxTurns`, isolation, and worktree support (HIGH confidence)
- [Using Git Worktrees for Multi-Feature Development with AI Agents](https://www.nrmitchi.com/2025/10/using-git-worktrees-for-multi-feature-development-with-ai-agents/) -- Community pattern for parallel agent git isolation (MEDIUM confidence)
- [Clash: Avoid merge conflicts across git worktrees](https://github.com/clash-sh/clash) -- Conflict detection tooling for parallel AI agent workflows (MEDIUM confidence)
- [Claude Code Auto-Compact: What Triggers It, What It Loses, How to Fix It](https://www.morphllm.com/claude-code-auto-compact) -- Analysis of compaction behavior and context loss (MEDIUM confidence)
- [WebSocket Communication Pitfalls in Amazon Bedrock AgentCore](https://paulserban.eu/blog/post/websocket-communication-pitfalls-in-amazon-bedrock-agentcore-a-developers-survival-guide/) -- WebSocket reliability patterns for agent systems (MEDIUM confidence)
- [Node.js child process zombie issues](https://github.com/nodejs/node/issues/40189) -- Node.js GitHub issues on zombie process prevention (HIGH confidence)
- [Claude Code can't be spawned from Node.js](https://github.com/anthropics/claude-code/issues/771) -- Known Claude Code spawning issues (HIGH confidence)
- [Claude Code SDK exits with code 1 on excessive results](https://github.com/anthropics/claude-agent-sdk-typescript/issues/72) -- Known crash modes (HIGH confidence)
- [Azure AI Agent Design Patterns](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/ai-agent-design-patterns) -- Microsoft reference architecture for agent orchestration (HIGH confidence)
- [How to Build Human-in-the-Loop Oversight for AI Agents](https://galileo.ai/blog/human-in-the-loop-agent-oversight) -- Escalation pattern design (MEDIUM confidence)

---
*Pitfalls research for: AI agent orchestration plugin (Paperclip + Claude Code CLI + GSD workflow)*
*Researched: 2026-03-18*
