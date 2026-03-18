# Phase 6: User-Facing Integration - Research

**Researched:** 2026-03-18
**Domain:** REST API endpoints, Discord integration via OpenClaw, CEO escalation flow, token/cost observability, notification preferences
**Confidence:** HIGH (internal API layer) / MEDIUM (OpenClaw integration)

## Summary

Phase 6 is the final phase. It adds the user-facing surface to the fully automated pipeline built in Phases 1-5. The core challenge is threefold: (1) expose REST API endpoints through Paperclip's `executeAction` RPC so external systems can start/stop/query the pipeline, (2) integrate with OpenClaw's Discord channel so users can interact conversationally, and (3) add observability (token tracking, notification preferences, activity log posting).

The architecture has two layers. The **inner layer** is a set of pure action handlers (`src/api/`) that validate requests, call PipelineRunner methods, and return structured responses. The **outer layer** connects these handlers to two transport mechanisms: Paperclip's `executeAction` RPC (which enables REST-like calls from the Paperclip UI and any HTTP client via Paperclip's plugin API proxy) and OpenClaw's Discord channel (where the plugin posts status updates and receives user commands through Paperclip's activity/notification system).

The AGNT-11 escalation requirement (CEO escalates decisions to user) is implemented as a special signal flow: when the pipeline encounters a DECISION_NEEDED signal, it pauses that phase, posts the decision context to Discord via OpenClaw, and waits for the user's response. The user responds in Discord, OpenClaw relays the message back through Paperclip's event system, and the pipeline resumes with the user's choice.

**Primary recommendation:** Build the API layer as a thin `src/api/` module with pure action handlers, a notification service (`src/notifications/`) that abstracts Discord message delivery, and token tracking integrated into the existing orchestrator. Wire everything through the existing `executeAction` and `onEvent` RPC methods.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CLAW-01 | User starts pipeline via Discord | OpenClaw receives user message in Discord, Paperclip routes it to plugin via `onEvent` with type `chat.message`. Plugin parses brief from message, calls `PipelineRunner.start()`. |
| CLAW-02 | Pipeline pushes status updates to Discord at transitions | NotificationService posts to Paperclip activity log via HostServices. Paperclip's live-events system pushes activity to connected channels (including OpenClaw Discord). Filter by user notification preferences. |
| CLAW-03 | CEO escalation decisions delivered to user via Discord | On DECISION_NEEDED signal, pipeline creates an escalation record, posts decision context + options to Discord via NotificationService, sets phase to `awaiting_decision` (new metadata, not FSM state). |
| CLAW-04 | User responds to CEO escalation via Discord | User's Discord response arrives as `chat.message` event. Plugin matches it to pending escalation by conversation context, constructs DECISION_MADE signal, resumes pipeline. |
| CLAW-05 | User queries pipeline status via Discord | Plugin handles `onEvent` chat.message containing status query keywords. Returns formatted status from `PipelineRunner.getState()`. |
| CLAW-06 | User retries failed phases via Discord | Plugin parses retry command from chat.message, calls retry action handler which triggers `RETRY_PHASE` event on the FSM. |
| CLAW-07 | User pauses/resumes pipeline via Discord | Plugin parses pause/resume command, calls PipelineRunner method which triggers `PAUSE_REQUESTED`/`RESUME_REQUESTED` on pipeline FSM. |
| API-01 | POST /gsd/start starts pipeline | `executeAction` handler for action `gsd.start` validates `{ brief, projectPath }`, calls `PipelineRunner.start()`. |
| API-02 | GET /gsd/status returns pipeline state | `executeAction` handler for action `gsd.status` returns serialized pipeline state from `PipelineRunner.getState()`. |
| API-03 | GET /gsd/phases returns roadmap phases | `executeAction` handler for action `gsd.phases` returns phase data from pipeline state's execution plan. |
| API-04 | POST /gsd/retry/:phase retries failed phase | `executeAction` handler for action `gsd.retry` validates phase number, triggers `RETRY_PHASE` then `DEPENDENCIES_MET` events. |
| API-05 | POST /gsd/override allows user to override CEO decision | `executeAction` handler for action `gsd.override` resolves pending escalation with user's choice, constructs DECISION_MADE signal, resumes pipeline. |
| API-06 | POST /gsd/pause pauses pipeline | `executeAction` handler for action `gsd.pause` triggers `PAUSE_REQUESTED` event. Running agents complete, no new agents spawn. |
| API-07 | POST /gsd/resume resumes pipeline | `executeAction` handler for action `gsd.resume` triggers `RESUME_REQUESTED` event. Pipeline resumes from current state. |
| AGNT-11 | CEO escalates decisions to user via Discord | On DECISION_NEEDED signal, pipeline stores escalation context (phase, options, reasoning). NotificationService delivers to Discord. Pipeline does NOT block globally -- only the affected phase waits. Other phases continue. |
| OBSV-01 | Token/cost tracking per agent invocation | Track token usage from heartbeat events (tokens field in heartbeat.run.status). Aggregate by phase and agent role. Store in pipeline state or separate tracking structure. |
| OBSV-02 | Phase progress in status updates | Status updates include "Phase X of Y, step Z" format. Computed from pipeline state phases array and current phase status. |
| OBSV-03 | Configurable notification preferences | User preferences stored in plugin state via HostServices. Options: all, failures_only, completions_only, escalations_only. Filter applied in NotificationService before posting. |
| OBSV-04 | Activity events posted to Paperclip activity log | Every pipeline transition, phase completion, and escalation is posted as an activity entry via HostServices activity API. Appears in Paperclip dashboard. |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | 5.8.x | Language | Already installed |
| Zod | 3.25.x | Request/response validation for API actions | Already installed |
| pino | 9.x | Structured logging | Already installed |
| node:crypto | built-in | UUID generation for escalation IDs | Already used in audit-log |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| node:fs/promises | built-in | Read/write notification preferences file | Persistent user preferences |
| node:path | built-in | Path construction | Standard |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| executeAction RPC for API | Express HTTP server in plugin | Plugin already uses JSON-RPC; adding Express adds a port binding and dependency. executeAction is the Paperclip-native way for plugins to expose actions. |
| Paperclip activity log for Discord notifications | Direct Discord webhook | Activity log is Paperclip-native and routes to all connected channels (Discord, Slack, etc.). Direct webhooks bypass Paperclip's channel abstraction and notification routing. |
| Plugin state for notification preferences | JSONL file in project | Plugin state survives project changes and is scoped to the plugin. JSONL file is project-scoped and gets lost if project path changes. |

