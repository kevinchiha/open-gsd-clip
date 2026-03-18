# Phase 2: Pipeline State Machine - Research

**Researched:** 2026-03-18
**Domain:** Custom finite state machine, DAG dependency resolution, state serialization
**Confidence:** HIGH

## Summary

Phase 2 builds the state management core and dependency resolver for the entire pipeline. There are two distinct FSMs (pipeline-level and per-phase), a DAG-based dependency resolver that produces parallel execution groups, and a serialization layer that persists state to Paperclip's plugin DB format.

The user has locked a critical decision: **custom FSM, not XState**. This contradicts STACK.md's initial recommendation but aligns with ARCHITECTURE.md's rationale: XState's actor model fights Paperclip's event-driven model rather than complementing it. The custom FSM is a pure `transition(state, event) => state` function with a typed transition table -- highly testable, zero dependencies, and trivially serializable.

The dependency resolver uses Kahn's algorithm (BFS-based topological sort) with level-by-level processing to extract parallel execution groups. This is a well-understood O(V+E) algorithm that naturally produces the groups needed. Cycle detection falls out for free: if not all nodes are processed, a cycle exists. The resolver must also validate missing dependency references and detect unreachable phases.

**Primary recommendation:** Build three modules: `src/pipeline/fsm.ts` (pure FSM), `src/pipeline/resolver.ts` (DAG resolver), and `src/pipeline/serialization.ts` (Zod schemas for persistence). All are pure logic with no I/O, making them exhaustively testable.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Failure cascading:**
- Auto-fail all dependent phases when a phase fails (retries exhausted), with propagated failure context (root cause phase, failure type, error summary)
- Independent phases (no dependency on the failed one) keep running -- maximize useful work
- When a failed phase is retried and succeeds, its auto-failed dependents automatically resume -- fully autonomous recovery chain
- Each auto-failed phase stores: root cause phase number, failure type classification, original error message summary

**State metadata depth:**
- Full timing per step: track `startedAt` and `completedAt` for each sub-state (discussing, planning, executing, verifying) -- enables duration analytics and bottleneck detection
- Track active Paperclip agent issue ID per phase step -- critical for stale agent detection in Phase 4
- Current state only, no transition history in FSM state -- transition history belongs in the audit log (Phase 4), keeps serialization lean
- Inline error context on failure: error type (transient, context_overflow, test_failure, merge_conflict, fatal), error message summary, retry count, last attempt timestamp

**Recovery on restart:**
- Auto-resume pipeline from last persisted state on plugin restart -- matches the "come back later" core value
- For phases with in-progress agents: check agent status via Paperclip API. If agent still running, resume monitoring. If agent died, respawn for the same step
- Log and notify on recovery: emit PIPELINE_RECOVERED event with last known state, downtime duration, and recovery actions taken
- Persist state on every transition -- maximum durability, at most one transition lost on crash, matches "no data loss" success criterion

**Dependency edge cases:**
- Fail pipeline start with clear error on circular dependencies -- detect cycles during the 'analyzing' step before any agents spawn
- Fail with validation error on missing dependency references -- 'Phase 4 depends on Phase 7, but Phase 7 does not exist'
- Upfront full graph validation during analysis step: cycle detection, missing refs, unreachable phases -- all errors surface before any work begins
- No dependencies declared = can run immediately -- standard DAG interpretation, phase is independent and eligible for the first parallel group

### Claude's Discretion

- Exact TypeScript types for FSM state, events, and transitions
- Internal data structure for the execution plan (parallel groups)
- Serialization format details (JSON shape within Paperclip plugin DB)
- Test strategy and fixture design for FSM transitions and dependency resolver
- Module placement within `src/` (e.g., `src/pipeline/` or `src/fsm/`)

### Deferred Ideas (OUT OF SCOPE)

