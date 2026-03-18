# Phase 2: Pipeline State Machine - Context

**Gathered:** 2026-03-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Model, validate, and serialize all pipeline-level and per-phase state transitions as a custom FSM (not XState). Build the dependency resolver that reads roadmap phase dependencies and produces correct parallel execution groups. Phase 2 delivers the state core that Phase 3+ builds on — no agent spawning, no orchestration logic, no I/O side effects.

</domain>

<decisions>
## Implementation Decisions

### Failure cascading
- Auto-fail all dependent phases when a phase fails (retries exhausted), with propagated failure context (root cause phase, failure type, error summary)
- Independent phases (no dependency on the failed one) keep running — maximize useful work
- When a failed phase is retried and succeeds, its auto-failed dependents automatically resume — fully autonomous recovery chain
- Each auto-failed phase stores: root cause phase number, failure type classification, original error message summary

### State metadata depth
- Full timing per step: track `startedAt` and `completedAt` for each sub-state (discussing, planning, executing, verifying) — enables duration analytics and bottleneck detection
- Track active Paperclip agent issue ID per phase step — critical for stale agent detection in Phase 4
- Current state only, no transition history in FSM state — transition history belongs in the audit log (Phase 4), keeps serialization lean
- Inline error context on failure: error type (transient, context_overflow, test_failure, merge_conflict, fatal), error message summary, retry count, last attempt timestamp

### Recovery on restart
- Auto-resume pipeline from last persisted state on plugin restart — matches the "come back later" core value
- For phases with in-progress agents: check agent status via Paperclip API. If agent still running, resume monitoring. If agent died, respawn for the same step
- Log and notify on recovery: emit PIPELINE_RECOVERED event with last known state, downtime duration, and recovery actions taken
- Persist state on every transition — maximum durability, at most one transition lost on crash, matches "no data loss" success criterion

### Dependency edge cases
- Fail pipeline start with clear error on circular dependencies — detect cycles during the 'analyzing' step before any agents spawn
- Fail with validation error on missing dependency references — 'Phase 4 depends on Phase 7, but Phase 7 does not exist'
- Upfront full graph validation during analysis step: cycle detection, missing refs, unreachable phases — all errors surface before any work begins
- No dependencies declared = can run immediately — standard DAG interpretation, phase is independent and eligible for the first parallel group

### Claude's Discretion
- Exact TypeScript types for FSM state, events, and transitions
- Internal data structure for the execution plan (parallel groups)
- Serialization format details (JSON shape within Paperclip plugin DB)
- Test strategy and fixture design for FSM transitions and dependency resolver
- Module placement within `src/` (e.g., `src/pipeline/` or `src/fsm/`)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Architecture
- `.planning/research/ARCHITECTURE.md` — Pipeline FSM states, transitions, Phase Driver, dependency resolution model, parallel execution groups, merge queue
- `.planning/research/STACK.md` — Technology versions, custom FSM rationale (not XState), Zod 4 schemas

### Prior phase
- `.planning/phases/01-foundation-and-protocol/01-CONTEXT.md` — Module layout, ESM, co-located tests, Zod 4 patterns, package structure decisions

### Requirements
- `.planning/REQUIREMENTS.md` — PIPE-02 (state machine with validated transitions), PIPE-06 (dependency resolver)
- `.planning/ROADMAP.md` — Phase 2 success criteria (4 criteria that must be TRUE)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None yet — Phase 1 has not been implemented. Phase 2 builds on Phase 1's module structure and Zod schema patterns.

### Established Patterns
- Module-per-component layout under `src/` with co-located tests (from Phase 1 context)
- ESM throughout, Zod 4 for schema validation (from Phase 1 context)
- Typed error classes pattern (GsdBridgeError hierarchy from Phase 1)

### Integration Points
- Pipeline FSM will be consumed by Phase Driver (Phase 3+) — must expose a pure `transition(state, event) => state` function
- FSM state must serialize to Paperclip plugin DB format — JSON blob via Paperclip's state persistence API
- Dependency resolver consumes roadmap data from GSD Bridge (Phase 1) — typed `RoadmapAnalysis` with phase dependency declarations

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches within the decisions captured above. The architecture research in ARCHITECTURE.md provides conceptual TypeScript interfaces and transition tables that should inform the implementation.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 02-pipeline-state-machine*
*Context gathered: 2026-03-18*