**Installation:**

No new packages needed. Phase 6 uses only existing dependencies.

## Architecture Patterns

### Recommended Project Structure

```
src/
  api/
    actions.ts              # Pure action handlers (start, status, phases, retry, override, pause, resume)
    actions.test.ts         # Unit tests for action handlers
    schemas.ts              # Zod schemas for request/response validation
    schemas.test.ts         # Schema validation tests
    index.ts                # Barrel export
  notifications/
    notification-service.ts # Abstracts message delivery to Paperclip activity + Discord
    notification-service.test.ts
    preferences.ts          # User notification preference management
    preferences.test.ts
    formatters.ts           # Format pipeline events into human-readable messages
    formatters.test.ts
    index.ts                # Barrel export
  orchestrator/
    pipeline-runner.ts      # MODIFIED: add pause/resume, escalation handling, notification hooks
    pipeline-runner.test.ts # MODIFIED: new tests for pause/resume/escalation
    token-tracker.ts        # NEW: token usage tracking per agent/phase
    token-tracker.test.ts
    types.ts                # MODIFIED: add EscalationRecord, NotificationPreference types
    ...                     # Existing files unchanged
  plugin/
    rpc-handler.ts          # MODIFIED: wire executeAction, enhance onEvent for chat messages
    rpc-handler.test.ts     # MODIFIED: new tests for action routing, chat parsing
    ...
```

### Pattern 1: Action Handler Registry (executeAction RPC)

**What:** The existing `executeAction` RPC method stub is wired to a registry of named action handlers. Each action has a name (e.g., `gsd.start`), a Zod input schema, and a handler function. The RPC handler routes incoming `executeAction` calls to the correct handler by action name.

**When to use:** All REST API requirements (API-01 through API-07) are implemented as action handlers.

**Example:**

```typescript
// src/api/actions.ts

import type { PipelineRunner } from '../orchestrator/pipeline-runner.js';
import { StartSchema, RetrySchema, OverrideSchema } from './schemas.js';

export interface ActionResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export type ActionHandler = (
  params: unknown,
  runner: PipelineRunner,
) => Promise<ActionResult>;

export const ACTION_HANDLERS: Record<string, ActionHandler> = {
  'gsd.start': async (params, runner) => {
    const parsed = StartSchema.safeParse(params);
    if (!parsed.success) {
      return { success: false, error: parsed.error.message };
    }
    await runner.start(parsed.data.projectPath, parsed.data.brief);
    return { success: true, data: { status: 'started' } };
  },

  'gsd.status': async (_params, runner) => {
    const state = runner.getState();
    if (!state) {
      return { success: false, error: 'Pipeline not started' };
    }
    return { success: true, data: state };
  },

  'gsd.phases': async (_params, runner) => {
    const state = runner.getState();
    if (!state?.executionPlan) {
      return { success: false, error: 'No execution plan available' };
    }
    return {
      success: true,
      data: {
        phases: state.phases.map((p) => ({
          phaseNumber: p.phaseNumber,
          status: p.status,
          activeAgent: p.activeAgentIssueId,
          error: p.error,
        })),
        executionPlan: state.executionPlan,
      },
    };
  },

  'gsd.retry': async (params, runner) => {
    const parsed = RetrySchema.safeParse(params);
    if (!parsed.success) {
      return { success: false, error: parsed.error.message };
    }
    await runner.retryPhase(parsed.data.phaseNumber, parsed.data.fromStep);
    return { success: true, data: { status: 'retrying' } };
  },

  'gsd.override': async (params, runner) => {
    const parsed = OverrideSchema.safeParse(params);
    if (!parsed.success) {
      return { success: false, error: parsed.error.message };
    }
    await runner.resolveEscalation(
      parsed.data.escalationId,
      parsed.data.decision,
    );
    return { success: true, data: { status: 'resolved' } };
  },

  'gsd.pause': async (_params, runner) => {
    await runner.pause();
    return { success: true, data: { status: 'paused' } };
  },

  'gsd.resume': async (_params, runner) => {
    await runner.resume();
    return { success: true, data: { status: 'resumed' } };
  },
};
```

### Pattern 2: Notification Service (Activity Log + Discord)

**What:** The NotificationService abstracts message delivery. When the pipeline transitions state, the orchestrator calls `notificationService.notify(event)`. The service formats the event into a human-readable message, checks the user's notification preferences, and posts to Paperclip's activity log via HostServices. Paperclip's live-events system then pushes the activity to connected channels (including OpenClaw Discord).

**When to use:** Every pipeline transition, phase completion, failure, and escalation.

**Example:**

