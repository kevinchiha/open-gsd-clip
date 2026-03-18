# Phase 4: Sequential Pipeline Execution - Research

**Researched:** 2026-03-18
**Domain:** Pipeline orchestration, error recovery, stale agent detection, CEO quality gate, audit logging
**Confidence:** HIGH

## Summary

Phase 4 is the orchestration layer that wires together everything built in Phases 1-3 into a working end-to-end pipeline. The core challenge is not new infrastructure -- the FSM (Phase 2) and agent spawning (Phase 3) already exist. Phase 4's job is to build the **orchestrator** that drives the FSM through its states by spawning agents at the right time, interpreting their results, and handling failures.

The phase breaks down into five distinct technical concerns: (1) the pipeline orchestrator that starts with a brief and drives phases through discuss -> CEO review -> plan -> execute -> verify; (2) the CEO quality gate that reviews CONTEXT.md and approves or requests revision; (3) error classification and retry with exponential backoff; (4) stale agent detection via progress-based health checks; and (5) a decision audit log that records every CEO decision with full context.

All five concerns are internal orchestration logic with no new external dependencies. The existing stack (TypeScript 5.8, Zod 3.25, pino 9.x, vitest 3.x) handles everything. The FSM transition functions from Phase 2 are pure and side-effect-free -- Phase 4 builds the impure orchestration layer that calls them and reacts to the returned states.

**Primary recommendation:** Build the orchestrator as a single `src/orchestrator/` module with focused files: `pipeline-runner.ts` (main loop), `quality-gate.ts` (CEO review logic), `error-handler.ts` (classification + retry), `health-monitor.ts` (stale detection + timeouts), and `audit-log.ts` (decision recording). Each file has clear inputs/outputs and is independently testable.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PIPE-03 | Pipeline can be started with a project brief and target project path | `createInitialPipelineState(projectPath, brief)` from Phase 2 FSM creates the initial state. Pipeline runner accepts brief + path, initializes state, spawns CEO agent to run `/gsd:new-project --auto` |
| PIPE-08 | Pipeline executes all phases end-to-end without human intervention | Pipeline runner drives the phase loop: for each phase in execution plan order, transition through discussing -> reviewing -> planning -> executing -> verifying using agent spawning from Phase 3 |
| AGNT-08 | CEO quality gate reviews CONTEXT.md between discuss and plan | After discusser completes (phase enters `reviewing` state), CEO agent reads CONTEXT.md and emits APPROVED or REVISION_NEEDED signal. Quality gate function constructs CEO review issue with CONTEXT.md path |
| AGNT-09 | CEO agent can request discussion revision | On REVISION_NEEDED signal, phase transitions reviewing -> discussing (already supported by Phase 2 phase-machine.ts). Orchestrator re-spawns discusser with CEO's feedback injected into issue description |
| AGNT-10 | CEO decision audit log records every autonomous decision | Append-only log file at `.planning/audit-log.jsonl` records each decision with timestamp, phase, context, options, choice, reasoning. Structured JSON lines for easy parsing |
| AGNT-12 | CEO detects execution problems and triggers re-planning | On VERIFY_FAILED or execution failures, CEO evaluates whether the issue is a plan problem vs implementation bug. If plan problem, phase transitions to `failed` then `RETRY_PHASE` resets to `pending`, orchestrator re-runs from discuss |
| EXEC-02 | Error handler classifies failures by type | Error classification function inspects agent error signals, exit codes, and output patterns to categorize as transient/context_overflow/test_failure/merge_conflict/fatal. ErrorType enum already exists in Phase 2 types |
| EXEC-03 | Retry manager retries with exponential backoff | `retryWithBackoff(fn, config)` utility wraps agent operations. Config: maxRetries, baseDelay, maxDelay, jitter. Backoff formula: `min(baseDelay * 2^attempt + jitter, maxDelay)` |
| EXEC-04 | Stale agent detection via progress-based health checks | Health monitor tracks `lastActivityAt` per agent. If no heartbeat.run.status event or issue comment for configurable threshold (default: 10 minutes), agent is considered stale. Hard per-step timeout (default: 30 minutes) forces respawn |
| EXEC-05 | Phase-level retry from specific step | `retryPhaseFromStep(pipelineState, phaseNumber, fromStep)` resets the phase to the target step status and re-enters the orchestration loop. Phase 2 RETRY_PHASE event resets to `pending`; orchestrator can skip forward to a specific step |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | 5.8.x | Language | Already installed |
| Zod | 3.25.x | Schema validation for audit log entries, config | Already installed |
| pino | 9.x | Structured operational logging | Already installed |
| node:fs/promises | built-in | Write audit log, read CONTEXT.md for quality gate | No external dep needed |
| node:timers/promises | built-in | `setTimeout` for backoff delays | Standard Node.js async timers |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| node:path | built-in | Construct paths for audit log, CONTEXT.md | Path operations |
| node:crypto | built-in | `randomUUID()` for decision IDs, `randomInt()` for jitter | Unique IDs without extra deps |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled exponential backoff | `exponential-backoff` npm package | 23 lines of code vs. adding a dependency. Hand-roll is fine for this simple case |
| JSONL audit file | SQLite or Paperclip plugin state | JSONL is simpler, append-only, human-readable, and portable. Plugin state has size limits. SQLite adds a dependency |
| setTimeout-based stale detection | node:worker_threads with watchdog | setTimeout in the event loop is sufficient. Agents complete via events, not polling. Worker threads add complexity for no benefit |

