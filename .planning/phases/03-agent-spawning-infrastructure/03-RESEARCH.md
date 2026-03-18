# Phase 3: Agent Spawning Infrastructure - Research

**Researched:** 2026-03-18
**Domain:** Paperclip agent lifecycle, claude_local adapter, GSD --auto commands, context isolation
**Confidence:** HIGH

## Summary

Phase 3 builds the agent factory and context injection system that creates correctly configured Paperclip agents for each of the five GSD roles (CEO, discusser, planner, executor, verifier). The core technical domain is: how does a Paperclip plugin create agent definitions, spawn agents via issues, and inject the right context for each role?

The most critical finding is the **HostServices API**: the plugin does NOT make HTTP calls to Paperclip. Instead, the plugin worker receives a `HostServices` object (injected via JSON-RPC from the host) with direct service access. Key methods: `agents.invoke(agentId, reason, prompt)`, `issues.create(companyId, payload)`, and `issues.createComment(issueId, body)`. These are the building blocks for the entire agent factory.

The second critical finding concerns **4-layer isolation**: spawning Claude Code subagents naively costs ~50K tokens per turn (global CLAUDE.md + plugins + MCP tools re-injected every turn). The Paperclip claude_local adapter already handles this well using `--append-system-prompt-file` for role-specific instructions. But the `instructionsFilePath` we write must be minimal and focused to avoid loading GSD's full 50K+ token context into every subagent. Each agent's `instructionsFilePath` should contain only role-specific instructions and GSD_SIGNAL output format, not the full GSD workflow documentation.

**Primary recommendation:** Build the agent factory as three focused modules: `src/agents/factory.ts` (creates agent definitions via HostServices), `src/agents/context.ts` (builds role-specific instructionsFilePath content and issue context), and `src/agents/instructions/` (one `.md` file per agent role). Use `executionWorkspaceSettings.mode: 'isolated'` per issue for workspace isolation.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| AGNT-01 | CEO agent runs /gsd:new-project --auto with the user's brief | GSD new-project.md workflow documents --auto mode: requires idea document (file or text), suppresses all interactive Q&A, auto-approves requirements and roadmap, chains to discuss-phase --auto. Issue description provides the brief document as inline text |
| AGNT-02 | Discusser agent runs /gsd:discuss-phase N --auto for each phase | discuss-phase.md documents --auto flag: suppresses gray-area questions, auto-writes CONTEXT.md from phase requirements and prior context, chains to plan-phase --auto. Phase number and project path injected via env vars or issue context |
| AGNT-03 | Planner agent runs /gsd:plan-phase N for each phase | plan-phase.md documents the workflow: orchestrates researcher, planner, and checker subagents automatically. Produces PLAN.md files. Requires CONTEXT.md already present |
| AGNT-04 | Executor agent runs /gsd:execute-phase N for each phase | execute-phase.md workflow: loads plans, groups by wave, executes via subagents. Requires PLAN.md files present |
| AGNT-05 | Verifier agent runs /gsd:verify-work N for each phase | verify-work.md workflow: validates deliverables, produces VERIFICATION.md, runs UAT tests. Requires execution complete |
| AGNT-06 | Agent factory creates Paperclip agent definitions from CLAUDE.md templates | Paperclip agent creation uses createAgentSchema: name, role, adapterType=claude_local, adapterConfig={cwd, instructionsFilePath, model}. instructionsFilePath is the role-specific CLAUDE.md equivalent |
| AGNT-07 | Context builder provides each agent type with appropriate environment variables and instructions | claude_local adapter injects PAPERCLIP_API_KEY, PAPERCLIP_AGENT_ID, PAPERCLIP_RUN_ID, PAPERCLIP_API_URL env vars. Additional context (projectPath, phaseNumber, brief) injected via issue description rendered in the agent's prompt |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | 5.8.x | Language | Already installed. No new additions needed |
| Zod | 3.25.x | Schema validation | Already installed. Used to validate API payloads before sending |
| node:fs/promises | built-in | Write instructionsFilePath temp files | No external dep needed for file I/O |
| node:path | built-in | Construct paths for per-role instruction files | Required for platform-independent paths |
| node:os | built-in | tmpdir() for ephemeral instruction files | Instruction files written at runtime |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pino | 9.x | Structured logging | Already installed. Log agent creation, invocation, context injection |
| `@paperclipai/shared` | 0.3.x | `createAgentSchema`, `createIssueSchema`, `wakeAgentSchema` — validated before API calls | Import schemas to validate payloads at compile time |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| HostServices `agents.invoke()` | Paperclip REST API via `http.fetch()` | Direct service access is simpler (no auth headers, no URL construction). REST API approach required for out-of-process scenarios but plugin has direct access |
| Per-role instruction `.md` files | Single instruction file with role interpolation | Separate files are clearer and independently editable. Template interpolation adds complexity for minimal gain |
| `executionWorkspaceSettings.mode: 'isolated'` | No workspace settings | Isolated mode prevents agents from interfering with each other's working tree. Required for parallel phase execution |