```typescript
// src/notifications/notification-service.ts

import type { HostServices } from '../agents/types.js';
import type { NotificationPreference } from './preferences.js';
import { formatPipelineEvent } from './formatters.js';
import { createChildLogger } from '../shared/logger.js';

const log = createChildLogger('notifications');

export type PipelineNotificationEvent =
  | { type: 'pipeline_started'; projectPath: string }
  | { type: 'phase_started'; phaseNumber: number; step: string }
  | { type: 'phase_completed'; phaseNumber: number }
  | { type: 'phase_failed'; phaseNumber: number; error: string }
  | { type: 'escalation'; phaseNumber: number; context: string; options: string[] }
  | { type: 'pipeline_completed'; totalPhases: number }
  | { type: 'pipeline_failed'; error: string }
  | { type: 'pipeline_paused' }
  | { type: 'pipeline_resumed' };

export class NotificationService {
  private readonly services: HostServices;
  private readonly companyId: string;
  private preference: NotificationPreference = 'all';

  constructor(services: HostServices, companyId: string) {
    this.services = services;
    this.companyId = companyId;
  }

  setPreference(pref: NotificationPreference): void {
    this.preference = pref;
  }

  async notify(event: PipelineNotificationEvent): Promise<void> {
    if (!this.shouldNotify(event)) {
      log.debug({ eventType: event.type, preference: this.preference },
        'Notification filtered by preference');
      return;
    }

    const message = formatPipelineEvent(event);

    // Post to Paperclip activity log (OBSV-04)
    await this.postActivity(event.type, message);
  }

  private shouldNotify(event: PipelineNotificationEvent): boolean {
    switch (this.preference) {
      case 'all':
        return true;
      case 'failures_only':
        return event.type === 'phase_failed' || event.type === 'pipeline_failed';
      case 'completions_only':
        return event.type === 'phase_completed' || event.type === 'pipeline_completed';
      case 'escalations_only':
        return event.type === 'escalation';
      default:
        return true;
    }
  }

  private async postActivity(eventType: string, message: string): Promise<void> {
    // Post to Paperclip activity log via issue comment on a dedicated GSD status issue
    // This appears in the Paperclip dashboard and is relayed to connected channels
    try {
      await this.services.issues.createComment({
        companyId: this.companyId,
        issueId: this.statusIssueId,
        body: message,
      });
    } catch (err) {
      log.error({ eventType, err }, 'Failed to post activity');
    }
  }
}
```

### Pattern 3: CEO Escalation Flow (AGNT-11)

**What:** When the pipeline encounters a DECISION_NEEDED signal from a CEO agent, the pipeline does NOT block globally. Instead, only the affected phase is paused (by storing escalation metadata), other phases continue, and the decision is delivered to the user via the NotificationService. The user responds either via Discord or the REST API (gsd.override), and the pipeline resumes that specific phase.

**When to use:** When CEO agents emit DECISION_NEEDED signals for big architectural or scope decisions.

**Example:**

```typescript
// Escalation types (added to src/orchestrator/types.ts)

export interface EscalationRecord {
  id: string;                  // UUID
  phaseNumber: number;
  context: string;             // What needs deciding
  options: string[];           // Available choices
  createdAt: string;           // ISO 8601
  resolvedAt: string | null;
  resolution: string | null;   // User's chosen option
}

// In PipelineRunner:
// When DECISION_NEEDED signal arrives:
private async handleDecisionNeeded(
  phaseNumber: number,
  signal: DecisionNeededSignal,
): Promise<void> {
  const escalation: EscalationRecord = {
    id: randomUUID(),
    phaseNumber,
    context: signal.context,
    options: signal.options,
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    resolution: null,
  };

  this.pendingEscalations.set(escalation.id, escalation);

  // Notify user via Discord
  await this.notificationService.notify({
    type: 'escalation',
    phaseNumber,
    context: signal.context,
    options: signal.options,
  });

  // Record in audit log
  await this.auditLog.record({
    phase: phaseNumber,
    decisionType: 'quality_gate',
    context: signal.context,
    optionsConsidered: signal.options,
    choice: 'escalated_to_user',
    reasoning: 'Decision requires human input',
  });

  // Phase stays in current status but no new agent is spawned
  // (effectively paused for this phase only)
}

// When user resolves:
async resolveEscalation(
  escalationId: string,
  decision: string,
): Promise<void> {
  const escalation = this.pendingEscalations.get(escalationId);
  if (!escalation) throw new Error('Escalation not found');

  escalation.resolvedAt = new Date().toISOString();
  escalation.resolution = decision;
  this.pendingEscalations.delete(escalationId);

  // Record resolution in audit log
  await this.auditLog.record({
    phase: escalation.phaseNumber,
    decisionType: 'quality_gate',
    context: escalation.context,
    optionsConsidered: escalation.options,
    choice: decision,
    reasoning: 'User resolved escalation',
  });

  // Resume the phase -- construct a DECISION_MADE-like event
  // The specific handling depends on what the CEO was deciding about
  await this.advancePhaseAfterDecision(escalation.phaseNumber, decision);
}
```

### Pattern 4: Discord Command Parsing (chat.message events)

**What:** OpenClaw delivers user Discord messages to Paperclip as events. The plugin receives these via `onEvent` with a `chat.message` or similar event type. The plugin parses the message for known command patterns (start, status, retry, pause, resume) and routes to the appropriate action handler.

**When to use:** All CLAW-01 through CLAW-07 requirements.

**Example:**