**Installation:**

No new packages needed. Phase 4 uses only existing dependencies.

## Architecture Patterns

### Recommended Project Structure

```
src/
  orchestrator/
    pipeline-runner.ts      # Main orchestration loop: start -> drive phases -> complete
    quality-gate.ts         # CEO quality gate: review CONTEXT.md, approve/revise
    error-handler.ts        # Error classification + retry with backoff
    health-monitor.ts       # Stale agent detection + per-step timeouts
    audit-log.ts            # Decision audit log (append-only JSONL)
    types.ts                # Orchestrator-specific types (OrchestratorConfig, AuditEntry, etc.)
    pipeline-runner.test.ts # Integration-style tests with mocked agents
    quality-gate.test.ts    # Unit tests for review logic
    error-handler.test.ts   # Unit tests for classification + retry
    health-monitor.test.ts  # Unit tests for stale detection
    audit-log.test.ts       # Unit tests for log writing/reading
    index.ts                # Barrel export
  agents/
    ...                     # Phase 3 modules (factory, context, invoker)
  pipeline/
    ...                     # Phase 2 modules (FSM, resolver, serialization)
```

### Pattern 1: Event-Driven Orchestration Loop

**What:** The orchestrator does NOT poll. It reacts to events dispatched from the `onEvent` RPC handler. When an agent completes (heartbeat.run.status = succeeded/failed), the event handler parses the signal, maps it to a PhaseEvent, and calls `orchestrator.handlePhaseEvent(phaseNumber, event)`. The orchestrator then transitions the FSM and spawns the next agent if needed.

**When to use:** This is the main pattern. Every state transition in the pipeline is triggered by an agent completion event.

**Example:**

```typescript
// src/orchestrator/pipeline-runner.ts

export class PipelineRunner {
  private state: PipelineState;
  private agents: Record<AgentRole, AgentDefinition>;
  private config: OrchestratorConfig;
  private auditLog: AuditLog;
  private healthMonitor: HealthMonitor;

  constructor(
    services: HostServices,
    config: OrchestratorConfig,
    auditLog: AuditLog,
  ) {
    // ...
  }

  /**
   * Start a new pipeline run.
   * Creates initial state, spawns CEO agent for /gsd:new-project --auto.
   */
  async start(projectPath: string, brief: string): Promise<void> {
    this.state = createInitialPipelineState(projectPath, brief);
    const result = pipelineTransition(this.state, { type: 'START_PIPELINE' });
    if (!result.valid) throw new Error(result.description);
    this.state = result.state;

    // Ensure agents exist
    this.agents = await ensureAgentsExist(
      this.services,
      this.companyId,
      projectPath,
      this.config.model,
    );

    // Spawn CEO for project initialization
    const spawn = await spawnAgent(
      this.services,
      this.companyId,
      this.agents.ceo.agentId,
      {
        role: 'ceo',
        projectPath,
        gsdCommand: '/gsd:new-project --auto',
        brief,
      },
    );

    // Track active agent
    this.state = this.transitionPhaseState(0, {
      type: 'SET_AGENT',
      agentIssueId: spawn.issueId,
    });

    // Start health monitoring for this agent
    this.healthMonitor.trackAgent(spawn.issueId, spawn.runId);
  }

  /**
   * Handle a phase event from an agent completion.
   * Transitions FSM and spawns next agent.
   */
  async handlePhaseEvent(
    phaseNumber: number,
    event: PhaseEvent,
  ): Promise<void> {
    // Transition phase FSM
    const phaseState = this.getPhaseState(phaseNumber);
    const result = phaseTransition(phaseState, event);
    if (!result.valid) {
      log.warn({ phaseNumber, event, reason: result.description },
        'Invalid phase transition');
      return;
    }
    this.updatePhaseState(phaseNumber, result.state);

    // React to new state
    await this.advancePhase(phaseNumber, result.state);
  }

  private async advancePhase(
    phaseNumber: number,
    phase: PhaseState,
  ): Promise<void> {
    switch (phase.status) {
      case 'discussing':
        await this.spawnDiscusser(phaseNumber);
        break;
      case 'reviewing':
        await this.spawnCeoReview(phaseNumber);
        break;
      case 'planning':
        await this.spawnPlanner(phaseNumber);
        break;
      case 'executing':
        await this.spawnExecutor(phaseNumber);
        break;
      case 'verifying':
        await this.spawnVerifier(phaseNumber);
        break;
      case 'done':
        await this.onPhaseComplete(phaseNumber);
        break;
      case 'failed':
        await this.onPhaseFailed(phaseNumber, phase);
        break;
    }
  }
}
```