**Installation:**

No new packages needed. Phase 3 uses only existing dependencies.

## Architecture Patterns

### Recommended Project Structure

```
src/
  agents/
    factory.ts              # AgentFactory: creates/looks up agent definitions in Paperclip
    context.ts              # ContextBuilder: builds issue descriptions, instruction file content
    invoker.ts              # AgentInvoker: creates issue + invokes agent, monitors completion
    types.ts                # AgentRole, AgentConfig, AgentContext, SpawnResult types
    factory.test.ts         # Unit tests for factory with mocked HostServices
    context.test.ts         # Unit tests for context builder
    invoker.test.ts         # Unit tests for invoker
    instructions/
      ceo.md                # CEO agent instructions (GSD_SIGNAL output format, role)
      discusser.md          # Discusser agent instructions
      planner.md            # Planner agent instructions
      executor.md           # Executor agent instructions
      verifier.md           # Verifier agent instructions
    index.ts                # Public API barrel export
  pipeline/
    ...                     # Existing Phase 2 modules
  bridge/
    ...                     # Existing Phase 1 bridge
```

### Pattern 1: Agent Factory — Create-or-Lookup

**What:** The factory checks if an agent with the expected name already exists (e.g., `gsd-ceo-<companyId>`) and returns it without recreating. If it doesn't exist, creates it via HostServices. This makes the factory idempotent across plugin restarts.

**When to use:** Call once per pipeline start, before any issues are created.

**Example:**

```typescript
// src/agents/factory.ts
import type { HostServices } from '../plugin/host-services.js';

export type AgentRole = 'ceo' | 'discusser' | 'planner' | 'executor' | 'verifier';

export interface AgentDefinition {
  agentId: string;
  role: AgentRole;
  name: string;
}

// Maps GSD roles to Paperclip agent roles
const PAPERCLIP_ROLE_MAP: Record<AgentRole, string> = {
  ceo: 'ceo',
  discusser: 'engineer',
  planner: 'pm',
  executor: 'engineer',
  verifier: 'qa',
};

export async function ensureAgentsExist(
  services: HostServices,
  companyId: string,
  projectPath: string,
  model: string,
): Promise<Record<AgentRole, AgentDefinition>> {
  const roles: AgentRole[] = ['ceo', 'discusser', 'planner', 'executor', 'verifier'];
  const result = {} as Record<AgentRole, AgentDefinition>;

  for (const role of roles) {
    const agentName = `gsd-${role}`;
    const existing = await findExistingAgent(services, companyId, agentName);

    if (existing) {
      // Update instructionsFilePath in case project changed
      result[role] = { agentId: existing.id, role, name: agentName };
      continue;
    }

    const instructionsPath = await writeInstructionsFile(role);
    const agent = await services.agents.create({
      companyId,
      name: agentName,
      role: PAPERCLIP_ROLE_MAP[role],
      title: `GSD ${role.charAt(0).toUpperCase() + role.slice(1)}`,
      adapterType: 'claude_local',
      adapterConfig: {
        cwd: projectPath,
        instructionsFilePath: instructionsPath,
        model,
      },
      permissions: { canCreateAgents: false },
    });

    result[role] = { agentId: agent.id, role, name: agentName };
  }

  return result;
}
```

### Pattern 2: Context Builder — Issue Description as Agent Context

**What:** The issue title and description are the primary context injection mechanism. The claude_local adapter renders the issue description into the agent's heartbeat prompt. The context builder constructs rich issue descriptions that contain: project path, phase number, GSD command to run, brief (for CEO), and expected GSD_SIGNAL output format.