```typescript
// src/api/chat-parser.ts

export interface ParsedCommand {
  action: string;
  params: Record<string, unknown>;
}

const COMMAND_PATTERNS: Array<{
  pattern: RegExp;
  action: string;
  extractParams: (match: RegExpMatchArray) => Record<string, unknown>;
}> = [
  {
    pattern: /^(?:start|build|create)\s+(.+)/i,
    action: 'gsd.start',
    extractParams: (m) => ({ brief: m[1], projectPath: '' }),
  },
  {
    pattern: /^(?:status|progress|how'?s?\s+it\s+going)/i,
    action: 'gsd.status',
    extractParams: () => ({}),
  },
  {
    pattern: /^retry\s+(?:phase\s+)?(\d+)/i,
    action: 'gsd.retry',
    extractParams: (m) => ({ phaseNumber: Number.parseInt(m[1]!, 10) }),
  },
  {
    pattern: /^pause/i,
    action: 'gsd.pause',
    extractParams: () => ({}),
  },
  {
    pattern: /^resume/i,
    action: 'gsd.resume',
    extractParams: () => ({}),
  },
];

export function parseCommand(message: string): ParsedCommand | null {
  const trimmed = message.trim();
  for (const { pattern, action, extractParams } of COMMAND_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      return { action, params: extractParams(match) };
    }
  }
  return null;
}
```

### Pattern 5: Token/Cost Tracking (OBSV-01)

**What:** Track token usage per agent invocation by extracting token counts from heartbeat.run.status events. Aggregate by phase number and agent role. Store in a lightweight in-memory structure on PipelineRunner, serializable alongside pipeline state.

**When to use:** On every heartbeat.run.status event that includes token usage data.

**Example:**

```typescript
// src/orchestrator/token-tracker.ts

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costCents: number;  // Estimated cost
}

export interface PhaseTokenUsage {
  phaseNumber: number;
  byRole: Partial<Record<string, TokenUsage>>;
  total: TokenUsage;
}

export class TokenTracker {
  private readonly phases = new Map<number, PhaseTokenUsage>();

  recordUsage(
    phaseNumber: number,
    role: string,
    usage: Partial<TokenUsage>,
  ): void {
    let phase = this.phases.get(phaseNumber);
    if (!phase) {
      phase = {
        phaseNumber,
        byRole: {},
        total: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCents: 0 },
      };
      this.phases.set(phaseNumber, phase);
    }

    const existing = phase.byRole[role] ?? {
      inputTokens: 0, outputTokens: 0, totalTokens: 0, costCents: 0,
    };

    phase.byRole[role] = {
      inputTokens: existing.inputTokens + (usage.inputTokens ?? 0),
      outputTokens: existing.outputTokens + (usage.outputTokens ?? 0),
      totalTokens: existing.totalTokens + (usage.totalTokens ?? 0),
      costCents: existing.costCents + (usage.costCents ?? 0),
    };

    phase.total.inputTokens += usage.inputTokens ?? 0;
    phase.total.outputTokens += usage.outputTokens ?? 0;
    phase.total.totalTokens += usage.totalTokens ?? 0;
    phase.total.costCents += usage.costCents ?? 0;
  }

  getSummary(): PhaseTokenUsage[] {
    return Array.from(this.phases.values());
  }

  getTotal(): TokenUsage {
    const total = { inputTokens: 0, outputTokens: 0, totalTokens: 0, costCents: 0 };
    for (const phase of this.phases.values()) {
      total.inputTokens += phase.total.inputTokens;
      total.outputTokens += phase.total.outputTokens;
      total.totalTokens += phase.total.totalTokens;
      total.costCents += phase.total.costCents;
    }
    return total;
  }
}
```

### Pattern 6: Wiring executeAction in RPC Handler

**What:** The existing `executeAction` stub in `rpc-handler.ts` is updated to route to the action handler registry. The params include an `action` field (string) and an `args` field (the action-specific payload).

**When to use:** This is the integration point that enables API-01 through API-07.

**Example:**

```typescript
// Updated executeAction in rpc-handler.ts

async executeAction(params, id) {
  const { action, args } = params as { action: string; args: unknown };

  if (!orchestrator) {
    return error(RPC_ERRORS.INTERNAL_ERROR,
      'Pipeline runner not initialized', id);
  }

  const handler = ACTION_HANDLERS[action];
  if (!handler) {
    return error(RPC_ERRORS.METHOD_NOT_FOUND,
      `Unknown action: ${action}`, id);
  }

  const result = await handler(args, orchestrator);
  return success(result, id);
},
```

### Anti-Patterns to Avoid

- **Blocking the entire pipeline for escalations:** DECISION_NEEDED should only pause the affected phase. Other independent phases must continue executing. Never set pipeline status to 'paused' for an escalation.
- **Sending every heartbeat event to Discord:** Users do not want 100+ messages per pipeline run. Only send at meaningful transitions: phase started, phase completed, phase failed, escalation, pipeline completed/failed.
- **Parsing free-form natural language for commands:** The chat parser should match specific command patterns, not attempt NLU. Unrecognized messages should be acknowledged with a help message listing available commands.
- **Storing token data in the audit log:** The audit log is for decisions, not metrics. Token tracking is a separate concern with different access patterns (aggregation vs. append-only).
- **Exposing raw pipeline state in Discord messages:** Format status updates for human readability. Use emoji-free plain text with clear phase names and progress indicators.
- **Creating a separate HTTP server in the plugin:** Paperclip's plugin system routes external API calls through executeAction. Adding Express or another HTTP server conflicts with the single-process JSON-RPC model and wastes a port.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Pipeline state transitions | Custom state tracking | Phase 2 `pipelineTransition()` and `phaseTransition()` | Pure functions already handle PAUSE_REQUESTED, RESUME_REQUESTED |
| Agent spawning | New spawn logic | Phase 3 `spawnAgent()` | Already handles all Paperclip API calls |
| Error classification + retry | Custom retry logic | Phase 4 `retryWithBackoff()` and `classifyError()` | Already handles exponential backoff with full jitter |
| Signal parsing | Custom YAML parsing | Phase 1 `parseSignal()` | Already handles all 12 signal types including DECISION_NEEDED |
| Serial event processing | Custom concurrency control | Phase 4 `SerialEventQueue` | Already prevents race conditions |
| State serialization | Custom JSON handling | Phase 2 `serialize()`/`deserialize()` | Already handles full pipeline state round-trip |
| Decision audit logging | Custom log format | Phase 4 `AuditLog` | Already handles append-only JSONL with UUID and timestamps |

