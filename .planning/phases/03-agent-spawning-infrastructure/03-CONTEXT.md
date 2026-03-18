# Phase 3: Agent Spawning Infrastructure - Context

**Gathered:** 2026-03-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the agent factory, context builder, and invoker that create correctly configured Paperclip agents for all five GSD roles (CEO, discusser, planner, executor, verifier). This phase focuses on agent definition, context injection, and issue-based task assignment -- not pipeline orchestration (Phase 4), not parallel execution (Phase 5), not user-facing UX (Phase 6).

Phase 3 delivers the building blocks: the factory creates agent definitions via HostServices, the context builder constructs issue descriptions and instruction files, and the invoker creates issues and wakes agents. Phase 4 will wire these together into a full orchestration loop.

</domain>

<decisions>
## Implementation Decisions

### HostServices access pattern
- HostServices is NOT available at module load time -- it's received via the `initialize` RPC call
- The RPC handler must store HostServices in a module-level variable populated during initialization
- Factory, context, and invoker functions receive `services` as an explicit parameter (dependency injection)
- No singleton pattern -- services are passed through the call chain

### Agent creation strategy
- Create-or-lookup: check for existing `gsd-{role}` agents before creating new ones
- Agent names are stable: `gsd-ceo`, `gsd-discusser`, `gsd-planner`, `gsd-executor`, `gsd-verifier`
- Agents persist across plugin restarts -- only create once per company
- Use `executionWorkspaceSettings.mode: 'isolated'` for all GSD agent issues to prevent workspace collisions

### Instruction file management
- Instruction files are minimal (~100-200 tokens each) -- role identity + GSD_SIGNAL output format only
- Write to stable path: `~/.open-gsd-clip/agents/{role}.md` (survives OS temp purges)
- Re-create files on every plugin initialization (idempotent, cheap operation)
- Do NOT include full GSD workflow docs in instruction files -- agents have GSD installed and can run commands

### Context injection via issue descriptions
- Issue title and description are the primary context mechanism for agents
- Issue description contains: project path, phase number (if applicable), GSD command, brief (CEO only), expected GSD_SIGNAL format
- claude_local adapter renders issue description into the agent's heartbeat prompt
- Dynamic per-run context belongs in issue descriptions, NOT in instructionsFilePath (which is static/cached)

### Agent completion detection
- Agent completion is detected via `heartbeat.run.status` events through the `onEvent` RPC handler
- When `status: 'succeeded'`, fetch the issue's latest comment and parse for GSD_SIGNAL
- Map signal types to PhaseEvent types and dispatch to the pipeline FSM
- No polling -- fully event-driven

### Claude's Discretion
- Exact TypeScript types for agent definitions, context, and spawn results
- Internal data structure for the HostServices interface (partial, as needed)
- Test strategy for mocking HostServices
- Error handling for missing/invalid agents

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Architecture
- `.planning/research/ARCHITECTURE.md` — Agent factory, context builder, instruction file design
- `.planning/research/STACK.md` — No new packages needed for Phase 3

### Prior phases
- `.planning/phases/01-foundation-and-protocol/01-CONTEXT.md` — JSON-RPC handler pattern, HostServices injection
- `.planning/phases/02-pipeline-state-machine/02-CONTEXT.md` — PhaseState.activeAgentIssueId field purpose

### Requirements
- `.planning/REQUIREMENTS.md` — AGNT-01 through AGNT-07 (agent roles, context injection, factory)
- `.planning/ROADMAP.md` — Phase 3 success criteria (5 criteria that must be TRUE)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/plugin/rpc-handler.ts` — RPC handler pattern, `onEvent` stub ready for wiring
- `src/pipeline/types.ts` — PhaseState with `activeAgentIssueId: string | null` field
- `src/signals/parser.ts` — `parseSignal()` function for extracting GSD_SIGNAL from comment text
- `src/signals/types.ts` — All 12 signal types defined
- `src/shared/types.ts` — `Result<T, E>` type for expected failure paths

### Established Patterns
- ESM throughout with `.js` extensions on relative imports
- Co-located tests: `src/**/*.test.ts`
- Result<T, E> for expected failure paths
- Zod 3.25.x for schema validation
- `createChildLogger(name)` for structured logging

### Integration Points
- Agent factory will be called once at pipeline start (Phase 4)
- Agent invoker will be called per phase step (Phase 4)
- `onEvent` handler will dispatch signals to FSM (this phase, Plan 03)
- PhaseState.activeAgentIssueId will be set by invoker and read by event handler

</code_context>

<specifics>
## Specific Ideas

### CEO agent --auto handling
The CEO agent's instruction file must tell it how to pass the brief to `/gsd:new-project --auto`. The brief is in the issue description. Two approaches:
1. **Inline text:** Agent extracts brief from description and runs `claude /gsd:new-project --auto "<brief text>"`
2. **File reference:** Agent writes brief to temp file and runs `claude /gsd:new-project --auto @/tmp/gsd-brief.md`

Research recommends the file reference approach for reliability (avoids quoting/escaping issues with inline briefs).

### HostServices interface (partial)
Based on RESEARCH.md inspection of Paperclip source:
```typescript
interface HostServices {
  agents: {
    invoke(params: { companyId: string; agentId: string; reason?: string; prompt?: string }): Promise<{ runId: string }>;
    // create() may not exist -- use issues.create with assigneeAgentId instead
  };
  issues: {
    create(params: { companyId: string; title: string; description: string; status: string; priority: string; assigneeAgentId: string; executionWorkspaceSettings?: { mode: string } }): Promise<Issue>;
    createComment(params: { companyId: string; issueId: string; body: string }): Promise<IssueComment>;
    listComments(params: { companyId: string; issueId: string }): Promise<IssueComment[]>;
  };
}
```

If `agents.create()` is not available, agent definitions are created via REST API (fallback in Plan 01).

</specifics>

<deferred>
## Deferred Ideas

- Stale agent detection and respawn (Phase 4)
- Per-step timeout handling (Phase 4)
- CEO escalation to user (Phase 6)
- Parallel agent execution (Phase 5)

</deferred>

---

*Phase: 03-agent-spawning-infrastructure*
*Context gathered: 2026-03-18*