None -- discussion stayed within phase scope.

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PIPE-02 | Pipeline state machine tracks phase steps (idle -> discussing -> planning -> executing -> verifying -> done/failed) with validated transitions | Custom FSM with typed transition table, Zod-validated events, pure transition function. Both pipeline-level and per-phase sub-state machines needed. |
| PIPE-06 | Phase dependency resolver determines which phases can run in parallel vs must run sequentially based on roadmap data | Kahn's algorithm (BFS topological sort) with level extraction for parallel groups. Includes cycle detection, missing ref validation, and unreachable phase detection. |

</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | 5.8.x | Language | Already installed. Discriminated unions and mapped types are ideal for FSM state modeling. |
| Zod | 3.25.x | Schema validation & serialization | Already installed (`^3.25.0`). Used for event validation, state serialization schemas, and round-trip persistence. |
| vitest | 3.x | Testing | Already installed (`^3.0.0`). Co-located test files per project convention. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pino | 9.x | Logging | Already installed. Use `createChildLogger('pipeline')` for FSM transition logging to stderr. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom FSM | XState 5.28 | XState's actor model fights Paperclip's event-driven model. Custom FSM is simpler, zero-dep, trivially serializable. **User locked: custom FSM.** |
| Custom DAG resolver | `topological-sort-group` npm | Adds a dependency for ~50 lines of well-understood algorithm code. Hand-rolling with Kahn's algorithm is straightforward and avoids dependency risk. |
| Zod discriminated unions | TypeScript `switch` exhaustiveness | Zod provides runtime validation AND type inference. Pure TS switch only catches errors at compile time, not when deserializing from DB. |

**Installation:**

No new packages needed. Phase 2 uses only existing dependencies.

## Architecture Patterns

### Recommended Project Structure

```
src/
  pipeline/
    fsm.ts              # Pure pipeline-level FSM (transition function, state types)
    phase-machine.ts     # Pure per-phase sub-state machine
    types.ts             # All pipeline/phase state types, events, error types
    resolver.ts          # DAG dependency resolver (Kahn's algorithm)
    serialization.ts     # Zod schemas for state persistence (serialize/deserialize)
    fsm.test.ts          # Pipeline FSM transition tests
    phase-machine.test.ts # Per-phase sub-state machine tests
    resolver.test.ts     # Dependency resolver tests (parallel groups, cycles, edge cases)
    serialization.test.ts # Round-trip serialization tests
    index.ts             # Public API barrel export
  shared/
    errors.ts            # GsdError hierarchy (existing)
    types.ts             # Result<T,E>, JsonValue, JsonObject (existing)
    logger.ts            # pino logger (existing)
```

**Rationale for `src/pipeline/` (not `src/fsm/`):** The module contains more than just the FSM -- it includes the dependency resolver, serialization layer, and phase sub-state machine. "pipeline" reflects the domain better than "fsm."

### Pattern 1: Pure Transition Function

**What:** The FSM transition function is a pure function `(state, event) => TransitionResult` with no side effects. Side effects (persist to DB, notify, spawn agents) are triggered by consumers reacting to the returned state.

**When to use:** All state transitions -- both pipeline-level and per-phase.

**Example:**

```typescript
// Discriminated union for pipeline states
type PipelineStatus = 'idle' | 'initializing' | 'analyzing' | 'running' | 'paused' | 'completed' | 'failed';

// Discriminated union for pipeline events
type PipelineEvent =
  | { type: 'START_PIPELINE'; brief: string; projectPath: string }
  | { type: 'PROJECT_READY' }
  | { type: 'ANALYSIS_COMPLETE'; executionPlan: ExecutionPlan }
  | { type: 'PHASE_COMPLETED'; phaseNumber: number }
  | { type: 'PHASE_FAILED'; phaseNumber: number; error: PhaseError }
  | { type: 'ALL_PHASES_DONE' }
  | { type: 'PAUSE_REQUESTED' }
  | { type: 'RESUME_REQUESTED' }
  | { type: 'UNRECOVERABLE_ERROR'; error: string };

// TransitionResult wraps new state + optional effects descriptor
interface TransitionResult {
  state: PipelineState;
  valid: boolean;        // false if the transition was invalid
  description?: string;  // human-readable reason for invalid transitions
}

// Pure function -- no side effects
function transition(state: PipelineState, event: PipelineEvent): TransitionResult {
  switch (state.status) {
    case 'idle':
      if (event.type === 'START_PIPELINE') {
        return {
          state: { ...state, status: 'initializing', startedAt: new Date().toISOString() },
          valid: true,
        };
      }
      break;
    case 'running':
      if (event.type === 'PAUSE_REQUESTED') {
        return { state: { ...state, status: 'paused' }, valid: true };
      }
      if (event.type === 'ALL_PHASES_DONE') {
        return { state: { ...state, status: 'completed', completedAt: new Date().toISOString() }, valid: true };
      }
      // ... handle PHASE_COMPLETED, PHASE_FAILED, etc.
      break;
    // ... other states
  }

  // Invalid transition
  return {
    state,
    valid: false,
    description: `Invalid transition: ${state.status} + ${event.type}`,
  };
}
```