### Pattern 2: CEO Quality Gate via Agent Review

**What:** After the discusser completes and the phase enters `reviewing`, the orchestrator spawns a CEO agent with an issue that contains the CONTEXT.md path and a review prompt. The CEO reads the CONTEXT.md, evaluates completeness, and emits either APPROVED or REVISION_NEEDED signal. This is implemented as a regular agent invocation with a specialized issue description.

**When to use:** Between discussion and planning for every phase.

**Example:**

```typescript
// src/orchestrator/quality-gate.ts

export function buildCeoReviewContext(
  projectPath: string,
  phaseNumber: number,
): AgentContext {
  return {
    role: 'ceo',
    projectPath,
    phaseNumber,
    gsdCommand: 'review-context',  // Not a real GSD command -- CEO reads CONTEXT.md directly
  };
}

export function buildReviewIssueDescription(
  projectPath: string,
  phaseNumber: number,
  contextMdPath: string,
): string {
  return [
    '## CEO Quality Gate Review',
    '',
    `**Project path:** ${projectPath}`,
    `**Phase:** ${phaseNumber}`,
    `**File to review:** ${contextMdPath}`,
    '',
    '## Instructions',
    '',
    '1. Read the CONTEXT.md file at the path above',
    '2. Evaluate whether it adequately covers:',
    '   - Clear decisions for all implementation choices',
    '   - No unresolved ambiguities that would block planning',
    '   - Alignment with project requirements and prior phase decisions',
    '3. If adequate, post an APPROVED signal',
    '4. If gaps exist, post a REVISION_NEEDED signal with specific feedback',
    '',
    '## When Approved',
    '',
    '```yaml',
    '---',
    'GSD_SIGNAL:APPROVED',
    `phase: ${phaseNumber}`,
    'summary: [Brief reasoning for approval]',
    '---',
    '```',
    '',
    '## When Revision Needed',
    '',
    '```yaml',
    '---',
    'GSD_SIGNAL:REVISION_NEEDED',
    `phase: ${phaseNumber}`,
    'feedback: [Specific gaps or issues that need addressing]',
    'summary: [Brief description of what needs revision]',
    '---',
    '```',
  ].join('\n');
}
```

### Pattern 3: Error Classification by Signal Content

**What:** When an agent fails or emits an error signal, the error handler classifies it into one of the five ErrorType categories. Classification uses pattern matching on the error message and signal content. Each error type has a different recovery strategy.

**When to use:** On every STEP_FAILED event.

**Example:**

```typescript
// src/orchestrator/error-handler.ts

import type { ErrorType } from '../pipeline/types.js';

interface ClassifiedError {
  type: ErrorType;
  retryable: boolean;
  maxRetries: number;
  message: string;
}

const ERROR_PATTERNS: Array<{
  pattern: RegExp;
  type: ErrorType;
  retryable: boolean;
  maxRetries: number;
}> = [
  // Context overflow: agent hit token limit
  { pattern: /context.*(overflow|limit|too long|token)/i, type: 'context_overflow', retryable: false, maxRetries: 0 },
  // Test failure: verification found issues
  { pattern: /(test|assertion|expect).*(fail|error)/i, type: 'test_failure', retryable: true, maxRetries: 2 },
  // Merge conflict: git conflict
  { pattern: /(merge conflict|CONFLICT|<<<<<<)/i, type: 'merge_conflict', retryable: true, maxRetries: 1 },
  // Transient: network, timeout, rate limit
  { pattern: /(ECONNRESET|ETIMEDOUT|rate.?limit|503|502|429)/i, type: 'transient', retryable: true, maxRetries: 3 },
];

export function classifyError(message: string): ClassifiedError {
  for (const { pattern, type, retryable, maxRetries } of ERROR_PATTERNS) {
    if (pattern.test(message)) {
      return { type, retryable, maxRetries, message };
    }
  }
  // Default: fatal (no retry)
  return { type: 'fatal', retryable: false, maxRetries: 0, message };
}
```

### Pattern 4: Exponential Backoff with Full Jitter

**What:** Retryable operations use exponential backoff with full jitter. The delay formula is `random(0, min(baseDelay * 2^attempt, maxDelay))`. Full jitter prevents thundering herd when multiple agents fail simultaneously.

**When to use:** Wrapping agent spawn operations for transient failures.

**Example:**

```typescript
// src/orchestrator/error-handler.ts

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,     // 1 second
  maxDelayMs: 60_000,    // 1 minute cap
};