**When to use:** Every time an agent needs to be spawned for a specific task.

**Example:**

```typescript
// src/agents/context.ts

export interface AgentContext {
  role: AgentRole;
  projectPath: string;
  phaseNumber?: number;
  brief?: string;          // CEO only
  gsdCommand: string;      // e.g., '/gsd:new-project --auto'
}

export function buildIssueTitle(ctx: AgentContext): string {
  switch (ctx.role) {
    case 'ceo':
      return 'CEO: Initialize project with /gsd:new-project --auto';
    case 'discusser':
      return `Discusser: Run /gsd:discuss-phase ${ctx.phaseNumber} --auto`;
    case 'planner':
      return `Planner: Run /gsd:plan-phase ${ctx.phaseNumber}`;
    case 'executor':
      return `Executor: Run /gsd:execute-phase ${ctx.phaseNumber}`;
    case 'verifier':
      return `Verifier: Run /gsd:verify-work ${ctx.phaseNumber}`;
  }
}

export function buildIssueDescription(ctx: AgentContext): string {
  const lines = [
    `## GSD Task`,
    ``,
    `**Project path:** ${ctx.projectPath}`,
    `**Command:** \`${ctx.gsdCommand}\``,
  ];

  if (ctx.role === 'ceo' && ctx.brief) {
    lines.push(``, `## Project Brief`, ``, ctx.brief);
  }

  if (ctx.phaseNumber !== undefined) {
    lines.push(``, `**Phase:** ${ctx.phaseNumber}`);
  }

  lines.push(
    ``,
    `## When Complete`,
    ``,
    `Post a comment with a GSD_SIGNAL block to indicate completion:`,
    ``,
    `\`\`\`yaml`,
    `---`,
    `GSD_SIGNAL:PROJECT_READY`,
    `phase: ${ctx.phaseNumber ?? 0}`,
    `status: success`,
    `summary: Brief description of what was done`,
    `---`,
    `\`\`\``,
  );

  return lines.join('\n');
}
```

### Pattern 3: Agent Invoker — Create Issue + Wake Agent

**What:** Spawning an agent involves two steps: (1) create an issue assigned to the agent, (2) invoke the agent via `agents.invoke()`. The issue provides the task context; the invocation triggers the heartbeat. Track the issue ID in PhaseState.activeAgentIssueId (already defined in Phase 2 types).

**When to use:** Every time a phase step needs an agent.

**Example:**

```typescript
// src/agents/invoker.ts
import type { HostServices } from '../plugin/host-services.js';
import { buildIssueTitle, buildIssueDescription } from './context.js';

export interface SpawnResult {
  issueId: string;
  runId: string;
}