**Key insight:** Phase 6 is primarily a **surface layer**. All the core pipeline logic (FSM, agents, orchestration, error recovery) already exists in Phases 1-5. Phase 6's unique value is: (1) exposing that logic through a request/response interface (API actions), (2) formatting state changes into human-readable notifications, and (3) handling the CEO-to-user escalation bridge.

## Common Pitfalls

### Pitfall 1: executeAction Not Receiving Orchestrator Reference

**What goes wrong:** The `executeAction` handler tries to call `runner.start()` but runner is null because the RPC handler was created without an orchestrator.
**Why it happens:** In `src/plugin/index.ts`, `createRpcHandler()` is called with no arguments. Phase 4 passes an optional orchestrator but Phase 6 needs it to be wired at startup.
**How to avoid:** Modify `startPlugin()` to accept an `OrchestratorConfig` parameter, create the `PipelineRunner` at startup, and pass it to `createRpcHandler()`. The pipeline runner stays idle until `gsd.start` is called.
**Warning signs:** All `executeAction` calls return "Pipeline runner not initialized".

### Pitfall 2: Notification Spam Overwhelming Discord

**What goes wrong:** Every heartbeat event and minor state change generates a Discord message. A 6-phase pipeline produces 50+ messages.
**Why it happens:** Notifications fire on every FSM transition rather than only meaningful ones.
**How to avoid:** Only notify on: pipeline_started, phase_completed, phase_failed, escalation, pipeline_completed, pipeline_failed. Do NOT notify on: discussing, reviewing, planning, executing, verifying transitions. The notification preference system (OBSV-03) provides further filtering.
**Warning signs:** Discord channel is flooded with messages. User mutes the channel.

### Pitfall 3: Escalation Response Not Matched to Pending Escalation

**What goes wrong:** User responds to an escalation in Discord, but the plugin cannot determine which pending escalation the response is for. Multiple escalations may be active simultaneously (parallel phases).
**Why it happens:** Discord messages lack structured context linking back to escalation IDs.
**How to avoid:** When posting an escalation to Discord, include a unique reference code in the message (e.g., "Reply with `resolve ESC-abc123 <your choice>`"). The chat parser extracts the escalation ID from the response. Alternatively, if only one escalation is active at a time, accept bare responses.
**Warning signs:** User response is ignored or matched to the wrong escalation.

### Pitfall 4: Pipeline State Lost on Plugin Restart

**What goes wrong:** Plugin restarts (Paperclip restart, crash, etc.) and the in-memory PipelineRunner state is gone. User sees "Pipeline not started" even though it was mid-run.
**Why it happens:** `PipelineRunner.persistState()` currently only logs -- it does not actually persist to durable storage.
**How to avoid:** Implement real persistence in `persistState()` using Paperclip's plugin state API (HostServices `state.set(key, value)` if available) or a local file. On startup, check for persisted state and resume. The `serialize()`/`deserialize()` functions from Phase 2 already handle round-trip conversion.
**Warning signs:** After restart, pipeline state shows as null. In-flight agents have no orchestrator listening for their completion events.

### Pitfall 5: Pause Does Not Prevent New Agent Spawns

**What goes wrong:** User pauses the pipeline, but agents for the current phase step have already been spawned and are still running. When they complete, the orchestrator spawns the next agent.
**Why it happens:** The `paused` state in the FSM only prevents new pipeline-level transitions. The phase-level advancement in `advancePhase()` does not check the pipeline status.
**How to avoid:** In `advancePhase()`, check `this.state.status === 'paused'` before spawning any new agent. Let running agents complete naturally (their completion events are still processed), but do not spawn the next step. When resumed, resume from the current state.
**Warning signs:** New agents spawn after the user paused the pipeline.

### Pitfall 6: Token Data Not Available in Heartbeat Events

**What goes wrong:** TokenTracker records zeros because heartbeat.run.status events do not include token counts.
**Why it happens:** The heartbeat event schema may not include token usage -- it depends on the Paperclip version and adapter.
**How to avoid:** Check the actual heartbeat event data structure during testing. If tokens are not in heartbeat events, fetch them from the completed run's metadata after agent completion (`agents.get()` or similar). Design TokenTracker to accept usage from multiple sources (heartbeat OR post-completion fetch).
**Warning signs:** Token usage shows 0 for all phases despite agents running.

## Code Examples

### Zod Schemas for API Actions

```typescript
// src/api/schemas.ts

import { z } from 'zod';

export const StartSchema = z.object({
  projectPath: z.string().min(1),
  brief: z.string().min(1),
});

export const RetrySchema = z.object({
  phaseNumber: z.number().int().positive(),
  fromStep: z.string().optional(),
});

export const OverrideSchema = z.object({
  escalationId: z.string().uuid(),
  decision: z.string().min(1),
});

export const PreferenceSchema = z.object({
  preference: z.enum(['all', 'failures_only', 'completions_only', 'escalations_only']),
});
```

### Notification Formatters