export function calculateBackoffDelay(
  attempt: number,
  config: RetryConfig,
): number {
  const exponentialDelay = config.baseDelayMs * Math.pow(2, attempt);
  const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);
  // Full jitter: random between 0 and capped delay
  return Math.floor(Math.random() * cappedDelay);
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt === config.maxRetries) break;

      const delay = calculateBackoffDelay(attempt, config);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
```

### Pattern 5: Progress-Based Stale Agent Detection

**What:** The health monitor tracks each active agent's last activity timestamp. Activity is detected from heartbeat events (any `heartbeat.run.status` with `status: 'running'`). If no activity for a configurable threshold, the agent is considered stale. A hard per-step timeout independently forces failure after a maximum duration.

**When to use:** Started when an agent is spawned, stopped when the agent completes.

**Example:**

```typescript
// src/orchestrator/health-monitor.ts

export interface HealthConfig {
  staleThresholdMs: number;  // Default: 10 minutes
  hardTimeoutMs: number;     // Default: 30 minutes
  checkIntervalMs: number;   // Default: 60 seconds
}

export const DEFAULT_HEALTH_CONFIG: HealthConfig = {
  staleThresholdMs: 10 * 60 * 1000,
  hardTimeoutMs: 30 * 60 * 1000,
  checkIntervalMs: 60 * 1000,
};

interface TrackedAgent {
  issueId: string;
  runId: string;
  startedAt: number;
  lastActivityAt: number;
}

export class HealthMonitor {
  private tracked = new Map<string, TrackedAgent>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private onStale: (issueId: string, reason: string) => void;

  constructor(
    config: HealthConfig,
    onStale: (issueId: string, reason: string) => void,
  ) {
    this.config = config;
    this.onStale = onStale;
  }

  trackAgent(issueId: string, runId: string): void {
    const now = Date.now();
    this.tracked.set(issueId, {
      issueId,
      runId,
      startedAt: now,
      lastActivityAt: now,
    });
    this.ensureChecking();
  }

  recordActivity(issueId: string): void {
    const agent = this.tracked.get(issueId);
    if (agent) {
      agent.lastActivityAt = Date.now();
    }
  }

  untrackAgent(issueId: string): void {
    this.tracked.delete(issueId);
    if (this.tracked.size === 0) this.stopChecking();
  }

  private check(): void {
    const now = Date.now();
    for (const [issueId, agent] of this.tracked) {
      const elapsed = now - agent.lastActivityAt;
      const totalElapsed = now - agent.startedAt;

      if (totalElapsed >= this.config.hardTimeoutMs) {
        this.onStale(issueId, `Hard timeout exceeded: ${totalElapsed}ms`);
      } else if (elapsed >= this.config.staleThresholdMs) {
        this.onStale(issueId, `No activity for ${elapsed}ms`);
      }
    }
  }
}
```

### Pattern 6: Append-Only JSONL Audit Log

**What:** Every CEO decision is recorded as a JSON line in `.planning/audit-log.jsonl` within the target project. Each entry has a unique ID, timestamp, phase context, decision type, options considered, choice made, and reasoning. The file is append-only -- entries are never modified or deleted.

**When to use:** On every APPROVED, REVISION_NEEDED, or re-planning decision.

**Example:**

```typescript
// src/orchestrator/audit-log.ts

export interface AuditEntry {
  id: string;                    // UUID
  timestamp: string;             // ISO 8601
  phase: number;
  decisionType: 'quality_gate' | 'revision_request' | 'replan' | 'error_recovery';
  context: string;               // What was being evaluated
  optionsConsidered: string[];   // Available choices
  choice: string;                // What was decided
  reasoning: string;             // Why this choice
  agentIssueId?: string;         // Issue that made the decision
}

export class AuditLog {
  private logPath: string;

  constructor(projectPath: string) {
    this.logPath = path.join(projectPath, '.planning', 'audit-log.jsonl');
  }

  async record(entry: Omit<AuditEntry, 'id' | 'timestamp'>): Promise<void> {
    const full: AuditEntry = {
      ...entry,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
    };
    await fs.appendFile(this.logPath, JSON.stringify(full) + '\n', 'utf-8');
  }