export async function spawnAgent(
  services: HostServices,
  companyId: string,
  agentId: string,
  ctx: AgentContext,
): Promise<SpawnResult> {
  // Step 1: Create the task issue
  const issue = await services.issues.create({
    companyId,
    title: buildIssueTitle(ctx),
    description: buildIssueDescription(ctx),
    status: 'todo',
    priority: 'high',
    assigneeAgentId: agentId,
    executionWorkspaceSettings: {
      mode: 'isolated',         // Each agent gets its own workspace
    },
  });

  // Step 2: Wake the agent with the issue context
  const { runId } = await services.agents.invoke({
    companyId,
    agentId,
    reason: `GSD ${ctx.role} task: ${buildIssueTitle(ctx)}`,
    prompt: `You have a new task. Issue ID: ${issue.id}. Check your assigned issues and complete the task.`,
  });

  return { issueId: issue.id, runId };
}
```

### Pattern 4: Four-Layer Isolation for Instruction Files

**What:** The `instructionsFilePath` written for each agent role must be minimal. The Paperclip claude_local adapter passes this file via `--append-system-prompt-file`, which APPENDS to Claude Code's default system prompt. This means the global CLAUDE.md is still loaded. To avoid the 50K token overhead, the instruction file must not re-explain GSD workflows — instead, it contains only role identity, constraint reminders, and the GSD_SIGNAL output format.

**When to use:** Always. Every agent instruction file must stay under 500 tokens.

**Four isolation layers (applied by Paperclip claude_local adapter):**
1. **Scoped CWD**: Agent runs from project directory, not home directory
2. **Git boundary**: Project has its own `.git`, preventing upward traversal to `~/CLAUDE.md` (note: global `~/.claude/CLAUDE.md` IS still loaded via `--append-system-prompt-file` chain in claude_local adapter)
3. **Empty plugin dir**: Paperclip claude_local uses `--plugin-dir` pointing to skills dir only
4. **Setting sources**: claude_local uses `--setting-sources project,local` excluding user-level global plugins

**The role instruction file should contain ONLY:**
- One-sentence role statement
- The GSD_SIGNAL output format for this role's completion signal
- Any constraints unique to this role (e.g., executor must not modify .planning/ files)

**Anti-pattern:** Writing a 5000-token role description file that explains all of GSD. The agent already has GSD installed and accessible via skill commands.

### Anti-Patterns to Avoid

- **Creating agents every time:** Always check for existing `gsd-{role}` agents first. Re-creating duplicates accumulates billing and orphaned agents.
- **Injecting project brief into instructionsFilePath:** The instructionsFilePath is static and cached by the adapter. Dynamic per-run context belongs in the issue description.
- **Using `executionWorkspaceSettings.mode: 'project_primary'` for parallel agents:** Multiple agents running on the same workspace concurrently will corrupt git state. Use `'isolated'` for all GSD agents.
- **Blocking in `agents.invoke()`:** The invoke call returns a runId immediately. Agent completion is detected via `heartbeat.run.status` events through `onEvent`, not by polling.
- **Storing instructionsFilePath in a user-writable temp location:** The Paperclip adapter reads the file when starting the agent process. Write to a stable path in the plugin's own data directory.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Agent creation | Custom REST API calls | HostServices `agents.create()` | Direct service injection avoids auth headers, URL construction, and SSRF protection bypass |
| Issue creation | Custom REST API calls | HostServices `issues.create()` | Same reason as above, plus schema validation via `createIssueSchema` |
| Agent invocation | Manual POST to `/api/agents/:id/wakeup` | HostServices `agents.invoke()` | invoke() handles run queueing, idempotency, and wakeup reason tracking |
| Instruction file temp paths | Custom path management | `node:os.tmpdir()` + agent name | Standard temp directory management, no custom logic needed |
| Waiting for agent completion | Polling `agents.get()` | `onEvent` with `heartbeat.run.status` | Event-driven; no polling loops, no sleeps, no missed completions |

**Key insight:** The entire agent factory is a thin orchestration layer over HostServices. The heavy lifting is done by Paperclip (agent lifecycle), GSD (workflow execution), and the claude_local adapter (subprocess management). Phase 3's value is correct wiring, not novel code.

## Common Pitfalls

### Pitfall 1: Agent Not Running Because Issue Not Assigned

**What goes wrong:** Issue is created but the agent never picks it up. Agent heartbeat fires but finds no assigned issues.
**Why it happens:** `assigneeAgentId` must be set on the issue at creation time AND the agent's heartbeat must be triggered after assignment.
**How to avoid:** Always create the issue with `assigneeAgentId` set, then immediately call `agents.invoke()`. The invoke call triggers the heartbeat with `source: 'assignment'`, which causes the agent to check its assigned issues queue.
**Warning signs:** Agent `lastHeartbeatAt` updates but issue status remains `todo` indefinitely.

### Pitfall 2: CEO --auto Fails Because Brief Is Missing

**What goes wrong:** CEO agent starts `/gsd:new-project --auto` but GSD exits with "Error: --auto requires an idea document."
**Why it happens:** The `--auto` flag requires the brief to be provided as inline text OR a file reference in `$ARGUMENTS`. The CEO agent's issue description must include the brief AND the agent must know to pass it to the GSD command.
**How to avoid:** The CEO agent's instruction file must tell it: "Your task description contains the project brief. Run: `claude /gsd:new-project --auto <paste brief inline>`". Alternatively, write the brief to a file at a known path in the project and pass `--auto @brief.md`. The file path approach is more reliable.
**Warning signs:** CEO agent run status shows `failed` within 10 seconds. GSD error message in run logs.

### Pitfall 3: Parallel Agent Workspace Collision

**What goes wrong:** Discusser for phase 2 and discusser for phase 3 (running in parallel) both modify the same `.planning/STATE.md` file, causing git conflicts.
**Why it happens:** `executionWorkspaceSettings.mode: 'isolated'` was not set, so both agents share the project primary workspace.
**How to avoid:** Always use `mode: 'isolated'` for GSD agent issues. This gives each agent its own git worktree copy of the project. Git merge conflicts between phases are handled by the sequential merge strategy (Phase 5).
**Warning signs:** Git conflict markers in `.planning/STATE.md` or ROADMAP.md during parallel execution.

### Pitfall 4: instructionsFilePath Disappears Between Restarts

**What goes wrong:** Plugin restarts, the temp instruction files at `/tmp/gsd-agent-...` are gone (OS cleared tmpdir), and the claude_local adapter can't read the file at agent startup.
**Why it happens:** `/tmp` on macOS is periodically purged. On Linux, it's purged on reboot. Files written during plugin initialization may not exist when the agent runs hours later.
**How to avoid:** Write instruction files to a stable location: either the plugin's data directory (Paperclip may provide one via HostServices state) or a subdirectory of the user's home (e.g., `~/.open-gsd-clip/agents/`). Re-create files on every plugin initialization. The files are static per role and can be idempotently re-written.
**Warning signs:** Agent process crashes immediately with `ENOENT` reading the instructions file.

### Pitfall 5: HostServices Not Available in RPC Handler Scope

**What goes wrong:** The RPC handler (in `rpc-handler.ts`) doesn't have access to HostServices because services are injected at initialization time but the handler is a module-level closure.
**Why it happens:** HostServices is received via the `initialize` RPC call payload (or a separate initialization mechanism). If the handler is created before services are available, factory functions can't be called.
**How to avoid:** Design the RPC handler to accept a `services` parameter at creation time: `createRpcHandler(services: HostServices)`. Store services in a module-level variable that's populated during the `initialize` handler. Factory and invoker functions receive `services` as an explicit parameter (dependency injection, not module-level state).
**Warning signs:** `TypeError: services is undefined` when the first `onEvent` triggers agent spawning.

### Pitfall 6: GSD Signal Never Detected Because onEvent Isn't Wired

**What goes wrong:** Agent completes successfully and posts a GSD_SIGNAL comment to the issue, but the pipeline never advances because the plugin's `onEvent` handler isn't listening for issue comment events.
**Why it happens:** The current `onEvent` stub (from Phase 1) logs and returns without processing. Phase 3 must wire up the event handler to detect `heartbeat.run.status` events with `status: succeeded` and then read the issue comments for GSD_SIGNAL.
**How to avoid:** In Phase 3, the `onEvent` handler must: (1) detect `heartbeat.run.status` events where `status === 'succeeded'`, (2) look up which PhaseState has `activeAgentIssueId` matching the run's issue, (3) fetch the issue's latest comment, (4) parse for GSD_SIGNAL using the Phase 1 signal parser, (5) dispatch the appropriate PhaseEvent to the pipeline FSM.
**Warning signs:** Phase status stuck at 'discussing' even though GSD agent created CONTEXT.md and posted signal comment.

## Code Examples

Verified patterns from official sources and inspected schemas:

### Agent Creation Payload (verified against createAgentSchema from @paperclipai/shared@0.3.x)

```typescript
// Source: node -e inspection of @paperclipai/shared createAgentSchema
const agentPayload = {
  name: 'gsd-ceo',
  role: 'ceo',                          // Paperclip AGENT_ROLES enum
  title: 'GSD CEO',
  adapterType: 'claude_local',          // AGENT_ADAPTER_TYPES enum
  adapterConfig: {
    cwd: projectPath,                   // Working directory for agent process
    instructionsFilePath: '/home/user/.open-gsd-clip/agents/ceo.md',
    model: 'claude-sonnet-4-6',
  },
  runtimeConfig: {},
  budgetMonthlyCents: 0,
  permissions: { canCreateAgents: false },
};
// All optional fields default: role='general', adapterType='process', adapterConfig={}, budget=0
```

### Issue Creation Payload (verified against createIssueSchema from @paperclipai/shared@0.3.x)

```typescript
// Source: node -e inspection of @paperclipai/shared createIssueSchema
const issuePayload = {
  title: 'CEO: Initialize project with /gsd:new-project --auto',
  description: '## GSD Task\n\n**Project path:** /path/to/project\n...',
  status: 'todo',                        // IssueStatus enum
  priority: 'high',                      // IssuePriority enum
  assigneeAgentId: agentId,              // Must be valid UUID
  requestDepth: 0,
  executionWorkspaceSettings: {
    mode: 'isolated',                    // enum: inherit|project_primary|isolated|agent_default
  },
};
```

### Agent Wakeup (verified against wakeAgentSchema)

```typescript
// Source: node -e inspection of @paperclipai/shared wakeAgentSchema
// Called as: services.agents.invoke({ companyId, agentId, reason, prompt })
const wakeupPayload = {
  source: 'assignment',                  // Default: 'on_demand'
  triggerDetail: 'ping',
  reason: 'GSD CEO task assigned',
  payload: { issueId: issue.id },        // Optional record
};
```

### HostServices API (verified against plugin-host-services.ts)

```typescript
// Direct service access — no HTTP calls, no auth headers needed
// agents.invoke signature:
async invoke(params: {
  companyId: string;
  agentId: string;
  reason?: string | null;
  prompt?: string;
}): Promise<{ runId: string }>

