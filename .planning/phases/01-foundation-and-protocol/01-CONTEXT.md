# Phase 1: Foundation and Protocol - Context

**Gathered:** 2026-03-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Establish the base layer that all subsequent phases build on: a working Paperclip plugin shell that communicates via JSON-RPC over stdio, a typed GSD tools bridge that can parse roadmaps and read state, and a signal parser that extracts structured GSD_SIGNAL data from Paperclip issue comments. The project scaffolding (TypeScript, build, test, lint) is also delivered here.

</domain>

<decisions>
## Implementation Decisions

### Signal protocol format
- YAML frontmatter format delimited by `---` markers, with `GSD_SIGNAL:<TYPE>` as the first line inside the block
- Strict Zod schema per signal type — every signal type has a defined schema with required/optional fields, unknown fields are stripped, missing required fields produce parse errors that are logged
- All 12 signal types defined in Phase 1: PROJECT_READY, DISCUSS_COMPLETE, APPROVED, REVISION_NEEDED, PLAN_COMPLETE, EXECUTE_COMPLETE, VERIFY_COMPLETE, VERIFY_FAILED, DECISION_NEEDED, DECISION_MADE, AGENT_ERROR, STALE_HEARTBEAT
- Parser extracts signal blocks from surrounding text — agents can write natural language before/after the YAML block, parser scans for `---` delimited blocks containing `GSD_SIGNAL`

### GSD Bridge scope
- Phase 1 wraps only what's needed: `analyzeRoadmap()`, `getPhase()`, `getState()`, `findPhase()` — remaining commands (updateState, completePhase, verify, etc.) added in later phases as needed
- Typed errors, fail fast — bridge wraps execa errors into typed error classes (GsdBridgeError, GsdToolsNotFoundError, GsdParseError, GsdTimeoutError). No retry at bridge level; retry policy belongs to higher layers
- Auto-discover gsd-tools.cjs path: (1) GSD_TOOLS_PATH env var, (2) ~/.claude/get-shit-done/bin/gsd-tools.cjs, (3) resolve from 'get-shit-done-cc' package, (4) GsdToolsNotFoundError
- Rich domain types — bridge parses JSON output through Zod schemas into typed domain objects (RoadmapAnalysis, Phase, PhaseDefinition, etc.), not raw JSON passthrough

### Project structure
- Module-per-component layout under src/: `plugin/`, `bridge/`, `signals/`, `shared/`
- Co-located tests — test files sit next to source (e.g., `src/bridge/commands.test.ts`)
- ESM throughout — `"type": "module"` in package.json, `"module": "nodenext"` in tsconfig
- Package name: `@open-gsd/clip`

### Plugin shell and delivery
- Full JSON-RPC protocol over stdio — initialize returns manifest, health returns ok, onEvent stubs (logs, no-op), other methods return 'not implemented'
- Test harness simulating Paperclip — spawns plugin as child process, sends JSON-RPC requests via stdin, asserts responses on stdout. No real Paperclip instance needed.
- Bridge integration tests call real gsd-tools.cjs against test fixture projects with known ROADMAP.md/STATE.md files

### Claude's Discretion
- Linting/formatting tool choice (Biome, ESLint, or other)
- Spec referencing strategy — whether to reference PLUGIN_SPEC.md from Paperclip repo directly or rely on research file content
- Exact tsconfig settings beyond module/target
- Test fixture content and structure
- pino configuration details (log level, stderr vs file descriptor)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Paperclip plugin protocol
- `.planning/research/ARCHITECTURE.md` — Component boundaries, signal protocol format, data flow, JSON-RPC methods, pipeline FSM design
- `.planning/research/STACK.md` — Technology versions, package.json skeleton, dependency rationale, plugin SDK status (not published — must implement manually)

### Project context
- `.planning/PROJECT.md` — Core value, constraints, key decisions, integration path
- `.planning/REQUIREMENTS.md` — PIPE-01 (plugin registration), PIPE-04 (gsd-tools bridge), PIPE-05 (signal parser) — the three requirements this phase covers
- `.planning/ROADMAP.md` — Phase 1 success criteria (4 criteria that must be TRUE)

### Research
- `.planning/research/PITFALLS.md` — Known risks and mitigations
- `.planning/research/FEATURES.md` — Feature breakdown and capability mapping

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None — greenfield project with no existing source code

### Established Patterns
- None — Phase 1 establishes all patterns. Decisions here become the conventions for all subsequent phases.

### Integration Points
- gsd-tools.cjs CLI at `~/.claude/get-shit-done/bin/gsd-tools.cjs` — the bridge's runtime dependency
- Paperclip host process — communicates with plugin via JSON-RPC over stdio
- @paperclipai/shared types — peer dependency for Paperclip type definitions

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches within the decisions captured above.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 01-foundation-and-protocol*
*Context gathered: 2026-03-18*