  async readAll(): Promise<AuditEntry[]> {
    const content = await fs.readFile(this.logPath, 'utf-8').catch(() => '');
    return content
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as AuditEntry);
  }
}
```

### Anti-Patterns to Avoid

- **Polling for agent completion:** The `onEvent` handler already receives heartbeat.run.status events. Never poll `agents.get()` in a loop.
- **Blocking the event loop during backoff:** Use `setTimeout` (via `node:timers/promises`), never `while(true)` busy-wait loops.
- **Storing audit log in Paperclip plugin state:** Plugin state has size limits and is not human-readable. Use a project-local JSONL file.
- **Re-implementing FSM transitions:** The pure transition functions from Phase 2 handle all state validation. The orchestrator calls them and reacts -- it never sets state directly.
- **Coupling orchestrator to RPC handler:** The RPC handler dispatches events to the orchestrator via a clean interface. The orchestrator does not know about JSON-RPC.
- **Making the orchestrator a singleton:** Pass the orchestrator instance to the RPC handler. Multiple test instances should be possible.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| State transitions | Custom state tracking | Phase 2 `pipelineTransition()` and `phaseTransition()` | Pure functions already handle all valid/invalid transitions with descriptions |
| Agent spawning | New spawn logic | Phase 3 `spawnAgent()` and `ensureAgentsExist()` | Factory and invoker handle all Paperclip API calls |
| Signal parsing | Custom YAML parsing | Phase 1 `parseSignal()` | Already handles all 12 signal types with Zod validation |
| Signal-to-event mapping | Manual switch in orchestrator | Phase 3 `mapSignalToPhaseEvent()` | Already maps signals to PhaseEvent discriminated union |
| Failure cascade | Manual dependent-phase tracking | Phase 2 `cascadeFailure()` | BFS cascade with visited set, handles diamond dependencies |
| UUID generation | Custom ID scheme | `node:crypto.randomUUID()` | Standard, collision-free, no dependency |
| Backoff delay calculation | Third-party library | Hand-rolled `calculateBackoffDelay()` | 5 lines of code: `Math.floor(Math.random() * Math.min(base * 2^n, max))` |

**Key insight:** Phase 4 is primarily an orchestration and coordination layer. All the building blocks (FSM, agent spawning, signal parsing) already exist from Phases 1-3. Phase 4's unique value is wiring them together correctly with error recovery, health monitoring, and audit logging.

## Common Pitfalls

### Pitfall 1: Race Condition Between Event Handler and Orchestrator

**What goes wrong:** Two heartbeat events arrive in rapid succession for different phases. The orchestrator processes them concurrently, both read the same pipeline state, and one overwrites the other's transition.
**Why it happens:** JavaScript is single-threaded but async operations can interleave at await points.
**How to avoid:** Use a serial event queue. When `handlePhaseEvent` is called, add the event to a queue and process sequentially. Use a simple async mutex or promise chain pattern.
**Warning signs:** Phase state appears to "skip" a transition or an agent is spawned twice.

### Pitfall 2: Revision Loop Without Limit

**What goes wrong:** CEO keeps requesting revisions and the discusser keeps failing to satisfy the quality gate. The pipeline loops forever between `discussing` and `reviewing`.
**Why it happens:** No maximum revision count is enforced.
**How to avoid:** Track revision count per phase. After N revisions (default: 3), escalate or fail the phase with a clear error message. Store revision count in the PhaseState or orchestrator state.
**Warning signs:** Phase status alternates between `discussing` and `reviewing` more than 3 times.

### Pitfall 3: Stale Detection Fires During Legitimate Long Operations

**What goes wrong:** The executor agent is working on a large phase that takes 20 minutes. The health monitor detects it as stale after 10 minutes and respawns it, creating duplicate work.
**Why it happens:** The stale threshold is too short for the operation type, or heartbeat events during active work are not being counted as activity.
**How to avoid:** (1) Use heartbeat events with `status: 'running'` as activity signals -- the claude_local adapter sends these periodically. (2) Allow per-step timeout overrides in OrchestratorConfig for expensive steps (execution is typically longer than discussion). (3) Only respawn if BOTH the stale threshold AND a minimum elapsed time are exceeded.
**Warning signs:** Agent respawned while still producing output. Duplicate commits or duplicate planning artifacts.

### Pitfall 4: CEO Review Agent Cannot Read CONTEXT.md

**What goes wrong:** CEO agent is spawned with `mode: 'isolated'` and its isolated workspace does not have the latest CONTEXT.md that the discusser just wrote.
**Why it happens:** Isolated workspaces are git worktree copies. If the discusser committed CONTEXT.md but the CEO's worktree was created before the commit, the file is not there.
**How to avoid:** The CEO review agent should use the SAME workspace as the project (or the orchestrator should ensure the discusser's changes are committed and merged before spawning the CEO reviewer). For sequential execution (Phase 4), using `mode: 'project_primary'` for the CEO reviewer is safe since only one agent runs at a time. Alternatively, the orchestrator waits for the discusser's commit to land, then spawns CEO.
**Warning signs:** CEO review signal says "CONTEXT.md not found" or reviews an outdated version.

### Pitfall 5: Backoff Timer Prevents Shutdown

**What goes wrong:** A `setTimeout` for backoff delay keeps the Node.js process alive during plugin shutdown, causing the plugin to hang.
**Why it happens:** Active timers prevent the event loop from draining.
**How to avoid:** Use `AbortController` with `setTimeout` from `node:timers/promises`. On shutdown, abort all pending timers. Track active timers in the retry manager for cleanup.
**Warning signs:** Plugin shutdown takes longer than expected. Paperclip kills the plugin process after timeout.

### Pitfall 6: Audit Log File Not Created Before First Write

**What goes wrong:** `fs.appendFile` to a path where the parent directory does not exist yet (`.planning/` directory might not exist if this is a fresh project that the CEO just initialized).
**Why it happens:** `/gsd:new-project` creates the `.planning/` directory, but the orchestrator tries to write the audit log before the CEO agent completes initialization.
**How to avoid:** Create the audit log file (and parent directories) lazily on first write using `fs.mkdir(dir, { recursive: true })`. Or wait until after `PROJECT_READY` signal before writing any audit entries.
**Warning signs:** `ENOENT` error on first audit log write.

## Code Examples

### Orchestrator Configuration Type

```typescript
// src/orchestrator/types.ts