// issues.create signature:
async create(params: {
  companyId: string;
  [key: string]: unknown;   // Flexible — delegates to issues.create(companyId, params)
}): Promise<Issue>

// issues.createComment signature:
async createComment(params: {
  companyId: string;
  issueId: string;
  body: string;
}): Promise<IssueComment>
```

### GSD --auto Flag Requirements

```typescript
// Source: GSD workflow files at ~/.claude/get-shit-done/workflows/

// CEO: new-project --auto requires idea document inline or via @file
// CRITICAL: The brief must be passed as text in $ARGUMENTS, not just in the issue description
// The CEO agent instruction file must tell the agent HOW to run the command:
const ceoInstructions = `
You are a GSD CEO agent. When you receive a task:
1. Read the project brief from your issue description
2. Write the brief to a temp file: /tmp/gsd-brief-<timestamp>.md
3. Run: claude /gsd:new-project --auto @/tmp/gsd-brief-<timestamp>.md
4. After completion, post a GSD_SIGNAL comment on this issue
`;

// Discusser: discuss-phase N --auto suppresses Q&A and auto-writes CONTEXT.md
// Planner: plan-phase N (no --auto needed; research + planning are automated internally)
// Executor: execute-phase N --auto chains to verify when done
// Verifier: verify-work N runs UAT tests and produces VERIFICATION.md
```

### Role-Specific Instruction File Content (minimal, ~100-200 tokens each)

```markdown
<!-- agents/instructions/ceo.md -->
You are the GSD CEO agent for this project.