```typescript
// src/notifications/formatters.ts

import type { PipelineNotificationEvent } from './notification-service.js';

export function formatPipelineEvent(event: PipelineNotificationEvent): string {
  switch (event.type) {
    case 'pipeline_started':
      return `GSD Pipeline started for ${event.projectPath}`;
    case 'phase_started':
      return `Phase ${event.phaseNumber}: ${event.step} started`;
    case 'phase_completed':
      return `Phase ${event.phaseNumber}: completed`;
    case 'phase_failed':
      return `Phase ${event.phaseNumber}: FAILED - ${event.error}`;
    case 'escalation':
      return [
        `DECISION NEEDED (Phase ${event.phaseNumber})`,
        '',
        event.context,
        '',
        'Options:',
        ...event.options.map((o, i) => `  ${i + 1}. ${o}`),
      ].join('\n');
    case 'pipeline_completed':
      return `GSD Pipeline completed (${event.totalPhases} phases)`;
    case 'pipeline_failed':
      return `GSD Pipeline FAILED: ${event.error}`;
    case 'pipeline_paused':
      return 'GSD Pipeline paused. Running agents will complete, no new work will start.';
    case 'pipeline_resumed':
      return 'GSD Pipeline resumed.';
  }
}
```

### PipelineRunner Pause/Resume Methods

```typescript
// Added to PipelineRunner class

async pause(): Promise<void> {
  if (!this.state) throw new Error('Pipeline not started');

  const result = pipelineTransition(this.state, { type: 'PAUSE_REQUESTED' });
  if (!result.valid) {
    throw new Error(`Cannot pause: ${result.description}`);
  }
  this.state = result.state;
  await this.persistState();

  await this.notificationService?.notify({ type: 'pipeline_paused' });
  log.info('Pipeline paused');
}

async resume(): Promise<void> {
  if (!this.state) throw new Error('Pipeline not started');

  const result = pipelineTransition(this.state, { type: 'RESUME_REQUESTED' });
  if (!result.valid) {
    throw new Error(`Cannot resume: ${result.description}`);
  }
  this.state = result.state;

  // Find all phases that were waiting to advance
  for (const phase of this.state.phases) {
    if (phase.status === 'pending') {
      // Check if dependencies are met
      const ready = this.areDependenciesMet(phase.phaseNumber);
      if (ready) {
        await this.handlePhaseEvent(phase.phaseNumber, {
          type: 'DEPENDENCIES_MET',
        });
      }
    }
  }

  await this.persistState();
  await this.notificationService?.notify({ type: 'pipeline_resumed' });
  log.info('Pipeline resumed');
}

async retryPhase(phaseNumber: number, _fromStep?: string): Promise<void> {
  if (!this.state) throw new Error('Pipeline not started');

  const phase = this.state.phases.find((p) => p.phaseNumber === phaseNumber);
  if (!phase) throw new Error(`Phase ${phaseNumber} not found`);
  if (phase.status !== 'failed') {
    throw new Error(`Phase ${phaseNumber} is not in failed state`);
  }

  await this.handlePhaseEvent(phaseNumber, { type: 'RETRY_PHASE' });
  await this.handlePhaseEvent(phaseNumber, { type: 'DEPENDENCIES_MET' });
}
```

### Wiring Chat Messages in onEvent

