# Technology Stack

**Project:** GSD Orchestrator (open-gsd-clip)
**Researched:** 2026-03-18

## Recommended Stack

### Runtime & Language

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Node.js | 22 LTS | Runtime | Paperclip runs on Node.js 22+. LTS until April 2027. Native test runner, `module.enableCompileCache()` for faster TypeScript compilation. | HIGH |
| TypeScript | 5.8.x | Language | Paperclip's monorepo uses TypeScript throughout. TS 5.8 has full Node.js 22 compatibility (`--module nodenext`), `require(esm)` support, and import attributes. Do NOT use TS 6.0 RC (too new, ecosystem hasn't caught up). Do NOT use TS 7.0 preview (Go-based rewrite, experimental). | HIGH |

### Paperclip Platform (Dictated by Architecture)

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| `@paperclipai/shared` | 0.3.x | Types, Zod schemas, constants | Foundation type library. All Paperclip types (Agent, Issue, HeartbeatRun, etc.), role/status enums, and config schemas live here. Peer dependency -- use whatever version the target Paperclip install ships. | HIGH |
| `@paperclipai/adapter-utils` | 0.3.x | Adapter interface contracts | Exports `ServerAdapter`, `AdapterExecutionContext`, `AdapterExecutionResult`, session codec utilities. Required if the plugin needs to understand adapter behavior. | HIGH |
| `@paperclipai/db` | 0.3.x | Database types (Drizzle) | Only needed if plugin reads database directly. Prefer REST API calls instead -- plugins run out-of-process and should use Paperclip's HTTP API. | MEDIUM |

**Critical architecture note:** The plugin system described in PLUGIN_SPEC.md (JSON-RPC over stdio, out-of-process workers, capability-gated) is **not yet shipped as an npm SDK**. The `@paperclipai/plugin-sdk`, `@paperclipai/plugin-test-harness`, and `paperclip-create-plugin` packages referenced in the spec do not appear on npm as of March 2026. This means one of two approaches:

1. **Build as an adapter-style integration** (recommended for v1): Use Paperclip's REST API directly from within the plugin worker, consume `@paperclipai/shared` types, and implement the JSON-RPC stdio protocol manually using the spec from PLUGIN_SPEC.md.
2. **Wait for plugin SDK**: Track Discussion #258 and releases for SDK publication.

Recommendation: **Approach 1.** The plugin spec is well-documented enough to implement against. The JSON-RPC protocol is simple (initialize, health, onEvent, runJob, handleWebhook, getData, performAction, executeTool). Build a thin host-protocol layer and focus effort on the orchestration logic.

### Agent Execution (Dictated by Paperclip)

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Paperclip's `claude_local` adapter | 0.3.x | Spawns Claude Code CLI | The plugin does NOT spawn Claude Code directly. It creates Issues, assigns them to agents configured with the `claude_local` adapter, and triggers wakeups via `heartbeatService.wakeup()` or `POST /api/heartbeat/run`. Paperclip handles the actual CLI subprocess lifecycle, session persistence, and environment variable injection. | HIGH |
| Paperclip's `openclaw_gateway` adapter | 0.3.x | WebSocket connection to OpenClaw | For the chat integration agent (CEO communicating with users), Paperclip connects to OpenClaw via this adapter. The plugin configures agents with this adapter type for Discord-facing communication. | HIGH |

**This is the most important architectural decision in the stack:** The plugin orchestrates by creating and managing Paperclip primitives (issues, agents, comments, wakeups) -- NOT by spawning processes directly. Paperclip is the control plane; the plugin is the workflow brain.

### State Machine

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| XState | 5.28.x | Pipeline & phase state machines | The pipeline has clear states (idle, discussing, planning, executing, verifying, done, failed) with well-defined transitions and guards. XState v5's actor model maps directly to Paperclip's agent architecture -- each phase can be an actor, the pipeline is the parent machine. TypeScript inference with `setup()` API eliminates stringly-typed state bugs. | HIGH |

**Why XState over hand-rolled state machines:** The pipeline has complex concerns -- parallel phase execution, CEO quality gates between states, retry logic, pause/resume, error recovery. A hand-rolled switch/case will become unmaintainable. XState gives: visualizable state charts (stately.ai inspector), serializable state snapshots for persistence, built-in delayed transitions for timeouts, and spawn/invoke for child actors.

**Why NOT a simpler alternative (e.g., robot, xstate-lite):** The pipeline needs hierarchical states (phase within pipeline), parallel regions (multiple phases running simultaneously), and inter-actor communication. XState is the only mature option that handles all three.