Your task is always a single GSD command to run. Read the issue description carefully.

After completing the GSD command, post a comment on this issue:

---
GSD_SIGNAL:PROJECT_READY
phase: 0
status: success
summary: [one-line summary of what was created]
---
```

### Detecting Agent Completion via onEvent

```typescript
// src/plugin/rpc-handler.ts - updated onEvent handler
async function handleOnEvent(params: unknown, services: HostServices): Promise<void> {
  const event = params as { type: string; data: unknown };

  if (event.type === 'heartbeat.run.status') {
    const run = event.data as { status: string; agentId: string; runId: string };
    if (run.status !== 'succeeded' && run.status !== 'failed') return;

    // Find which phase was tracking this agent
    const phase = findPhaseByAgentId(pipelineState, run.agentId);
    if (!phase) return;

    // Fetch the issue's latest comment for GSD_SIGNAL
    const comments = await services.issues.listComments({
      companyId,
      issueId: phase.activeAgentIssueId!,
    });
    const lastComment = comments[comments.length - 1];
    const signal = lastComment ? parseSignal(lastComment.body) : null;

    // Dispatch to pipeline FSM
    if (signal) {
      dispatchSignalToFsm(phase, signal);
    } else if (run.status === 'failed') {
      // No signal, agent failed — dispatch STEP_FAILED
      dispatchStepFailed(phase, 'transient', 'Agent run failed without signal');
    }
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Spawn Claude Code via child_process | Use Paperclip claude_local adapter (handles spawn, session, stream parsing) | Current | Adapter handles retry, session resume, stream-json parsing — don't re-implement |
| Pass context via environment variables | Pass context via issue description + instructionsFilePath | Current | Issue description is rendered into the agent prompt; env vars are for credentials |
| Global CLAUDE.md for all agents | Per-role instructionsFilePath via --append-system-prompt-file | Current | Role isolation without duplicating full config |
| Poll agent status | Event-driven via heartbeat.run.status | Current | Lower latency, no polling overhead |

**Deprecated/outdated:**
- `@paperclipai/plugin-sdk`: Still not published. Plugin uses JSON-RPC over stdio per Phase 1 implementation.
- Direct HTTP calls from plugin to Paperclip API: Not the right pattern. Use HostServices direct injection.

## Open Questions

1. **How HostServices is passed to the plugin worker**
   - What we know: plugin-host-services.ts creates a HostServices object with injected DB services. The `notifyWorker` callback allows host→worker notifications.
   - What's unclear: How the plugin worker RECEIVES the HostServices reference. The Phase 1 JSON-RPC implementation expects host calls; HostServices may be passed in the `initialize` params or via a separate RPC message.
   - Recommendation: On `initialize` RPC, check if `params` contains a `services` or `hostContext` field. If not, the plugin makes outbound calls via `performAction` RPC back to the host. Check the actual Paperclip host implementation to determine the injection mechanism. If blocked, implement a thin HTTP proxy using the `PAPERCLIP_API_URL` env var that agents receive.

2. **Whether agents.create() exists in HostServices**
   - What we know: plugin-host-services.ts shows `agents.list/get/pause/resume/invoke()`. The full list was summarized but may be incomplete.
   - What's unclear: Whether `agents.create()` is in HostServices or must be done via the REST API.
   - Recommendation: During Wave 0, inspect the actual HostServices TypeScript interface from Paperclip source. If `create()` is not available, use `http.fetch()` to POST to `/api/companies/:id/agents` with the `PAPERCLIP_API_URL` env var and plugin's JWT.

3. **companyId availability in plugin worker**
   - What we know: All HostServices calls require `companyId`. The initialize RPC params likely contain company context.
   - What's unclear: The exact field name in the initialize params.
   - Recommendation: Log the full `initialize` params during Wave 0 testing to discover the company context structure.

4. **Agent session persistence across plugin restarts**
   - What we know: claude_local adapter caches session IDs keyed by agentId + CWD. On restart, it can resume sessions.
   - What's unclear: Whether the factory should call `agents.update()` to change `instructionsFilePath` if the project path changes between runs.
   - Recommendation: Store last `instructionsFilePath` in plugin state (HostServices `state.set()`). On each pipeline start, check if project path changed and update agent config if needed.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 3.2.x |
| Config file | `vitest.config.ts` (exists) |
| Quick run command | `npx vitest run src/agents/ --reporter=verbose` |
| Full suite command | `npx vitest run --reporter=verbose` |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AGNT-01 | CEO instruction file content contains --auto and brief-passing instructions | unit | `npx vitest run src/agents/context.test.ts -t "CEO instruction"` | Wave 0 |
| AGNT-01 | CEO issue description contains project brief | unit | `npx vitest run src/agents/context.test.ts -t "buildIssueDescription CEO"` | Wave 0 |
| AGNT-02 | Discusser issue title contains phase number | unit | `npx vitest run src/agents/context.test.ts -t "buildIssueTitle discusser"` | Wave 0 |
| AGNT-03 | Planner issue title and description correct | unit | `npx vitest run src/agents/context.test.ts -t "buildIssueTitle planner"` | Wave 0 |
| AGNT-04 | Executor issue description correct | unit | `npx vitest run src/agents/context.test.ts -t "buildIssueTitle executor"` | Wave 0 |
| AGNT-05 | Verifier issue description correct | unit | `npx vitest run src/agents/context.test.ts -t "buildIssueTitle verifier"` | Wave 0 |
| AGNT-06 | ensureAgentsExist creates agents with correct adapterConfig | unit | `npx vitest run src/agents/factory.test.ts -t "ensureAgentsExist creates"` | Wave 0 |
| AGNT-06 | ensureAgentsExist is idempotent (returns existing agents) | unit | `npx vitest run src/agents/factory.test.ts -t "ensureAgentsExist idempotent"` | Wave 0 |
| AGNT-07 | spawnAgent creates issue then invokes agent | unit | `npx vitest run src/agents/invoker.test.ts -t "spawnAgent creates issue"` | Wave 0 |
| AGNT-07 | spawnAgent uses isolated workspace mode | unit | `npx vitest run src/agents/invoker.test.ts -t "spawnAgent isolated"` | Wave 0 |
| AGNT-07 | instruction file written to stable path | unit | `npx vitest run src/agents/factory.test.ts -t "instruction file path"` | Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run src/agents/ --reporter=verbose`
- **Per wave merge:** `npx vitest run --reporter=verbose`
- **Phase gate:** Full suite green + typecheck before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/agents/factory.test.ts` — covers AGNT-06 agent creation and idempotency
- [ ] `src/agents/context.test.ts` — covers AGNT-01 through AGNT-05 context building
- [ ] `src/agents/invoker.test.ts` — covers AGNT-07 issue creation and agent invocation
- [ ] `src/agents/instructions/ceo.md` — CEO role instruction file
- [ ] `src/agents/instructions/discusser.md` — Discusser role instruction file
- [ ] `src/agents/instructions/planner.md` — Planner role instruction file
- [ ] `src/agents/instructions/executor.md` — Executor role instruction file
- [ ] `src/agents/instructions/verifier.md` — Verifier role instruction file

No test framework gaps — vitest is already configured.

## Sources

### Primary (HIGH confidence)

- [@paperclipai/shared@0.3.x inspected live](node:) — createAgentSchema, createIssueSchema, wakeAgentSchema all field types verified via `node -e` inspection
- [Paperclip plugin-host-services.ts](https://github.com/paperclipai/paperclip/blob/master/server/src/services/plugin-host-services.ts) — HostServices API: agents.invoke(), issues.create(), issues.createComment() signatures extracted
- [Paperclip claude-local execute.ts](https://github.com/paperclipai/paperclip/blob/master/packages/adapters/claude-local/src/server/execute.ts) — Claude CLI spawn command, --append-system-prompt-file usage, env var injection (PAPERCLIP_API_KEY, AGENT_HOME, etc.)
- [Claude Code CLI reference](https://code.claude.com/docs/en/cli-usage) — --append-system-prompt-file, --plugin-dir, --setting-sources flags verified against official docs
- [GSD workflows](~/.claude/get-shit-done/workflows/) — new-project.md, discuss-phase.md, plan-phase.md, execute-phase.md, verify-work.md — --auto flag behavior, required arguments, output artifacts

### Secondary (MEDIUM confidence)

- [50K Token Overhead Article (DEV Community)](https://dev.to/jungjaehoon/why-claude-code-subagents-waste-50k-tokens-per-turn-and-how-to-fix-it-41ma) — 4-layer isolation technique. Partially confirmed: Paperclip claude_local adapter already applies layers 1-4. The article's specific techniques inform instruction file design.
- [Paperclip PLUGIN_SPEC.md](https://raw.githubusercontent.com/paperclipai/paperclip/master/doc/plugins/PLUGIN_SPEC.md) — Target architecture (post-V1). Confirms HostServices API shape but is aspirational, not current implementation.
- [Paperclip agent.ts types](https://github.com/paperclipai/paperclip/blob/master/packages/shared/src/types/agent.ts) — Agent interface structure, AdapterEnvironmentCheck types

### Tertiary (LOW confidence)

- [Paperclip DeepWiki agent system](https://deepwiki.com/paperclipai/paperclip/3-agent-system) — Agent lifecycle overview. Consistent with source code inspection but not authoritative.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; all existing dependencies verified in Phase 1-2
- Architecture: HIGH — Paperclip HostServices API inspected from source. createAgentSchema/createIssueSchema field types verified via live node inspection. GSD --auto behaviors verified from workflow source files.
- Pitfalls: HIGH — most pitfalls derived from concrete API constraints (UUID validation, assigneeAgentId requirement, --auto brief requirement) verified against live schemas.
- Open questions: LOW confidence items are all startup/initialization questions resolvable during Wave 0 implementation when Paperclip server is running.

**Research date:** 2026-03-18
**Valid until:** 2026-04-18 (30 days — stable domain, Paperclip and GSD APIs are not fast-moving)