### Pattern 2: Transition Table as Data (Not Code)

**What:** Define valid transitions as a data structure (map/record), not as switch/case logic. This makes the transition rules inspectable, serializable, and exhaustively testable.

**When to use:** For the per-phase sub-state machine where transitions are more uniform.

**Example:**

```typescript
// Transition table: current state -> event type -> next state
const PHASE_TRANSITIONS: Record<PhaseStatus, Partial<Record<PhaseEventType, PhaseStatus>>> = {
  pending:    { DEPENDENCIES_MET: 'discussing' },
  discussing: { STEP_COMPLETED: 'reviewing', STEP_FAILED: 'failed' },
  reviewing:  { APPROVED: 'planning', REVISION_NEEDED: 'discussing' },
  planning:   { STEP_COMPLETED: 'executing', STEP_FAILED: 'failed' },
  executing:  { STEP_COMPLETED: 'verifying', STEP_FAILED: 'failed' },
  verifying:  { STEP_COMPLETED: 'done', STEP_FAILED: 'executing' }, // retry loop
  done:       {},  // terminal
  failed:     { RETRY_PHASE: 'pending' },  // reset to pending for retry
};

function transitionPhase(state: PhaseState, event: PhaseEvent): TransitionResult<PhaseState> {
  const table = PHASE_TRANSITIONS[state.status];
  const nextStatus = table?.[event.type];
  if (!nextStatus) {
    return { state, valid: false, description: `Invalid: ${state.status} + ${event.type}` };
  }
  return {
    state: {
      ...state,
      status: nextStatus,
      stepTimings: updateTimings(state.stepTimings, state.status, nextStatus),
    },
    valid: true,
  };
}
```

### Pattern 3: Kahn's Algorithm with Level Extraction

**What:** Modified Kahn's algorithm that groups nodes by "level" (when they become available) to produce parallel execution groups.

**When to use:** Dependency resolver to determine which phases can run simultaneously.

**Example:**

```typescript
interface ExecutionPlan {
  groups: number[][];        // groups[0] = [1, 3] means phases 1 and 3 run first in parallel
  phaseOrder: number[];      // flattened topological order
}

function buildExecutionPlan(phases: PhaseDefinition[]): Result<ExecutionPlan, ResolverError> {
  // Build adjacency list and in-degree map
  const inDegree = new Map<number, number>();
  const dependents = new Map<number, number[]>(); // phase -> phases that depend on it

  for (const phase of phases) {
    inDegree.set(phase.number, phase.dependsOn.length);
    for (const dep of phase.dependsOn) {
      const list = dependents.get(dep) ?? [];
      list.push(phase.number);
      dependents.set(dep, list);
    }
  }

  // Kahn's with level extraction
  const groups: number[][] = [];
  let queue = phases.filter(p => inDegree.get(p.number) === 0).map(p => p.number);
  let processed = 0;

  while (queue.length > 0) {
    groups.push([...queue]); // current level = parallel group
    const nextQueue: number[] = [];
    for (const phaseNum of queue) {
      processed++;
      for (const dep of dependents.get(phaseNum) ?? []) {
        const newDegree = (inDegree.get(dep) ?? 1) - 1;
        inDegree.set(dep, newDegree);
        if (newDegree === 0) nextQueue.push(dep);
      }
    }
    queue = nextQueue;
  }

  // Cycle detection: if not all phases processed, cycle exists
  if (processed !== phases.length) {
    const cycleNodes = phases.filter(p => (inDegree.get(p.number) ?? 0) > 0);
    return { ok: false, error: new CyclicDependencyError(cycleNodes.map(p => p.number)) };
  }

  return {
    ok: true,
    value: { groups, phaseOrder: groups.flat() },
  };
}
```