### Schema Validation

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Zod | 4.x | Runtime validation, type inference | Paperclip already uses Zod throughout `@paperclipai/shared`. Using the same version ensures schema compatibility. Zod 4 has a 2kb gzipped core, zero dependencies, and `z.infer<>` for type extraction. Use for: signal protocol parsing, pipeline config validation, REST API response validation, gsd-tools output parsing. | HIGH |

**Why NOT Zod 3.x:** Zod 4 is the current release (4.3.6). Paperclip's shared package likely uses Zod 4 given the 0.3.x release timeline. Check the actual peer dependency version in `@paperclipai/shared` and match it exactly to avoid duplicate Zod instances.

### GSD Integration

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| `gsd-tools.cjs` (via child process) | Latest (installed with `get-shit-done-cc`) | Roadmap parsing, phase management, state tracking | The project explicitly calls for wrapping gsd-tools.cjs, not reimplementing its logic. The CLI provides: `state-load`, `state-update`, `find-phase`, `resolve-model`, `list-todos`, `verify-path-exists`, `generate-slug`, `current-timestamp`, `config-ensure-section`. Invoke via `node gsd-tools.cjs <command>` and parse stdout. | HIGH |
| `get-shit-done-cc` | Latest npm | GSD system (slash commands, workflows, agents) | Must be installed in the target project's Claude Code environment. The plugin doesn't install GSD -- it expects it to be available. Agents spawned by Paperclip will use GSD commands (`/gsd:new-project --auto`, `/gsd:discuss-phase N`, etc.) via their bootstrap prompts. | HIGH |

### Process Management

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| `execa` | 9.6.x | Invoking gsd-tools.cjs CLI | Promise-based, TypeScript-typed, automatic zombie process cleanup, cross-platform. Used ONLY for gsd-tools.cjs calls from within the plugin -- NOT for spawning Claude Code (Paperclip handles that). The plugin calls `execa('node', ['gsd-tools.cjs', 'state-load'])` to parse roadmaps, check phase state, etc. | HIGH |

**Why NOT `node:child_process` directly:** execa provides: promise API (no callback wrangling), automatic process cleanup (no zombies), typed stderr/stdout, better error messages with command context, and Windows compatibility. For a CLI wrapper that gets called hundreds of times per pipeline run, the ergonomic advantage is substantial.

**Why NOT import gsd-tools.cjs directly:** gsd-tools.cjs is a standalone CLI script, not a library. It reads process.argv, writes to stdout, and calls process.exit(). Importing it would require refactoring GSD internals. Wrapping via child process is the correct boundary.

### Logging

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| `pino` | 9.x | Structured JSON logging | Paperclip streams agent logs via `heartbeat.run.log` events. The plugin needs structured, machine-parseable logs that Paperclip's log viewer can display. Pino outputs JSON by default, is 5x faster than Winston, and has zero-config structured logging. Use `pino-pretty` in development only. | MEDIUM |

**Why NOT Winston:** Winston is more configurable but slower, and the plugin doesn't need multiple transports or log rotation -- Paperclip handles log aggregation. Pino's speed matters because the plugin will log extensively during multi-phase orchestration.

**Why NOT console.log:** The plugin runs as a worker process communicating via JSON-RPC over stdio. Raw console.log would corrupt the protocol stream. Pino can be configured to write to stderr or a file descriptor, keeping stdout clean for JSON-RPC.

### Testing

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| `vitest` | 4.x | Unit and integration tests | TypeScript-native (no ts-jest config), fast (esbuild-powered), Jest-compatible API for easy adoption. XState machines are particularly well-suited to property-based testing with Vitest. | HIGH |

**Why NOT Node.js native test runner:** While `node:test` is production-ready in Node 22, Vitest has superior TypeScript support (no separate compilation step), better mocking utilities for testing state machines, and snapshot testing for XState machine configurations. The native runner is best for simple projects; this plugin has complex async orchestration that benefits from Vitest's features.

**Why NOT Jest:** Jest 30 exists but Vitest has won the TypeScript testing ecosystem. Faster startup, native ESM, no configuration overhead.

### WebSocket (for OpenClaw Gateway communication)

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| `ws` | 8.19.x | WebSocket client for OpenClaw Gateway | If the plugin needs to communicate with OpenClaw directly (beyond what the `openclaw_gateway` adapter provides), `ws` is the standard Node.js WebSocket library. OpenClaw Gateway listens on port 18789, uses JSON text frames, and requires a connect handshake with role/scope declaration. | LOW |