export interface OrchestratorConfig {
  /** Model to use for all agents */
  model: string;
  /** Company/tenant ID for Paperclip */
  companyId: string;
  /** Maximum revision rounds before failing quality gate */
  maxRevisions: number;
  /** Retry configuration */
  retry: RetryConfig;
  /** Health monitoring configuration */
  health: HealthConfig;
  /** Step-specific timeout overrides (ms) */
  stepTimeouts: Partial<Record<PhaseStatus, number>>;
}

export const DEFAULT_CONFIG: OrchestratorConfig = {
  model: 'claude-sonnet-4-6',
  companyId: '',  // Must be provided
  maxRevisions: 3,
  retry: DEFAULT_RETRY_CONFIG,
  health: DEFAULT_HEALTH_CONFIG,
  stepTimeouts: {
    discussing: 15 * 60 * 1000,   // 15 min
    reviewing: 10 * 60 * 1000,    // 10 min
    planning: 20 * 60 * 1000,     // 20 min
    executing: 45 * 60 * 1000,    // 45 min (longest step)
    verifying: 15 * 60 * 1000,    // 15 min
  },
};
```

### Wiring onEvent to Orchestrator

```typescript
// Updated src/plugin/rpc-handler.ts (Phase 4 additions)

// The RPC handler receives a reference to the orchestrator at creation time.
// This is the integration point between event-driven RPC and the orchestrator.

export function createRpcHandler(orchestrator: PipelineRunner | null) {
  // ... existing handler creation ...

  const methods: Record<string, MethodHandler> = {
    // ... existing methods ...

    async onEvent(params, id) {
      const event = params as { type: string; data: unknown };

      if (event.type === 'heartbeat.run.status' && orchestrator) {
        const run = event.data as {
          status: string;
          agentId: string;
          runId: string;
          issueId?: string;
        };

        // Record activity for health monitoring
        if (run.issueId) {
          orchestrator.healthMonitor.recordActivity(run.issueId);
        }

        // Only process terminal states
        if (run.status === 'succeeded' || run.status === 'failed') {
          await orchestrator.handleAgentCompletion(run);
        }
      }

      return success({ received: true }, id);
    },
  };
}
```

### Phase Advancement Flow (Sequential)

```typescript
// The sequential execution flow for a single phase:
//
// 1. Phase enters 'pending' (dependencies met)
// 2. Orchestrator sends DEPENDENCIES_MET -> phase enters 'discussing'
// 3. Spawn discusser agent -> wait for DISCUSS_COMPLETE signal
// 4. Phase enters 'reviewing'
// 5. Spawn CEO reviewer -> wait for APPROVED or REVISION_NEEDED
//    - REVISION_NEEDED: phase goes back to 'discussing', re-spawn discusser with feedback
//    - APPROVED: phase enters 'planning'
// 6. Spawn planner agent -> wait for PLAN_COMPLETE signal
// 7. Phase enters 'executing'
// 8. Spawn executor agent -> wait for EXECUTE_COMPLETE signal
// 9. Phase enters 'verifying'
// 10. Spawn verifier agent -> wait for VERIFY_COMPLETE or VERIFY_FAILED
//     - VERIFY_FAILED: phase goes back to 'executing' (per phase-machine.ts)
//     - VERIFY_COMPLETE: phase enters 'done'
// 11. Pipeline checks if all phases done -> ALL_PHASES_DONE
```

### Serial Event Queue Pattern

```typescript
// src/orchestrator/event-queue.ts

/**
 * Ensures phase events are processed one at a time.
 * Prevents race conditions from concurrent event handling.
 */
export class SerialEventQueue {
  private processing = false;
  private queue: Array<() => Promise<void>> = [];

  async enqueue(handler: () => Promise<void>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.queue.push(async () => {
        try {
          await handler();
          resolve();
        } catch (err) {
          reject(err);
        }
      });
      this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) await next();
    }

    this.processing = false;
  }
}
```

### Re-Planning Decision by CEO

```typescript
// When verification fails, the CEO evaluates whether this is a plan problem
// or an implementation bug.