### Pattern 4: Zod Schema for Serialization Round-Trip

**What:** Define Zod schemas that mirror the FSM state types. Use `schema.parse()` for deserialization (with validation) and the inferred type for serialization (via `JSON.stringify()`).

**When to use:** Every state persistence operation (persist to Paperclip plugin DB, restore on restart).

**Example:**

```typescript
import { z } from 'zod';

const PhaseErrorSchema = z.object({
  type: z.enum(['transient', 'context_overflow', 'test_failure', 'merge_conflict', 'fatal']),
  message: z.string(),
  retryCount: z.number().int().min(0),
  lastAttemptAt: z.string().datetime().nullable(),
});

const StepTimingSchema = z.object({
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
});

const PhaseStateSchema = z.object({
  phaseNumber: z.number().int().positive(),
  status: z.enum(['pending', 'discussing', 'reviewing', 'planning', 'executing', 'verifying', 'done', 'failed']),
  stepTimings: z.record(z.string(), StepTimingSchema),
  activeAgentIssueId: z.string().nullable(),
  error: PhaseErrorSchema.nullable(),
  failureCascade: z.object({
    rootCausePhase: z.number().int().positive(),
    failureType: z.string(),
    errorSummary: z.string(),
  }).nullable(),
});

const PipelineStateSchema = z.object({
  status: z.enum(['idle', 'initializing', 'analyzing', 'running', 'paused', 'completed', 'failed']),
  phases: z.array(PhaseStateSchema),
  executionPlan: ExecutionPlanSchema.nullable(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  lastTransitionAt: z.string().datetime(),
  projectPath: z.string(),
  brief: z.string(),
});

// Serialize: state -> JSON string
function serialize(state: PipelineState): string {
  return JSON.stringify(state);
}

// Deserialize: JSON string -> validated state
function deserialize(json: string): Result<PipelineState, z.ZodError> {
  const parsed = PipelineStateSchema.safeParse(JSON.parse(json));
  if (parsed.success) return { ok: true, value: parsed.data };
  return { ok: false, error: parsed.error };
}
```

### Anti-Patterns to Avoid

- **Mutable state in FSM:** Never mutate the state object in-place. Always return a new state object from the transition function. Mutation makes debugging impossible and breaks persist-on-every-transition.
- **Side effects in transition function:** The transition function must be pure. No DB writes, no logging, no agent spawning inside it. Side effects happen in the caller that reacts to the transition result.
- **Storing transition history in FSM state:** Per user decision, transition history belongs in the audit log (Phase 4). The FSM state tracks current state only, keeping serialization lean.
- **Using Map<K,V> in serialized state:** `Map` does not serialize to JSON. Use `Record<string, V>` or arrays of tuples for all serialized state. ARCHITECTURE.md shows `Map<number, PhaseState>` as conceptual -- implementation must use a serializable alternative (array or record).
- **Coupling resolver to roadmap parsing:** The resolver should accept a simple `{ phaseNumber: number; dependsOn: number[] }[]` input, not raw roadmap data. The GSD Bridge (Phase 1) handles parsing; the resolver is a pure graph algorithm.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Zod schema validation | Custom JSON validators | Zod 3.25.x `.parse()` / `.safeParse()` | Handles edge cases (extra fields, type coercion, nested validation), provides detailed error messages, and infers TypeScript types |
| Logging | `console.log` | `createChildLogger('pipeline')` from shared/logger.ts | stdout is reserved for JSON-RPC. Console logging corrupts the protocol stream |
| Error types | Generic Error | Extend `GsdError` / `GsdOperationalError` from shared/errors.ts | Existing error hierarchy established in Phase 1 |
| Result type | Throw/catch | `Result<T, E>` from shared/types.ts | Already established pattern. Prefer for expected failure paths (invalid transitions, resolver errors) |