**Important caveat:** The plugin should prefer Paperclip's `openclaw_gateway` adapter for Discord communication rather than opening a direct WebSocket. Direct `ws` usage is only needed if: (a) the plugin needs to send messages to Discord outside of an agent heartbeat context, or (b) the adapter doesn't support the specific OpenClaw Gateway methods needed (e.g., `tools.invoke`). Evaluate this during Phase 1 implementation -- it may not be needed at all.

### Event Handling

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Node.js `EventEmitter` (built-in) | N/A | Internal plugin event bus | For routing Paperclip events (received via `onEvent` JSON-RPC method) to the appropriate state machine actors. No external dependency needed -- Node's built-in EventEmitter is sufficient for an in-process event bus. The plugin subscribes to Paperclip events and dispatches them to XState actors. | HIGH |

**Why NOT eventemitter3 or mitt:** The plugin is a single Node.js process with a handful of event types. The performance difference between native EventEmitter and eventemitter3 is irrelevant at this scale. Adding a dependency for <10 event types is unnecessary.

### Build & Packaging

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| `tsup` | 8.x | Bundle plugin for distribution | Bundles TypeScript to CJS/ESM with zero config. Paperclip plugins are npm packages with specific entry points (`.`, `./server`, `./ui`, `./cli`). tsup handles multiple entry points, dts generation, and tree-shaking. | MEDIUM |
| `tsx` | 4.x | Development runtime | Run TypeScript directly during development without compilation. Used for `tsx watch` during plugin development. | MEDIUM |

**Why NOT `tsc` for building:** tsc produces unbundled output. The plugin needs to ship as a bundled npm package with clean entry points. tsup wraps esbuild for fast, bundled output with declaration files.

**Why NOT `esbuild` directly:** tsup provides the right abstraction -- multiple entry points, DTS generation, package.json exports alignment -- without writing esbuild config.

## Stack NOT to Use

| Technology | Why Not | Use Instead |
|------------|---------|-------------|
| Direct `child_process.spawn` for Claude Code | Paperclip manages agent lifecycle via adapters. Spawning Claude Code yourself bypasses session management, budget tracking, heartbeat coordination, and log streaming. | Paperclip's `claude_local` adapter via issue assignment + wakeup |
| Express/Fastify for REST endpoints | The plugin doesn't run its own HTTP server. Paperclip exposes REST endpoints; the plugin registers webhook handlers and API routes through the plugin manifest. | Plugin manifest `webhooks` and `endpoints` declarations |
| Redis/BullMQ for job queuing | Overkill for v1. Paperclip's heartbeat system IS the job queue -- create issues, assign agents, trigger wakeups. The pipeline state machine handles sequencing. | XState actors + Paperclip heartbeat wakeups |
| Prisma ORM | Paperclip uses Drizzle. The plugin shouldn't access the database directly anyway -- use Paperclip's REST API. | `@paperclipai/shared` types + HTTP API calls |
| LangChain/LangGraph | The plugin doesn't call LLMs directly. It orchestrates Claude Code CLI instances via Paperclip, which handle their own LLM interactions. Adding an LLM framework adds complexity with zero benefit. | Paperclip agent orchestration + GSD prompt engineering |
| Socket.IO | OpenClaw uses raw WebSocket (via `ws`), not Socket.IO. Paperclip's live events use raw WebSocket. Socket.IO adds protocol overhead and isn't compatible with either. | `ws` if direct WebSocket needed |
| Zod 3.x | Outdated. Zod 4 is current. Match Paperclip's version to avoid duplicate instances. | Zod 4.x |
| TypeScript 6.0 RC / 7.0 preview | TS 6.0 is RC (not stable). TS 7.0 is a Go-based rewrite in preview. Neither is production-ready. Paperclip uses 5.x. | TypeScript 5.8.x |

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| State machine | XState 5.28 | Hand-rolled switch/case | Pipeline has hierarchical states, parallel regions, inter-actor communication. Manual implementation becomes unmaintainable at this complexity. |
| State machine | XState 5.28 | Robot (thisrobot.life) | No parallel states, no actor model, no inspector. Too simple for this use case. |
| CLI wrapper | execa 9.6 | node:child_process | Missing promise API, zombie cleanup, typed errors. execa is the standard for programmatic CLI usage. |
| Logging | pino 9.x | Winston | Plugin runs as stdio worker -- needs fast structured JSON logging, not multi-transport configurability. |
| Testing | vitest 4.x | node:test | Complex async state machine testing needs Vitest's mocking/snapshot capabilities. |
| Testing | vitest 4.x | Jest 30 | Vitest is faster, TypeScript-native, lighter configuration. |
| Build | tsup 8.x | tsc | Need bundled output with multiple entry points, not raw transpilation. |
| Validation | Zod 4.x | io-ts / Yup / Valibot | Paperclip already uses Zod. Using anything else creates a type boundary mismatch. |