```typescript
// Updated onEvent handler in rpc-handler.ts

// After existing heartbeat.run.status handling:

if (event.type === 'chat.message' && orchestrator) {
  const msg = event.data as { content: string; channelId?: string; userId?: string };
  const command = parseCommand(msg.content);

  if (command) {
    const handler = ACTION_HANDLERS[command.action];
    if (handler) {
      const result = await handler(command.params, orchestrator);
      // Post response back via activity/comment
      log.info({ action: command.action, result: result.success },
        'Chat command processed');
    }
  } else {
    // Check if this is a response to a pending escalation
    const escalationMatch = msg.content.match(/resolve\s+(ESC-[\w]+)\s+(.+)/i);
    if (escalationMatch) {
      const [, escalationId, decision] = escalationMatch;
      await orchestrator.resolveEscalation(escalationId!, decision!.trim());
    }
  }

  return success({ received: true }, id);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual pipeline control (CLI commands) | REST API via executeAction RPC | Phase 6 (this phase) | Programmatic control from any HTTP client or Paperclip UI |
| Log-only status monitoring | Structured Discord notifications via OpenClaw | Phase 6 (this phase) | Users get meaningful updates without checking logs |
| CEO makes all decisions autonomously | CEO escalates big decisions to user via Discord | Phase 6 (this phase) | User stays in the loop for architectural decisions |
| No cost visibility | Token tracking per agent/phase | Phase 6 (this phase) | Users can monitor and optimize costs |
| In-memory state only | Persisted state via HostServices plugin state | Phase 6 (this phase) | Pipeline survives plugin restarts |

**Deprecated/outdated:**
- Phase 4's `persistState()` stub (log-only) is replaced with real persistence.
- The `startPlugin()` function is modified to accept configuration and create the orchestrator at startup.

## Open Questions

1. **Paperclip event type for Discord messages**
   - What we know: OpenClaw receives Discord messages and Paperclip routes them to plugins. The event type is likely `chat.message` or similar based on the live-events system.
   - What's unclear: The exact event type string and data shape for incoming user messages from Discord/OpenClaw. The heartbeat.run.status events are well-documented but chat events are not.
   - Recommendation: During Wave 0, log all incoming events in the `onEvent` handler to discover the actual event types. Design the chat parser to be event-type-agnostic (extract content string from whatever shape arrives). If no chat.message events arrive, fall back to a polling model where the plugin periodically checks a dedicated Paperclip issue for new comments.

2. **HostServices plugin state API availability**
   - What we know: The Paperclip plugin spec mentions `plugin.state` as a capability, and the `plugin-state-store.ts` service exists in the Paperclip codebase. Our manifest declares `plugin.state` capability.
   - What's unclear: Whether `state.get()`/`state.set()` are available via HostServices RPC or only from the host process.
   - Recommendation: Attempt to use `HostServices.state` for persistence. If not available, fall back to a JSONL state file at `~/.open-gsd-clip/pipeline-state.json`. Design the persistence layer with a clean interface so the backend can be swapped.

3. **Token usage data availability in heartbeat events**
   - What we know: Heartbeat events include `status`, `agentId`, `runId`, `issueId`. Token counts may be in `data.metrics` or similar.
   - What's unclear: The exact field names for token usage in heartbeat events.
   - Recommendation: Log full heartbeat event data during testing. If tokens are not in heartbeat events, attempt to read from completed run metadata after agent completion. If neither works, implement a stub that returns zeros with a TODO for future data source integration.

4. **Activity log posting mechanism**
   - What we know: Paperclip has `activityService` and `logActivity` in the server codebase. The plugin can post issue comments that appear in the activity feed.
   - What's unclear: Whether plugins have a direct `activity.post()` HostServices method or must use issue comments as a proxy.
   - Recommendation: Use issue comments on a dedicated "GSD Pipeline Status" issue as the primary notification channel. This is guaranteed to work via existing `issues.createComment()`. If a direct activity API is discovered, migrate to it.

5. **OpenClaw message format for responses**
   - What we know: OpenClaw can send messages to Discord channels via `sendMessage` action. Messages support markdown formatting.
   - What's unclear: Whether the plugin can send messages directly via OpenClaw's API or must go through Paperclip's abstraction layer (issue comments, activity log).
   - Recommendation: Start with Paperclip's issue comment system (proven to work from Phase 3-4). If the activity-to-Discord pipeline does not relay comments fast enough, investigate OpenClaw's direct messaging API as a future optimization.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 3.x |
| Config file | `vitest.config.ts` (exists) |
| Quick run command | `npx vitest run src/api/ src/notifications/ src/orchestrator/token-tracker.test.ts --reporter=verbose` |
| Full suite command | `npx vitest run --reporter=verbose` |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| API-01 | `gsd.start` action validates input and calls runner.start() | unit | `npx vitest run src/api/actions.test.ts -t "gsd.start" -x` | Wave 0 |
| API-02 | `gsd.status` returns serialized pipeline state | unit | `npx vitest run src/api/actions.test.ts -t "gsd.status" -x` | Wave 0 |
| API-03 | `gsd.phases` returns phase data from execution plan | unit | `npx vitest run src/api/actions.test.ts -t "gsd.phases" -x` | Wave 0 |
| API-04 | `gsd.retry` triggers RETRY_PHASE + DEPENDENCIES_MET | unit | `npx vitest run src/api/actions.test.ts -t "gsd.retry" -x` | Wave 0 |
| API-05 | `gsd.override` resolves pending escalation | unit | `npx vitest run src/api/actions.test.ts -t "gsd.override" -x` | Wave 0 |
| API-06 | `gsd.pause` triggers PAUSE_REQUESTED | unit | `npx vitest run src/api/actions.test.ts -t "gsd.pause" -x` | Wave 0 |
| API-07 | `gsd.resume` triggers RESUME_REQUESTED and restarts ready phases | unit | `npx vitest run src/api/actions.test.ts -t "gsd.resume" -x` | Wave 0 |
| CLAW-01 | Chat message with brief parsed into gsd.start action | unit | `npx vitest run src/api/actions.test.ts -t "chat start" -x` | Wave 0 |
| CLAW-02 | Notification fires on phase completion with correct format | unit | `npx vitest run src/notifications/notification-service.test.ts -t "phase_completed" -x` | Wave 0 |
| CLAW-03 | Escalation notification includes context and options | unit | `npx vitest run src/notifications/notification-service.test.ts -t "escalation" -x` | Wave 0 |
| CLAW-04 | Escalation response parsed and matched to pending escalation | unit | `npx vitest run src/api/actions.test.ts -t "resolve escalation" -x` | Wave 0 |
| CLAW-05 | Status query via chat returns formatted status | unit | `npx vitest run src/api/actions.test.ts -t "chat status" -x` | Wave 0 |
| CLAW-06 | Retry command via chat triggers phase retry | unit | `npx vitest run src/api/actions.test.ts -t "chat retry" -x` | Wave 0 |
| CLAW-07 | Pause/resume commands via chat work correctly | unit | `npx vitest run src/api/actions.test.ts -t "chat pause" -x` | Wave 0 |
| AGNT-11 | DECISION_NEEDED signal creates escalation record, notifies user, pauses only affected phase | unit | `npx vitest run src/orchestrator/pipeline-runner.test.ts -t "escalation" -x` | Wave 0 |
| OBSV-01 | TokenTracker records usage per phase and role | unit | `npx vitest run src/orchestrator/token-tracker.test.ts -t "record" -x` | Wave 0 |
| OBSV-02 | Status notification includes phase progress | unit | `npx vitest run src/notifications/formatters.test.ts -t "progress" -x` | Wave 0 |
| OBSV-03 | Notification preference filters events correctly | unit | `npx vitest run src/notifications/preferences.test.ts -t "filter" -x` | Wave 0 |
| OBSV-04 | Activity posted via issue comment on transitions | unit | `npx vitest run src/notifications/notification-service.test.ts -t "activity" -x` | Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run src/api/ src/notifications/ src/orchestrator/token-tracker.test.ts --reporter=verbose`
- **Per wave merge:** `npx vitest run --reporter=verbose`
- **Phase gate:** Full suite green + typecheck before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/api/schemas.ts` -- Zod schemas for API action validation
- [ ] `src/api/actions.ts` -- Action handler registry (gsd.start, gsd.status, etc.)
- [ ] `src/api/actions.test.ts` -- covers API-01 through API-07, CLAW-01, CLAW-04-07
- [ ] `src/api/chat-parser.ts` -- Discord command parsing
- [ ] `src/api/chat-parser.test.ts` -- Chat parser unit tests
- [ ] `src/api/index.ts` -- Barrel export
- [ ] `src/notifications/notification-service.ts` -- Message delivery abstraction
- [ ] `src/notifications/notification-service.test.ts` -- covers CLAW-02, CLAW-03, OBSV-04
- [ ] `src/notifications/preferences.ts` -- Notification preference management
- [ ] `src/notifications/preferences.test.ts` -- covers OBSV-03
- [ ] `src/notifications/formatters.ts` -- Human-readable message formatting
- [ ] `src/notifications/formatters.test.ts` -- covers OBSV-02
- [ ] `src/notifications/index.ts` -- Barrel export
- [ ] `src/orchestrator/token-tracker.ts` -- Token usage tracking
- [ ] `src/orchestrator/token-tracker.test.ts` -- covers OBSV-01
- [ ] `src/orchestrator/types.ts` (modify) -- Add EscalationRecord, NotificationPreference types
- [ ] `src/orchestrator/pipeline-runner.ts` (modify) -- Add pause/resume/retryPhase/resolveEscalation methods, notification hooks
- [ ] `src/orchestrator/pipeline-runner.test.ts` (modify) -- Add escalation, pause/resume tests
- [ ] `src/plugin/rpc-handler.ts` (modify) -- Wire executeAction to action registry, add chat.message handling
- [ ] `src/plugin/rpc-handler.test.ts` (modify) -- Add executeAction routing and chat parsing tests

No test framework gaps -- vitest is already configured.

## Sources

### Primary (HIGH confidence)

- [Existing codebase] -- `src/orchestrator/pipeline-runner.ts`: PipelineRunner class with start(), handleAgentCompletion(), advancePhase(), getState(), destroy(). All methods and state management directly inspected. 878 lines.
- [Existing codebase] -- `src/pipeline/types.ts`: PipelineStatus includes 'paused'. PipelineEvent includes PAUSE_REQUESTED and RESUME_REQUESTED. These FSM transitions already exist.
- [Existing codebase] -- `src/pipeline/fsm.ts`: pipelineTransition handles running->paused (PAUSE_REQUESTED) and paused->running (RESUME_REQUESTED). Directly inspected.
- [Existing codebase] -- `src/plugin/rpc-handler.ts`: Existing `executeAction` stub returns 'not_implemented'. onEvent handles heartbeat.run.status. Directly inspected.
- [Existing codebase] -- `src/signals/types.ts`: DECISION_NEEDED signal type with context and options fields. DECISION_MADE signal type with decision and reasoning fields. Directly inspected.
- [Existing codebase] -- `src/orchestrator/types.ts`: OrchestratorConfig, AuditEntry, HealthConfig, RetryConfig types. Directly inspected.
- [Paperclip plugin-host-services.ts](https://github.com/paperclipai/paperclip/blob/master/server/src/services/plugin-host-services.ts) -- Imports activityService, logActivity, pluginStateStore. Confirms activity log and plugin state APIs exist in HostServices.

### Secondary (MEDIUM confidence)

- [Paperclip PLUGIN_SPEC.md](https://github.com/paperclipai/paperclip/blob/master/doc/plugins/PLUGIN_SPEC.md) -- Plugin bridge: `usePluginAction(key)` calls worker's `performAction` RPC. `usePluginData(key, params)` calls worker's `getData` RPC. Confirms executeAction/getData as the plugin API pattern.
- [Plugin System Discussion #258](https://github.com/paperclipai/paperclip/discussions/258) -- Plugin architecture overview confirming capabilities, manifest, and RPC methods.
- [OpenClaw Discord docs](https://docs.openclaw.ai/channels/discord) -- Discord channel integration: sendMessage, readMessages actions. Per-channel configuration. Reaction notifications. Session isolation per channel.
- [OpenClaw DeepWiki Discord Integration](https://deepwiki.com/openclaw/openclaw/4.3-discord-integration) -- Discord integration architecture using @buape/carbon library, WebSocket Gateway, isolated sessions per channel.
- [OpenClaw Tools Invoke API](https://docs.openclaw.ai/gateway/tools-invoke-http-api) -- POST /tools/invoke endpoint for programmatic tool execution without LLM invocation.

### Tertiary (LOW confidence)

- [Paperclip live-events system] -- Live-events push activities to connected channels. Inferred from import of `subscribeCompanyLiveEvents` in plugin-host-services.ts. Exact event relay mechanism to OpenClaw Discord not verified.
- [Token usage in heartbeat events] -- Assumed based on standard Paperclip adapter patterns. Needs empirical validation during testing.
- [chat.message event type] -- Assumed event type for Discord messages routed through Paperclip. Not verified against actual event data.

## Metadata

**Confidence breakdown:**
- API layer (actions, schemas): HIGH -- Pure action handlers over existing PipelineRunner methods. executeAction RPC stub already exists. FSM already supports pause/resume. No new dependencies.
- Notification service: MEDIUM -- Core pattern (format + filter + post) is straightforward. Integration with Paperclip activity log confirmed via source imports. Discord delivery path through OpenClaw needs empirical validation.
- CEO escalation (AGNT-11): HIGH -- DECISION_NEEDED signal already defined in Phase 1. Pipeline FSM already supports non-blocking phase-level pausing. Escalation is pure orchestration logic.
- Token tracking (OBSV-01): MEDIUM -- Tracking structure is simple. Source of token data (heartbeat events vs. run metadata) needs validation.
- Discord chat parsing: MEDIUM -- Pattern matching is straightforward. Exact event type for incoming Discord messages needs discovery during testing.
- State persistence: LOW -- HostServices plugin state API availability not confirmed. Fallback to file-based persistence is simple.

**Research date:** 2026-03-18
**Valid until:** 2026-04-18 (30 days -- API patterns stable, OpenClaw/Paperclip integration may evolve)