**Key insight:** Phase 2 is entirely pure logic -- no I/O, no network, no file system. Everything is functions operating on data structures. This means the "don't hand-roll" list is short: you ARE hand-rolling the FSM and resolver (that's the point), but you use existing infrastructure for validation, logging, and error handling.

## Common Pitfalls

### Pitfall 1: Map Not Serializable to JSON

**What goes wrong:** Using `Map<number, PhaseState>` (as shown in ARCHITECTURE.md conceptual types) and discovering it serializes to `{}` with `JSON.stringify()`.
**Why it happens:** JavaScript's `JSON.stringify()` does not handle Map, Set, or other non-plain-object types.
**How to avoid:** Use `PhaseState[]` (array indexed by position, find by phaseNumber) or `Record<string, PhaseState>` (string keys are required for JSON objects). Array is recommended -- it preserves insertion order and is simpler to work with.
**Warning signs:** State persists as `{"phases":{}}` instead of containing actual phase data.

### Pitfall 2: Forgetting Terminal State Guards

**What goes wrong:** A phase in `done` or `failed` status receives an event and transitions again, corrupting the pipeline.
**Why it happens:** The transition table has entries for terminal states that should be empty. Or a wildcard handler catches events for terminal states.
**How to avoid:** Terminal states (`done`, `completed`, `failed`) should have empty transition maps. The transition function explicitly returns `{ valid: false }` for any event on a terminal state. Write exhaustive tests for every event on every terminal state.
**Warning signs:** Phases cycling between `done` and earlier states. Retry triggering on already-completed phases.

### Pitfall 3: Failure Cascade Creates Infinite Loop

**What goes wrong:** Phase A fails, auto-failing dependent Phase B. Phase B's failure triggers "check dependents of B" which tries to fail Phase C. But Phase C was already failed by the same cascade, and the handler re-processes it, creating a loop.
**Why it happens:** The cascade logic does not check if the dependent phase is already in `failed` state before processing it.
**How to avoid:** The cascade function must check: if the phase is already `failed`, skip it. Use a visited set during cascade propagation. Write test: `A -> B -> C` where A fails, and verify cascade visits each node exactly once.
**Warning signs:** Stack overflow during failure processing. Duplicate `PHASE_AUTO_FAILED` events for the same phase.

### Pitfall 4: Timing Metadata Not Updated on State Rollback

**What goes wrong:** Phase in `verifying` fails and rolls back to `executing` (retry loop). But `stepTimings.verifying.completedAt` is set (it completed, just with failure) and `stepTimings.executing.startedAt` still has the old timestamp.
**Why it happens:** The timing update logic only handles forward transitions, not backward ones (retry loops).
**How to avoid:** When rolling back to a previous step (e.g., `verifying -> executing`), reset the target step's timing: set `startedAt` to now, clear `completedAt`. The previous step's timing should remain as historical data. Write explicit tests for backward transitions and timing state.
**Warning signs:** Duration analytics showing negative or zero durations for retried steps.

### Pitfall 5: Resolver Accepts Empty Dependency Arrays as Valid

**What goes wrong:** A phase with `dependsOn: []` and a phase with no `dependsOn` field are treated differently, causing some phases to be excluded from execution groups.
**Why it happens:** Missing field vs empty array distinction in JavaScript. `undefined !== []`.
**How to avoid:** Normalize inputs: treat `undefined`, `null`, and `[]` for `dependsOn` as "no dependencies" (eligible for first parallel group). The Zod input schema should transform missing values to `[]` using `.default([])`.
**Warning signs:** Phases with no declared dependencies not appearing in any execution group.

### Pitfall 6: Concurrent Phase State Mutations

**What goes wrong:** Two parallel phases complete simultaneously. Both trigger `PHASE_COMPLETED` events. The pipeline FSM processes them sequentially but the second event operates on the original state (not the state after the first event).
**Why it happens:** If the event processing is not properly serialized, both events read the same "before" state. This is more of a Phase 3+ concern but the FSM design must support it.
**How to avoid:** The FSM transition function is pure, so this is a consumer problem. Document clearly: **transitions must be applied sequentially** -- the consumer must serialize event processing. Each transition takes the output state of the previous transition as input. Phase 2 does not need to implement the serialization mechanism, but the API contract must be clear.
**Warning signs:** Phase completion counts not matching. Some completions "lost" because they were applied to stale state.

## Code Examples

### Pipeline State Types (Recommended)

```typescript
// Error classification (from user decisions)
type ErrorType = 'transient' | 'context_overflow' | 'test_failure' | 'merge_conflict' | 'fatal';

interface PhaseError {
  type: ErrorType;
  message: string;
  retryCount: number;
  lastAttemptAt: string | null;
}

interface FailureCascadeInfo {
  rootCausePhase: number;
  failureType: string;
  errorSummary: string;
}

interface StepTiming {
  startedAt: string | null;
  completedAt: string | null;
}

type PhaseStatus =
  | 'pending'     // not yet started, dependencies not met
  | 'discussing'  // discusser agent active
  | 'reviewing'   // CEO reviewing discuss output
  | 'planning'    // planner agent active
  | 'executing'   // executor agent active
  | 'verifying'   // verifier agent active
  | 'done'        // phase complete and verified
  | 'failed';     // phase failed (retries exhausted or cascade)

interface PhaseState {
  phaseNumber: number;
  status: PhaseStatus;
  stepTimings: Record<string, StepTiming>;
  activeAgentIssueId: string | null;  // Paperclip agent issue ID
  error: PhaseError | null;
  failureCascade: FailureCascadeInfo | null;  // set when auto-failed by dependency
}

type PipelineStatus =
  | 'idle'
  | 'initializing'
  | 'analyzing'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed';

interface PipelineState {
  status: PipelineStatus;
  phases: PhaseState[];
  executionPlan: ExecutionPlan | null;
  startedAt: string | null;
  completedAt: string | null;
  lastTransitionAt: string;
  projectPath: string;
  brief: string;
}
```

### Dependency Resolver with Full Validation

```typescript
type ResolverError =
  | { type: 'cyclic_dependency'; involvedPhases: number[] }
  | { type: 'missing_dependency'; phase: number; missingDep: number }
  | { type: 'unreachable_phase'; phases: number[] };

interface PhaseInput {
  phaseNumber: number;
  dependsOn: number[];
}

interface ExecutionPlan {
  groups: number[][];     // parallel execution groups, ordered by level
  phaseOrder: number[];   // flattened topological order
}

function validateAndResolve(phases: PhaseInput[]): Result<ExecutionPlan, ResolverError> {
  const phaseNumbers = new Set(phases.map(p => p.phaseNumber));

  // 1. Validate all dependency references exist
  for (const phase of phases) {
    for (const dep of phase.dependsOn) {
      if (!phaseNumbers.has(dep)) {
        return { ok: false, error: { type: 'missing_dependency', phase: phase.phaseNumber, missingDep: dep } };
      }
    }
  }

  // 2. Build graph and run Kahn's with level extraction
  // ... (see Architecture Patterns section above)

  // 3. Cycle detection: unprocessed nodes indicate a cycle
  // 4. Unreachable phase detection: phases not in any group
}
```

### Failure Cascade Logic

```typescript
function cascadeFailure(
  state: PipelineState,
  failedPhase: number,
  error: PhaseError,
  dependencyGraph: Map<number, number[]>,  // phase -> phases that depend on it
): PipelineState {
  const visited = new Set<number>();
  const toProcess = [failedPhase];
  let newState = { ...state, phases: [...state.phases] };

  visited.add(failedPhase); // don't re-process the original failure

  while (toProcess.length > 0) {
    const current = toProcess.shift()!;
    const dependents = dependencyGraph.get(current) ?? [];

    for (const dep of dependents) {
      if (visited.has(dep)) continue;
      visited.add(dep);

      const phaseIdx = newState.phases.findIndex(p => p.phaseNumber === dep);
      if (phaseIdx === -1) continue;

      const phase = newState.phases[phaseIdx]!;
      // Only cascade to phases that haven't completed
      if (phase.status === 'done') continue;

      newState.phases[phaseIdx] = {
        ...phase,
        status: 'failed',
        failureCascade: {
          rootCausePhase: failedPhase,
          failureType: error.type,
          errorSummary: error.message,
        },
      };

      toProcess.push(dep); // cascade to THEIR dependents too
    }
  }

  return newState;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| XState for all state machines | Custom FSMs for simple, serializable state; XState for complex UI state | 2024-2025 | XState v5's actor model adds overhead for pipeline state that just needs transitions + serialization |
| Hand-rolled JSON validation | Zod 3.x schemas with `.safeParse()` | 2023+ | Type inference + runtime validation in one declaration |
| DFS-based topological sort | Kahn's algorithm (BFS) with level extraction | Well-established | BFS naturally produces parallel execution groups; DFS only produces linear order |
| Mutable state machines | Immutable state with pure transitions | 2020+ (Redux/Elm influence) | Testable, debuggable, replayable, trivially serializable |

**Deprecated/outdated:**
- Zod 4.x: STACK.md mentioned it, but the project uses Zod 3.25.x (installed version). This is correct -- Zod 3.25 is the current stable release line. The "Zod 4" branding in STACK.md appears to have been confused with Zod 3.25's marketing as the successor generation.

## Open Questions

1. **PhaseState array vs record for phases**
   - What we know: `Map<number, PhaseState>` is not JSON-serializable. Must use array or record.
   - What's unclear: Whether to index by phase number (record with string keys) or use a flat array with `.find()`.
   - Recommendation: Use `PhaseState[]` array. Phase count is small (typically 3-10). Array preserves insertion order, is simpler to serialize, and `.find()` on a small array is negligible cost. If performance matters later, convert to record.

2. **Reviewing state in per-phase FSM**
   - What we know: ARCHITECTURE.md lists `reviewing` (CEO quality gate) and `blocked` (waiting on user). The success criteria only mentions `idle -> discussing -> planning -> executing -> verifying -> done/failed`.
   - What's unclear: Whether Phase 2 should include `reviewing` and `blocked` states or defer them.
   - Recommendation: Include `reviewing` now. It's referenced in the ARCHITECTURE.md transition table and is needed for the CEO quality gate (Phase 4). Including it in the transition table costs nothing and prevents a breaking change later. Defer `blocked` to Phase 6 (user-facing integration).

3. **`paused` pipeline state handling for in-progress phases**
   - What we know: When pipeline is paused, running agents finish their current work.
   - What's unclear: How to model "paused but phases still in progress" -- does each phase remain in its current sub-state?
   - Recommendation: `paused` is a pipeline-level status only. Per-phase states continue until they reach a terminal point in their current step. The Phase Driver (Phase 3+) handles the "don't spawn new agents" logic. Phase 2 just models the valid transition `running -> paused` and `paused -> running`.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 3.2.x |
| Config file | `vitest.config.ts` (exists) |
| Quick run command | `npx vitest run src/pipeline/ --reporter=verbose` |
| Full suite command | `npx vitest run --reporter=verbose` |

### Phase Requirements to Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PIPE-02 (FSM transitions) | Pipeline FSM enforces valid transitions, rejects invalid | unit | `npx vitest run src/pipeline/fsm.test.ts -x` | Wave 0 |
| PIPE-02 (phase sub-state) | Per-phase sub-state machine tracks step transitions | unit | `npx vitest run src/pipeline/phase-machine.test.ts -x` | Wave 0 |
| PIPE-02 (serialization) | State serializes/deserializes without data loss | unit | `npx vitest run src/pipeline/serialization.test.ts -x` | Wave 0 |
| PIPE-06 (parallel groups) | Resolver produces correct parallel execution groups | unit | `npx vitest run src/pipeline/resolver.test.ts -x` | Wave 0 |
| PIPE-06 (cycle detection) | Resolver rejects circular dependencies | unit | `npx vitest run src/pipeline/resolver.test.ts -x` | Wave 0 |
| PIPE-06 (missing refs) | Resolver rejects missing dependency references | unit | `npx vitest run src/pipeline/resolver.test.ts -x` | Wave 0 |
| PIPE-06 (edge cases) | No deps = first group; single phase; linear chain | unit | `npx vitest run src/pipeline/resolver.test.ts -x` | Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run src/pipeline/ --reporter=verbose`
- **Per wave merge:** `npx vitest run --reporter=verbose`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/pipeline/fsm.test.ts` -- covers PIPE-02 pipeline-level FSM transitions
- [ ] `src/pipeline/phase-machine.test.ts` -- covers PIPE-02 per-phase sub-state transitions
- [ ] `src/pipeline/serialization.test.ts` -- covers PIPE-02 round-trip serialization
- [ ] `src/pipeline/resolver.test.ts` -- covers PIPE-06 dependency resolver, cycle detection, missing refs

No framework gaps -- vitest is already configured and working (`vitest.config.ts` exists, `logger.test.ts` demonstrates the pattern).

## Sources

### Primary (HIGH confidence)

- ARCHITECTURE.md -- Pipeline FSM states, transitions, Phase Driver, dependency resolution model, conceptual TypeScript interfaces
- STACK.md -- Technology versions, custom FSM rationale (superseded by CONTEXT.md decision), Zod patterns
- Phase 2 CONTEXT.md -- Locked decisions on failure cascading, state metadata, recovery, dependency edge cases
- Phase 1 CONTEXT.md -- Module layout conventions, ESM, co-located tests, Zod patterns, error hierarchy

### Secondary (MEDIUM confidence)

- [Composable State Machines in TypeScript](https://medium.com/@MichaelVD/composable-state-machines-in-typescript-type-safe-predictable-and-testable-5e16574a6906) -- Type-safe FSM patterns
- [Topological Sorting Explained](https://medium.com/@amit.anjani89/topological-sorting-explained-a-step-by-step-guide-for-dependency-resolution-1a6af382b065) -- Kahn's algorithm for dependency resolution
- [Kahn's Algorithm for Topological Sorting](https://www.geeksforgeeks.org/dsa/topological-sorting-indegree-based-solution/) -- BFS with level extraction for parallel groups
- [Parallelizing Operations With Dependencies](https://learn.microsoft.com/en-us/archive/msdn-magazine/2009/april/parallelizing-operations-with-dependencies) -- Microsoft reference on DAG-based parallel scheduling
- [Zod Documentation](https://zod.dev/) -- Schema validation, safeParse, type inference

### Tertiary (LOW confidence)

- [topological-sort-group npm](https://www.npmjs.com/package/topological-sort-group) -- npm package for DAG parallel groups (considered but not recommended -- hand-rolling is simpler for this use case)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all dependencies already installed and verified. No new packages needed.
- Architecture: HIGH -- patterns are well-established (pure FSM, Kahn's algorithm, Zod serialization). All are pure logic with comprehensive testing.
- Pitfalls: HIGH -- pitfalls derived from concrete design decisions (Map serialization, terminal state guards, cascade loops) and verified against ARCHITECTURE.md.
- Dependency resolver: HIGH -- Kahn's algorithm is a textbook algorithm with well-understood properties. Level extraction for parallel groups is a standard modification.

**Research date:** 2026-03-18
**Valid until:** 2026-04-18 (stable domain -- FSM patterns and graph algorithms do not change)