## Package.json Skeleton

```json
{
  "name": "@open-gsd/clip",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": "./dist/index.js",
    "./server": "./dist/server/index.js",
    "./ui": "./dist/ui/index.js"
  },
  "scripts": {
    "build": "tsup",
    "dev": "tsx watch src/server/index.ts",
    "test": "vitest",
    "test:run": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

## Installation

```bash
# Core runtime dependencies
npm install xstate zod execa pino

# Paperclip SDK (peer dependencies -- match target Paperclip version)
npm install @paperclipai/shared@0.3.x @paperclipai/adapter-utils@0.3.x

# WebSocket (only if direct OpenClaw Gateway communication needed)
npm install ws
npm install -D @types/ws

# Dev dependencies
npm install -D typescript@5.8 tsup tsx vitest pino-pretty @types/node
```

## Dependency Summary

| Category | Package | Why Critical |
|----------|---------|-------------|
| **Must have** | `xstate` | Pipeline state machine -- the core orchestration brain |
| **Must have** | `zod` | Schema validation, type safety for signals and API responses |
| **Must have** | `execa` | gsd-tools.cjs CLI wrapper |
| **Must have** | `pino` | Structured logging that won't corrupt stdio protocol |
| **Must have** | `@paperclipai/shared` | Paperclip type definitions and constants |
| **Should have** | `@paperclipai/adapter-utils` | Adapter interface understanding (may not need at runtime) |
| **Evaluate later** | `ws` | Direct OpenClaw Gateway connection (may not be needed) |

## Open Questions

1. **Plugin SDK availability:** The `@paperclipai/plugin-sdk` package is not yet published. Monitor Discussion #258 and releases. If it ships before implementation begins, it may provide a higher-level abstraction over the JSON-RPC protocol.

2. **Zod version alignment:** Verify the exact Zod version in `@paperclipai/shared@0.3.x` peer dependencies. If Paperclip pins Zod 3.x, the plugin must match (despite Zod 4 being current) to avoid runtime schema incompatibility.

3. **Direct OpenClaw need:** Can all Discord communication flow through Paperclip's `openclaw_gateway` adapter (via agent heartbeats), or does the plugin need a direct WebSocket to OpenClaw for real-time notifications outside of heartbeat cycles? This determines whether `ws` is a runtime dependency.

4. **Plugin isolation model:** PLUGIN_SPEC.md describes out-of-process workers with JSON-RPC over stdio. If Paperclip hasn't implemented this yet (v1 uses ES module loading), the plugin may need to be structured as an in-process module initially and migrated later.

## Sources

- [Paperclip GitHub Repository](https://github.com/paperclipai/paperclip)
- [Paperclip DeepWiki - Monorepo Structure](https://deepwiki.com/paperclipai/paperclip/1.2-monorepo-structure)
- [Paperclip DeepWiki - Architecture Overview](https://deepwiki.com/paperclipai/paperclip)
- [Paperclip Plugin System Discussion #258](https://github.com/paperclipai/paperclip/discussions/258)
- [Paperclip v0.3.1 Release](https://github.com/paperclipai/paperclip/releases/tag/v0.3.1)
- [Paperclip Heartbeat Explained](https://paperclipai.info/blogs/explain_heartbeat/)
- [OpenClaw Gateway Protocol](https://docs.openclaw.ai/gateway/protocol)
- [OpenClaw GitHub](https://github.com/openclaw/openclaw)
- [GSD GitHub Repository](https://github.com/gsd-build/get-shit-done)
- [GSD DeepWiki](https://deepwiki.com/gsd-build/get-shit-done)
- [XState npm](https://www.npmjs.com/package/xstate) - v5.28.0
- [Zod npm](https://www.npmjs.com/package/zod) - v4.3.6
- [execa npm](https://www.npmjs.com/package/execa) - v9.6.1
- [Vitest npm](https://www.npmjs.com/package/vitest) - v4.1.0
- [TypeScript 5.8 Announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-5-8/)
- [ws npm](https://www.npmjs.com/package/ws) - v8.19.0