async function handleVerificationFailure(
  orchestrator: PipelineRunner,
  phaseNumber: number,
  issues: string[],
): Promise<void> {
  const auditEntry = {
    phase: phaseNumber,
    decisionType: 'error_recovery' as const,
    context: `Verification failed with ${issues.length} issues: ${issues.join('; ')}`,
    optionsConsidered: [
      'Retry execution (implementation bug)',
      'Re-plan phase (plan problem)',
      'Fail phase (unrecoverable)',
    ],
    choice: '', // Determined by CEO
    reasoning: '', // Determined by CEO
  };

  // Spawn CEO to evaluate -- issue description includes the failure details
  // CEO emits either:
  //   DECISION_MADE with decision='retry_execution' -> re-enter executing
  //   DECISION_MADE with decision='replan' -> RETRY_PHASE to reset, then re-run
  //   DECISION_MADE with decision='fail' -> leave in failed state
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Polling agent status in a loop | Event-driven via heartbeat.run.status | Phase 3 design | Orchestrator reacts to events, never polls |
| Monolithic orchestration function | Modular: runner + gate + handler + monitor + audit | Current best practice | Each concern is testable independently |
| Global state shared between handlers | Immutable FSM transitions + serial event queue | Phase 2 FSM design | No race conditions, predictable behavior |
| Retry with fixed delay | Exponential backoff with full jitter | Standard since AWS well-architected | Prevents thundering herd, reduces server load |

**Deprecated/outdated:**
- None. Phase 4 builds on Phase 1-3 patterns which are current.

## Open Questions

1. **Workspace mode for CEO reviewer in sequential execution**
   - What we know: Phase 3 uses `mode: 'isolated'` for all agents to prevent collisions in parallel execution.
   - What's unclear: In sequential execution (Phase 4), isolated mode means the CEO reviewer may not see the discusser's freshly committed CONTEXT.md. Using `mode: 'project_primary'` would be simpler for sequential but would need to change for Phase 5 parallel.
   - Recommendation: Use `mode: 'project_primary'` for Phase 4 sequential execution. Phase 5 will need to handle workspace synchronization for parallel. Document this as a Phase 5 concern.

2. **How to pass CEO feedback to re-discussion**
   - What we know: When CEO emits REVISION_NEEDED with a `feedback` field, the orchestrator must pass this feedback to the re-spawned discusser.
   - What's unclear: Whether the feedback should go in the new issue description or via an issue comment.
   - Recommendation: Include the CEO's feedback in the new discusser issue description under a "## Previous Review Feedback" section. This ensures the discusser sees the feedback immediately in its task context.

3. **AGNT-12 re-planning trigger mechanism**
   - What we know: CEO should detect when execution reveals plan problems and trigger re-planning. The phase machine supports `RETRY_PHASE` to reset to `pending`.
   - What's unclear: Whether re-planning means going back to discuss (full reset) or just to planning (partial reset). The current FSM only supports full reset via `RETRY_PHASE` to `pending`.
   - Recommendation: For v1, use full reset (`RETRY_PHASE` -> `pending` -> `discussing`). This is simpler and more robust. If the plan was wrong, the discussion context might also need updating. Track re-plan count to prevent infinite loops (max 2 re-plans per phase).

4. **Pipeline state persistence across plugin restarts**
   - What we know: `serialize()` and `deserialize()` exist from Phase 2. Paperclip provides `HostServices.state` for plugin state storage.
   - What's unclear: How frequently to persist and how to recover from a crash mid-phase.
   - Recommendation: Persist pipeline state after every FSM transition via `HostServices.state.set()`. On plugin restart, deserialize the state and resume from the current position. Any in-progress agent (activeAgentIssueId != null) should be checked -- if the agent completed while the plugin was down, fetch its issue comments for the signal.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 3.x |
| Config file | `vitest.config.ts` (exists) |
| Quick run command | `npx vitest run src/orchestrator/ --reporter=verbose` |
| Full suite command | `npx vitest run --reporter=verbose` |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PIPE-03 | `start(projectPath, brief)` initializes state and spawns CEO | unit | `npx vitest run src/orchestrator/pipeline-runner.test.ts -t "start"` | Wave 0 |
| PIPE-08 | Full phase loop: discussing -> reviewing -> planning -> executing -> verifying -> done | unit | `npx vitest run src/orchestrator/pipeline-runner.test.ts -t "phase loop"` | Wave 0 |
| AGNT-08 | CEO review spawns with CONTEXT.md path, handles APPROVED | unit | `npx vitest run src/orchestrator/quality-gate.test.ts -t "CEO review"` | Wave 0 |
| AGNT-09 | REVISION_NEEDED re-spawns discusser with feedback | unit | `npx vitest run src/orchestrator/quality-gate.test.ts -t "revision"` | Wave 0 |
| AGNT-10 | Audit log records decision with all required fields | unit | `npx vitest run src/orchestrator/audit-log.test.ts -t "record"` | Wave 0 |
| AGNT-12 | Re-planning resets phase to pending and re-runs | unit | `npx vitest run src/orchestrator/pipeline-runner.test.ts -t "replan"` | Wave 0 |
| EXEC-02 | Error classification matches all five error types | unit | `npx vitest run src/orchestrator/error-handler.test.ts -t "classify"` | Wave 0 |
| EXEC-03 | Exponential backoff delays increase with jitter | unit | `npx vitest run src/orchestrator/error-handler.test.ts -t "backoff"` | Wave 0 |
| EXEC-04 | Stale agent detected after threshold, hard timeout forces fail | unit | `npx vitest run src/orchestrator/health-monitor.test.ts -t "stale"` | Wave 0 |
| EXEC-05 | Phase retry from failed resets to pending via RETRY_PHASE | unit | `npx vitest run src/orchestrator/pipeline-runner.test.ts -t "retry phase"` | Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run src/orchestrator/ --reporter=verbose`
- **Per wave merge:** `npx vitest run --reporter=verbose`
- **Phase gate:** Full suite green + typecheck before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/orchestrator/types.ts` -- OrchestratorConfig, AuditEntry, HealthConfig types
- [ ] `src/orchestrator/pipeline-runner.test.ts` -- covers PIPE-03, PIPE-08, AGNT-12, EXEC-05
- [ ] `src/orchestrator/quality-gate.test.ts` -- covers AGNT-08, AGNT-09
- [ ] `src/orchestrator/error-handler.test.ts` -- covers EXEC-02, EXEC-03
- [ ] `src/orchestrator/health-monitor.test.ts` -- covers EXEC-04
- [ ] `src/orchestrator/audit-log.test.ts` -- covers AGNT-10

No test framework gaps -- vitest is already configured.

## Sources

### Primary (HIGH confidence)

- [Existing codebase Phase 2] -- `src/pipeline/types.ts`, `src/pipeline/fsm.ts`, `src/pipeline/phase-machine.ts`: FSM types (PipelineState, PhaseState, PipelineEvent, PhaseEvent, ErrorType), pure transition functions (pipelineTransition, phaseTransition), PHASE_TRANSITIONS table with reviewing state, cascadeFailure. All directly inspected.
- [Existing codebase Phase 3] -- `src/agents/types.ts`, `src/agents/context.ts`: AgentRole, AgentDefinition, HostServices interface (with Result<T,E> return types), AgentContext, buildIssueTitle. All directly inspected.
- [Phase 3 Plans] -- `03-01-PLAN.md`, `03-02-PLAN.md`, `03-03-PLAN.md`: Agent factory (ensureAgentsExist), context builder (buildIssueDescription), invoker (spawnAgent, mapSignalToPhaseEvent), onEvent handler update. These define the Phase 3 API that Phase 4 consumes.
- [Existing codebase Phase 1] -- `src/signals/parser.ts`, `src/signals/types.ts`: parseSignal for GSD_SIGNAL extraction, all 12 signal types including APPROVED, REVISION_NEEDED, DECISION_MADE.

### Secondary (MEDIUM confidence)

- [Exponential Backoff patterns](https://www.tylercrosse.com/ideas/2022/exponential-backoff/) -- Full jitter formula: `random(0, min(base * 2^n, cap))`. Verified against AWS Well-Architected documentation.
- [Martin Fowler Audit Log pattern](https://martinfowler.com/eaaDev/AuditLog.html) -- Append-only log with timestamp, actor, action, context. JSONL format is the standard implementation for file-based audit trails.
- [Autonomous Quality Gates](https://www.augmentcode.com/guides/autonomous-quality-gates-ai-powered-code-review) -- Quality gate pattern: AI reviews artifact, emits approve/reject verdict, revision loop with maximum iterations.

### Tertiary (LOW confidence)

- [Heartbeat stale detection](https://gist.github.com/huttj/862467833f6d4d7b10a0) -- Simple heartbeat pattern with staleness threshold. Adapted for Paperclip's event-driven heartbeat.run.status model rather than direct heartbeat pinging.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new packages; all existing dependencies verified in Phase 1-2
- Architecture: HIGH -- orchestrator pattern directly follows from Phase 2 FSM design (pure transitions + impure reactor). All upstream APIs (Phase 1-3) inspected from source.
- Pitfalls: HIGH -- race condition, revision loops, stale detection timing, workspace mode issues all derived from concrete FSM and agent lifecycle constraints verified against existing code
- Error handling: HIGH -- ErrorType enum already exists in Phase 2 types. Classification patterns and backoff formula well-established.
- Audit logging: HIGH -- simple append-only JSONL pattern, no novel code. pino already provides structured logging infrastructure.

**Research date:** 2026-03-18
**Valid until:** 2026-04-18 (30 days -- stable domain, internal orchestration over existing APIs)
