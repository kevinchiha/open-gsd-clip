# Phase 1: Foundation and Protocol - Research

**Researched:** 2026-03-18
**Domain:** Paperclip plugin scaffolding, GSD CLI bridge, YAML signal protocol, TypeScript/ESM project setup
**Confidence:** HIGH

## Summary

Phase 1 is a greenfield scaffolding phase that establishes three independent components (plugin shell, GSD bridge, signal parser) plus the project's build/test/lint toolchain. All three components are pure logic with well-defined boundaries -- the plugin shell implements JSON-RPC over stdio, the bridge wraps gsd-tools.cjs via child process, and the signal parser extracts YAML-delimited signal blocks from text.

The most critical technical finding is that `@paperclipai/shared@0.3.1` depends on `zod@^3.24.2` (Zod 3, not Zod 4). Since the CONTEXT.md specifies "Zod 4," the recommended approach is to install `zod@^3.25.0` which makes both `zod/v3` and `zod/v4` import paths available. The plugin's own schemas should use `import { z } from "zod"` (Zod 3 API) for compatibility with `@paperclipai/shared` schemas. If Zod 4 features are desired for the plugin's internal schemas only, they can be imported from `"zod/v4"` -- but this adds complexity for no clear Phase 1 benefit. The safer path is Zod 3 throughout.

The Paperclip plugin SDK (`@paperclipai/plugin-sdk`) is not published to npm. Phase 1 must implement the JSON-RPC 2.0 stdio protocol manually against the PLUGIN_SPEC.md specification. The protocol is simple (8 methods), and a hand-rolled implementation with a line-delimited JSON framing layer over stdin/stdout is appropriate -- no external JSON-RPC library needed.

**Primary recommendation:** Use Zod 3 (not 4) for `@paperclipai/shared` compatibility. Implement JSON-RPC stdio manually. Use `js-yaml` for signal YAML parsing. Use Biome for linting/formatting (Claude's discretion area). Keep all three components as pure, independently testable modules.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Signal protocol format: YAML frontmatter delimited by `---` markers, with `GSD_SIGNAL:<TYPE>` as the first line inside the block
- Strict Zod schema per signal type -- every signal type has a defined schema with required/optional fields, unknown fields are stripped, missing required fields produce parse errors that are logged
- All 12 signal types defined in Phase 1: PROJECT_READY, DISCUSS_COMPLETE, APPROVED, REVISION_NEEDED, PLAN_COMPLETE, EXECUTE_COMPLETE, VERIFY_COMPLETE, VERIFY_FAILED, DECISION_NEEDED, DECISION_MADE, AGENT_ERROR, STALE_HEARTBEAT
- Parser extracts signal blocks from surrounding text -- agents can write natural language before/after the YAML block, parser scans for `---` delimited blocks containing `GSD_SIGNAL`
- Phase 1 bridge wraps only: `analyzeRoadmap()`, `getPhase()`, `getState()`, `findPhase()` -- remaining commands added in later phases
- Typed errors, fail fast -- bridge wraps execa errors into typed error classes (GsdBridgeError, GsdToolsNotFoundError, GsdParseError, GsdTimeoutError). No retry at bridge level
- Auto-discover gsd-tools.cjs path: (1) GSD_TOOLS_PATH env var, (2) ~/.claude/get-shit-done/bin/gsd-tools.cjs, (3) resolve from 'get-shit-done-cc' package, (4) GsdToolsNotFoundError
- Rich domain types -- bridge parses JSON output through Zod schemas into typed domain objects
- Module-per-component layout under src/: `plugin/`, `bridge/`, `signals/`, `shared/`
- Co-located tests -- test files sit next to source
- ESM throughout -- `"type": "module"` in package.json, `"module": "nodenext"` in tsconfig
- Package name: `@open-gsd/clip`
- Full JSON-RPC protocol over stdio -- initialize returns manifest, health returns ok, onEvent stubs (logs, no-op), other methods return 'not implemented'
- Test harness simulating Paperclip -- spawns plugin as child process, sends JSON-RPC requests via stdin, asserts responses on stdout
- Bridge integration tests call real gsd-tools.cjs against test fixture projects with known ROADMAP.md/STATE.md files

### Claude's Discretion
- Linting/formatting tool choice (Biome, ESLint, or other)
- Spec referencing strategy -- whether to reference PLUGIN_SPEC.md from Paperclip repo directly or rely on research file content
- Exact tsconfig settings beyond module/target
- Test fixture content and structure
- pino configuration details (log level, stderr vs file descriptor)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PIPE-01 | Plugin registers with Paperclip via definePlugin() and responds to health checks | JSON-RPC 2.0 protocol spec fully documented; plugin manifest interface from PLUGIN_SPEC.md; 8 RPC methods defined with exact signatures |
| PIPE-04 | gsd-tools.cjs bridge parses roadmap phases, dependencies, status, and plan indices via typed wrapper | gsd-tools.cjs CLI interface fully documented; `roadmap analyze`, `roadmap get-phase`, `state json`, `find-phase` output structures verified against live tool; execa 9.6.x API confirmed |
| PIPE-05 | Signal parser extracts GSD_SIGNAL structured data from Paperclip issue comments | YAML frontmatter format locked in CONTEXT.md; js-yaml 4.x verified for parsing; Zod 3.x schemas for validation; all 12 signal types enumerated |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | 5.8.x | Language | Paperclip monorepo uses TS 5.7.3; 5.8.x is latest stable with full nodenext support. Do NOT use 6.0 RC or 7.0 preview |
| Node.js | 22 LTS | Runtime | Paperclip requires Node.js 22+. LTS until April 2027 |
| Zod | 3.25.x | Schema validation | `@paperclipai/shared@0.3.1` depends on `zod@^3.24.2`. Must stay on Zod 3 for type compatibility. Use `^3.25.0` minimum to enable `zod/v4` subpath if ever needed |
| execa | 9.6.x | Process execution | Promise-based, typed, auto-cleanup. Only used for gsd-tools.cjs calls |
| pino | 9.x | Structured logging | JSON output to stderr (keeps stdout clean for JSON-RPC). Fast, zero-config structured logging |
| js-yaml | 4.x | YAML parsing | Signal YAML block parsing. Fastest option, well-typed via `@types/js-yaml`. The `yaml` package (eemeli) requires TS 5.9+ minimum which exceeds our target |
| vitest | 4.x | Testing | TypeScript-native, ESM-first, fast. Jest-compatible API |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@paperclipai/shared` | 0.3.x | Paperclip types, Zod schemas, constants | Import for type definitions (Agent, Issue, PluginRecord, etc.) and shared enums |
| tsup | 8.x | Build/bundle | Bundle TypeScript to ESM for distribution. Handles multiple entry points, DTS generation |
| tsx | 4.x | Dev runtime | Run TypeScript directly during development without compilation |
| Biome | 2.x | Lint + format | Single tool for both linting and formatting. 10-56x faster than ESLint. See "Claude's Discretion" section |
| pino-pretty | (dev only) | Dev log formatting | Human-readable log output during development. Never in production |
| `@types/js-yaml` | latest | TypeScript types | Type definitions for js-yaml |
| `@types/node` | 22.x | Node.js types | Type definitions matching Node.js 22 LTS |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Zod 3.25.x | Zod 4 (`zod/v4` import) | Zod 4 has better perf but `@paperclipai/shared` exports Zod 3 types. Using Zod 4 internally creates a type boundary mismatch at the shared schema layer |
| js-yaml 4.x | `yaml` (eemeli) | `yaml` preserves comments/structure but requires TS 5.9+ and is dramatically slower on complex YAML. Signal blocks are simple key-value -- js-yaml is the right choice |
| Biome 2.x | ESLint 10 + Prettier | ESLint has 20% more rule coverage but is 10-56x slower. For a new project with no legacy config, Biome is the path of least resistance |
| Hand-rolled JSON-RPC | `json-rpc-2.0` npm package | The package adds a dependency for a protocol with 5 simple message types. Hand-rolling a ~100-line implementation is clearer and avoids dependency creep |
| execa 9.x | `node:child_process` | native child_process lacks promise API, typed errors, and auto zombie cleanup. execa is worth the dependency for a CLI wrapper that will be called frequently |

**Installation:**
```bash
# Runtime dependencies
npm install zod@"^3.25.0" execa pino js-yaml @paperclipai/shared@0.3.x

# Dev dependencies
npm install -D typescript@5.8 tsup tsx vitest pino-pretty @biomejs/biome @types/js-yaml @types/node
```

## Architecture Patterns

### Recommended Project Structure
```
src/
  plugin/
    index.ts              # definePlugin() entry point, manifest
    rpc-handler.ts        # JSON-RPC message router
    rpc-handler.test.ts   # Unit tests for RPC routing
    rpc-transport.ts      # stdin/stdout line-delimited JSON framing
    rpc-transport.test.ts # Transport framing tests
    types.ts              # Plugin-specific types (manifest, RPC messages)
  bridge/
    index.ts              # Public API: analyzeRoadmap, getPhase, getState, findPhase
    executor.ts           # Low-level gsd-tools.cjs invocation via execa
    executor.test.ts      # Executor unit tests (mocked execa)
    discovery.ts          # gsd-tools.cjs path auto-discovery
    discovery.test.ts     # Discovery logic tests
    schemas.ts            # Zod schemas for gsd-tools JSON output
    types.ts              # Domain types (RoadmapAnalysis, PhaseDefinition, etc.)
    errors.ts             # GsdBridgeError, GsdToolsNotFoundError, GsdParseError, GsdTimeoutError
    commands.test.ts      # Integration tests (real gsd-tools.cjs against fixtures)
  signals/
    index.ts              # Public API: parseSignal, formatSignal
    parser.ts             # YAML block extraction from surrounding text
    parser.test.ts        # Parser unit tests (various comment formats)
    schemas.ts            # Zod schemas for all 12 signal types
    schemas.test.ts       # Schema validation tests
    types.ts              # Signal type definitions, discriminated union
  shared/
    logger.ts             # pino instance configured for stderr
    errors.ts             # Base error classes
    types.ts              # Shared utility types
```

### Pattern 1: Line-Delimited JSON-RPC over stdio
**What:** The plugin reads newline-delimited JSON from stdin, parses each line as a JSON-RPC 2.0 request, dispatches to handlers, and writes JSON-RPC responses to stdout (one per line).
**When to use:** Always -- this is the Paperclip plugin host protocol.
**Example:**
```typescript
// src/plugin/rpc-transport.ts
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';

export function createTransport(input: Readable, output: Writable) {
  const rl = createInterface({ input, crlfDelay: Infinity });

  return {
    onMessage(handler: (msg: unknown) => Promise<unknown>) {
      rl.on('line', async (line) => {
        if (!line.trim()) return;
        try {
          const request = JSON.parse(line);
          const response = await handler(request);
          if (response !== undefined) {
            output.write(JSON.stringify(response) + '\n');
          }
        } catch {
          // Parse error per JSON-RPC spec
          output.write(JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32700, message: 'Parse error' },
            id: null,
          }) + '\n');
        }
      });
    },
    close() {
      rl.close();
    },
  };
}
```

### Pattern 2: Typed Bridge with Zod Validation
**What:** Each gsd-tools.cjs command gets a typed wrapper that invokes execa, parses JSON stdout, validates through a Zod schema, and returns a typed domain object. Errors are classified.
**When to use:** All GSD Bridge commands.
**Example:**
```typescript
// src/bridge/executor.ts
import { execa } from 'execa';
import { GsdBridgeError, GsdParseError, GsdTimeoutError, GsdToolsNotFoundError } from './errors.js';

export async function executeGsdCommand(
  toolsPath: string,
  command: string,
  args: string[],
  cwd: string,
  timeoutMs = 30_000,
): Promise<unknown> {
  try {
    const result = await execa('node', [toolsPath, command, ...args], {
      cwd,
      timeout: timeoutMs,
      reject: true,
    });
    return JSON.parse(result.stdout);
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'timedOut' in error && error.timedOut) {
      throw new GsdTimeoutError(command, timeoutMs);
    }
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      throw new GsdToolsNotFoundError(toolsPath);
    }
    throw new GsdBridgeError(command, error);
  }
}
```

### Pattern 3: Signal Extraction from Surrounding Text
**What:** The parser scans a text string for `---` delimited blocks, checks if the first line matches `GSD_SIGNAL:<TYPE>`, parses the YAML content, and validates against the type-specific Zod schema.
**When to use:** Every time a Paperclip issue comment is received via onEvent.
**Example:**
```typescript
// src/signals/parser.ts
import yaml from 'js-yaml';
import type { GsdSignal } from './types.js';
import { signalSchemas } from './schemas.js';

const SIGNAL_BLOCK_RE = /^---\n(GSD_SIGNAL:(\w+)\n[\s\S]*?)---$/m;

export function parseSignal(text: string): GsdSignal | null {
  const match = SIGNAL_BLOCK_RE.exec(text);
  if (!match) return null;

  const [, block, signalType] = match;
  if (!signalType || !(signalType in signalSchemas)) return null;

  const parsed = yaml.load(block) as Record<string, unknown>;
  // Remove the GSD_SIGNAL line -- it's metadata, not a YAML key
  delete parsed[`GSD_SIGNAL:${signalType}`];

  const schema = signalSchemas[signalType as keyof typeof signalSchemas];
  const result = schema.safeParse({ type: signalType, ...parsed });

  if (!result.success) {
    // Log validation errors but return null (caller handles missing signals)
    return null;
  }

  return result.data;
}
```

### Pattern 4: Typed Error Hierarchy
**What:** Bridge errors extend a base `GsdBridgeError` class. Each error type carries context for classification by upstream consumers. Errors are thrown, never returned as values.
**When to use:** All bridge error paths.
**Example:**
```typescript
// src/bridge/errors.ts
export class GsdBridgeError extends Error {
  constructor(
    public readonly command: string,
    public readonly cause?: unknown,
  ) {
    super(`GSD bridge command '${command}' failed`);
    this.name = 'GsdBridgeError';
  }
}

export class GsdToolsNotFoundError extends GsdBridgeError {
  constructor(public readonly searchPath: string) {
    super('tool-discovery', undefined);
    this.name = 'GsdToolsNotFoundError';
    this.message = `gsd-tools.cjs not found at: ${searchPath}`;
  }
}

export class GsdParseError extends GsdBridgeError {
  constructor(command: string, public readonly rawOutput: string) {
    super(command, undefined);
    this.name = 'GsdParseError';
    this.message = `Failed to parse output of '${command}'`;
  }
}

export class GsdTimeoutError extends GsdBridgeError {
  constructor(command: string, public readonly timeoutMs: number) {
    super(command, undefined);
    this.name = 'GsdTimeoutError';
    this.message = `Command '${command}' timed out after ${timeoutMs}ms`;
  }
}
```

### Anti-Patterns to Avoid
- **Importing gsd-tools.cjs directly:** It is a CLI script that reads process.argv and calls process.exit(). Must invoke via child process.
- **Writing to stdout from non-RPC code:** The plugin communicates via JSON-RPC over stdout. Any stray `console.log` corrupts the protocol. All logging goes to stderr via pino.
- **Parsing YAML with regex instead of a proper parser:** Signal blocks may contain multi-line strings, arrays, special characters. Use js-yaml.
- **Coupling signal schemas to bridge types:** Signals and bridge are independent modules. Do not import bridge types in the signals module or vice versa.
- **Using `console.error` instead of pino:** Pino provides structured JSON output with timestamps, levels, and context. Raw console.error produces unstructured text.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| YAML parsing | Custom YAML parser or regex extraction of YAML values | js-yaml 4.x | YAML has edge cases (multi-line strings, anchors, special chars) that regex cannot handle correctly |
| Schema validation | Custom validation functions with manual type guards | Zod 3.x schemas with `z.infer<>` | Zod provides type inference, clear error messages, `.strip()` for unknown fields, and `.safeParse()` for non-throwing validation |
| Child process management | Raw `child_process.execFile` with manual promise wrapping | execa 9.x | execa provides automatic zombie cleanup, typed errors with `timedOut`/`isCanceled`, AbortSignal support, and cross-platform behavior |
| Structured logging | Console wrappers or custom log formatting | pino 9.x | pino outputs JSON by default, writes to stderr, and is 5x faster than Winston. Critical for JSON-RPC plugins where stdout is the protocol stream |
| Roadmap/state parsing | Custom ROADMAP.md or STATE.md parsers | gsd-tools.cjs CLI commands | GSD already has robust, tested parsing. The bridge wraps it -- never reimplement |

**Key insight:** Phase 1 has exactly zero novel algorithmic challenges. Every component is a typed wrapper around existing tooling (JSON-RPC spec, gsd-tools.cjs, YAML parser). The value is in clean types, proper error handling, and correct boundaries -- not in clever solutions.

## Common Pitfalls

### Pitfall 1: stdout Corruption from Logging
**What goes wrong:** Any `console.log` statement in plugin code writes to stdout, injecting non-JSON-RPC text into the host protocol stream. The host receives malformed JSON and disconnects the plugin.
**Why it happens:** Default Node.js logging goes to stdout. Developers forget the plugin is a stdio worker.
**How to avoid:** Configure pino to write to stderr (`destination: 2`). Never use `console.log` anywhere in the codebase. Add a lint rule (or Biome rule) to ban `console.log/console.info/console.warn`.
**Warning signs:** Plugin crashes after first log statement. Host reports JSON parse errors.

### Pitfall 2: Zod Version Mismatch with @paperclipai/shared
**What goes wrong:** Installing Zod 4 (`zod@^4.0.0`) alongside `@paperclipai/shared@0.3.x` (which depends on `zod@^3.24.2`) creates two Zod instances in node_modules. Schemas from shared are `ZodType` from Zod 3 and are not assignable to Zod 4's `ZodType`. Type checking passes but runtime `instanceof` checks fail.
**Why it happens:** npm may hoist different versions, creating subtle incompatibilities.
**How to avoid:** Use `zod@^3.25.0` which satisfies shared's peer dependency. If you need Zod 4 features, import from `"zod/v4"` subpath (available in 3.25.0+), but keep shared-facing code on the default `"zod"` import.
**Warning signs:** Runtime errors like "expected ZodType, got ZodObject" or "z.instanceof is not a function."

### Pitfall 3: gsd-tools.cjs Path Varies by Environment
**What goes wrong:** The bridge hardcodes `~/.claude/get-shit-done/bin/gsd-tools.cjs` but in CI, containers, or different user setups, GSD is installed elsewhere. Bridge fails with ENOENT.
**Why it happens:** GSD installation path depends on how `get-shit-done-cc` was installed (global npm, local npm, or manual).
**How to avoid:** Implement the 3-step discovery chain from CONTEXT.md: (1) `GSD_TOOLS_PATH` env var, (2) `~/.claude/get-shit-done/bin/gsd-tools.cjs`, (3) resolve from `get-shit-done-cc` package via `require.resolve` or `import.meta.resolve`. Throw `GsdToolsNotFoundError` with all searched paths listed.
**Warning signs:** Bridge works on developer machine, fails in CI or on collaborator machines.

### Pitfall 4: Signal Block Regex Too Greedy
**What goes wrong:** The regex for extracting `---` delimited blocks matches from the first `---` to the last `---` in the entire comment, gobbling up multiple signal blocks or non-signal YAML frontmatter.
**Why it happens:** Using `.*` or `[\s\S]*` greedily between delimiters.
**How to avoid:** Use a non-greedy match (`[\s\S]*?`) between `---` markers and anchor to line boundaries. Also verify the first line inside the block starts with `GSD_SIGNAL:` before attempting YAML parse.
**Warning signs:** Parser returns wrong signal type or corrupted data when comments contain multiple `---` sections.

### Pitfall 5: ESM Import Path Extensions
**What goes wrong:** TypeScript with `"module": "nodenext"` requires explicit `.js` extensions on relative imports (`import { foo } from './bar.js'`). Omitting extensions causes runtime errors in Node.js ESM mode even though TypeScript compiles without error.
**Why it happens:** `nodenext` module resolution enforces Node.js's actual ESM resolution algorithm, which requires extensions.
**How to avoid:** Always use `.js` extensions on relative imports. Configure Biome or ESLint to enforce this. tsup handles this during bundling, but source code must be correct for vitest and tsx to work.
**Warning signs:** `ERR_MODULE_NOT_FOUND` at runtime despite clean tsc compilation.

### Pitfall 6: Execa in ESM Requires Dynamic Import or Latest Version
**What goes wrong:** execa 9.x is ESM-only. Importing it in a CJS context fails. Older execa versions (< 8) were CJS.
**Why it happens:** Project is ESM (`"type": "module"`) so this should not be an issue, but if tsconfig or test runner misconfigures module resolution, imports fail.
**How to avoid:** Ensure `"type": "module"` in package.json and `"module": "nodenext"` in tsconfig. Vitest handles ESM natively. All good as long as the project is consistently ESM.
**Warning signs:** `require() of ES Module` errors or `ERR_REQUIRE_ESM`.

## Code Examples

### JSON-RPC 2.0 Message Types (Zod 3)
```typescript
// src/plugin/types.ts
import { z } from 'zod';

export const JsonRpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  method: z.string(),
  params: z.unknown().optional(),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
});
export type JsonRpcRequest = z.infer<typeof JsonRpcRequestSchema>;

export const JsonRpcSuccessSchema = z.object({
  jsonrpc: z.literal('2.0'),
  result: z.unknown(),
  id: z.union([z.string(), z.number(), z.null()]),
});

export const JsonRpcErrorSchema = z.object({
  jsonrpc: z.literal('2.0'),
  error: z.object({
    code: z.number(),
    message: z.string(),
    data: z.unknown().optional(),
  }),
  id: z.union([z.string(), z.number(), z.null()]),
});

// Standard JSON-RPC error codes
export const RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;
```

### Plugin Manifest
```typescript
// src/plugin/index.ts
import type { PaperclipPluginManifestV1 } from './types.js';

export const manifest: PaperclipPluginManifestV1 = {
  id: '@open-gsd/clip',
  apiVersion: 1,
  version: '0.1.0',
  displayName: 'GSD Orchestrator',
  description: 'Automates the full GSD development pipeline via agent orchestration',
  categories: ['automation'],
  capabilities: [
    'data.read',
    'data.write',
    'plugin.state',
    'events.subscribe',
    'agent.tools.register',
  ],
  entrypoints: {
    worker: './dist/plugin/worker.js',
  },
};
```

### Bridge Domain Types
```typescript
// src/bridge/types.ts
export interface RoadmapPhase {
  number: string;
  name: string;
  goal: string | null;
  dependsOn: string | null;
  planCount: number;
  summaryCount: number;
  hasContext: boolean;
  hasResearch: boolean;
  diskStatus: 'no_directory' | 'empty' | 'discussed' | 'researched' | 'planned' | 'executing' | 'complete';
  roadmapComplete: boolean;
}

export interface RoadmapAnalysis {
  milestones: unknown[];
  phases: RoadmapPhase[];
  phaseCount: number;
  completedPhases: number;
  totalPlans: number;
  totalSummaries: number;
  progressPercent: number;
  currentPhase: string | null;
  nextPhase: string | null;
  missingPhaseDetails: string[];
}

export interface PhaseDefinition {
  found: boolean;
  phaseNumber: string;
  phaseName: string;
  goal: string | null;
  successCriteria: string[];
  section: string;
}

export interface ProjectState {
  gsdStateVersion: string;
  milestone: string;
  milestoneName: string;
  status: string;
  stoppedAt: string;
  lastUpdated: string;
  lastActivity: string;
  progress: {
    totalPhases: string;
    completedPhases: string;
    totalPlans: string;
    completedPlans: string;
    percent: string;
  };
}

export interface PhasePath {
  found: boolean;
  directory: string;
  phaseNumber: string;
  phaseName: string;
  plans: string[];
  summaries: string[];
}
```

### Signal Type Definitions
```typescript
// src/signals/types.ts
export const SIGNAL_TYPES = [
  'PROJECT_READY',
  'DISCUSS_COMPLETE',
  'APPROVED',
  'REVISION_NEEDED',
  'PLAN_COMPLETE',
  'EXECUTE_COMPLETE',
  'VERIFY_COMPLETE',
  'VERIFY_FAILED',
  'DECISION_NEEDED',
  'DECISION_MADE',
  'AGENT_ERROR',
  'STALE_HEARTBEAT',
] as const;

export type SignalType = typeof SIGNAL_TYPES[number];

export interface BaseSignal {
  type: SignalType;
  phase?: number;
  status?: 'success' | 'failure' | 'blocked';
  summary?: string;
}

// Full discriminated union type inferred from Zod schemas
export type GsdSignal = z.infer<typeof gsdSignalSchema>;
```

### Pino Logger Configuration
```typescript
// src/shared/logger.ts
import pino from 'pino';

// Write to stderr (fd 2) to keep stdout clean for JSON-RPC
export const logger = pino({
  name: '@open-gsd/clip',
  level: process.env.LOG_LEVEL ?? 'info',
  // Use fd 2 (stderr) -- CRITICAL for stdio plugin
  transport: process.env.NODE_ENV === 'development'
    ? { target: 'pino-pretty', options: { destination: 2 } }
    : undefined,
  // In production, pino writes JSON to stderr by default when
  // destination is not specified -- but we must be explicit
}, process.env.NODE_ENV !== 'development' ? pino.destination(2) : undefined);
```

### gsd-tools.cjs Output Schemas (verified against live tool)
```typescript
// src/bridge/schemas.ts
import { z } from 'zod';

export const RoadmapPhaseSchema = z.object({
  number: z.string(),
  name: z.string(),
  goal: z.string().nullable(),
  depends_on: z.string().nullable(),
  plan_count: z.number(),
  summary_count: z.number(),
  has_context: z.boolean(),
  has_research: z.boolean(),
  disk_status: z.string(),
  roadmap_complete: z.boolean(),
});

export const RoadmapAnalysisSchema = z.object({
  milestones: z.array(z.unknown()),
  phases: z.array(RoadmapPhaseSchema),
  phase_count: z.number(),
  completed_phases: z.number(),
  total_plans: z.number(),
  total_summaries: z.number(),
  progress_percent: z.number(),
  current_phase: z.string().nullable(),
  next_phase: z.string().nullable(),
  missing_phase_details: z.array(z.string()),
});

export const PhaseDefinitionSchema = z.object({
  found: z.boolean(),
  phase_number: z.string(),
  phase_name: z.string(),
  goal: z.string().nullable(),
  success_criteria: z.array(z.string()),
  section: z.string(),
});

export const StateJsonSchema = z.object({
  gsd_state_version: z.string(),
  milestone: z.string(),
  milestone_name: z.string(),
  status: z.string(),
  stopped_at: z.string(),
  last_updated: z.string(),
  last_activity: z.string(),
  progress: z.object({
    total_phases: z.string(),
    completed_phases: z.string(),
    total_plans: z.string(),
    completed_plans: z.string(),
    percent: z.string(),
  }),
});

export const FindPhaseSchema = z.object({
  found: z.boolean(),
  directory: z.string(),
  phase_number: z.string(),
  phase_name: z.string(),
  plans: z.array(z.string()),
  summaries: z.array(z.string()),
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Zod 3 default import | Zod 3.25+ with `zod/v4` subpath for opt-in v4 | 2025 | Can use Zod 4 features selectively while maintaining Zod 3 compat with @paperclipai/shared |
| ESLint + Prettier (2 tools) | Biome 2.x (1 tool, 10-56x faster) | 2024-2025 | Simpler config, faster CI. ESLint v10 improved but Biome is still faster for new projects |
| Jest for TypeScript tests | Vitest 4.x (ESM-native, no config) | 2024-2025 | No ts-jest, no babel. Just works with ESM TypeScript |
| execa 8 (mixed CJS/ESM) | execa 9.x (ESM-only, template strings) | 2024 | ESM-only aligns with project. Template string API is ergonomic |
| @paperclipai/plugin-sdk | Manual JSON-RPC implementation | Current | SDK not published. Must implement against PLUGIN_SPEC.md |

**Deprecated/outdated:**
- `@paperclipai/plugin-sdk`: Not yet published to npm. Do not wait for it.
- XState for pipeline FSM: STATE.md records decision to use custom FSM instead. Relevant for Phase 2, not Phase 1.
- `yaml` (eemeli) package: Requires TS 5.9+. Use js-yaml instead for TS 5.8 compatibility.

## Open Questions

1. **@paperclipai/shared actual availability on npm**
   - What we know: The package exists in the monorepo with `publishConfig.access: "public"` and version 0.3.1
   - What's unclear: Whether it is actually published to npm or only available via monorepo workspace references
   - Recommendation: Try `npm info @paperclipai/shared` during Wave 0. If not on npm, install from git URL or add as a git dependency. Worst case, extract the types we need into a local types file.

2. **JSON-RPC framing: newline-delimited vs Content-Length header**
   - What we know: PLUGIN_SPEC.md says "JSON-RPC over stdio" but does not specify the framing protocol
   - What's unclear: Whether Paperclip host uses newline-delimited JSON (NDJSON) or LSP-style Content-Length headers
   - Recommendation: Implement newline-delimited JSON (simpler, more common for Node.js stdio). Add Content-Length support if integration testing reveals the host expects it. The test harness should validate framing compatibility.

3. **Signal YAML format edge case: `GSD_SIGNAL:TYPE` as YAML key**
   - What we know: The first line inside the `---` block is `GSD_SIGNAL:<TYPE>`. In YAML, `GSD_SIGNAL:DISCUSS_COMPLETE` parses as a key `GSD_SIGNAL` with value `DISCUSS_COMPLETE`.
   - What's unclear: Is this intentional (use YAML key parsing) or should the first line be treated as a marker and stripped before YAML parsing?
   - Recommendation: Treat the first line as a marker. Extract the signal type from it via regex, then strip it before passing the remaining lines to js-yaml. This avoids relying on YAML parsing of what is effectively a protocol marker.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.x |
| Config file | `vitest.config.ts` (Wave 0 creation) |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run --coverage` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PIPE-01 | Plugin responds to initialize RPC with manifest | integration | `npx vitest run src/plugin/rpc-handler.test.ts -t "initialize"` | Wave 0 |
| PIPE-01 | Plugin responds to health RPC with ok status | integration | `npx vitest run src/plugin/rpc-handler.test.ts -t "health"` | Wave 0 |
| PIPE-01 | Plugin worker round-trip via child process stdio | integration | `npx vitest run src/plugin/integration.test.ts` | Wave 0 |
| PIPE-04 | analyzeRoadmap returns typed phase data | integration | `npx vitest run src/bridge/commands.test.ts -t "analyzeRoadmap"` | Wave 0 |
| PIPE-04 | getPhase returns typed phase definition | integration | `npx vitest run src/bridge/commands.test.ts -t "getPhase"` | Wave 0 |
| PIPE-04 | getState returns typed project state | integration | `npx vitest run src/bridge/commands.test.ts -t "getState"` | Wave 0 |
| PIPE-04 | findPhase returns path and metadata | integration | `npx vitest run src/bridge/commands.test.ts -t "findPhase"` | Wave 0 |
| PIPE-04 | GsdToolsNotFoundError on missing binary | unit | `npx vitest run src/bridge/discovery.test.ts -t "not found"` | Wave 0 |
| PIPE-04 | GsdTimeoutError on timeout | unit | `npx vitest run src/bridge/executor.test.ts -t "timeout"` | Wave 0 |
| PIPE-05 | Parser extracts signal from surrounding text | unit | `npx vitest run src/signals/parser.test.ts -t "extract"` | Wave 0 |
| PIPE-05 | Parser validates all 12 signal types | unit | `npx vitest run src/signals/schemas.test.ts` | Wave 0 |
| PIPE-05 | Parser returns null for non-signal text | unit | `npx vitest run src/signals/parser.test.ts -t "non-signal"` | Wave 0 |
| PIPE-05 | Parser strips unknown fields | unit | `npx vitest run src/signals/schemas.test.ts -t "strip"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run --coverage`
- **Phase gate:** Full suite green + `npx tsc --noEmit` + `npx biome check .` before verify

### Wave 0 Gaps
- [ ] `vitest.config.ts` -- vitest configuration for ESM TypeScript project
- [ ] `tsconfig.json` -- TypeScript configuration with nodenext module resolution
- [ ] `package.json` -- project scaffolding with all dependencies
- [ ] `biome.json` -- Biome configuration with console.log ban rule
- [ ] `src/plugin/rpc-handler.test.ts` -- plugin RPC integration tests
- [ ] `src/plugin/integration.test.ts` -- child process round-trip test
- [ ] `src/bridge/commands.test.ts` -- bridge integration tests against fixture
- [ ] `src/bridge/executor.test.ts` -- executor unit tests
- [ ] `src/bridge/discovery.test.ts` -- discovery logic tests
- [ ] `src/signals/parser.test.ts` -- signal parser unit tests
- [ ] `src/signals/schemas.test.ts` -- signal schema validation tests
- [ ] `tests/fixtures/` -- test fixture project with ROADMAP.md and STATE.md

## Sources

### Primary (HIGH confidence)
- [Paperclip PLUGIN_SPEC.md](https://github.com/paperclipai/paperclip/blob/master/doc/plugins/PLUGIN_SPEC.md) -- Full plugin manifest, JSON-RPC protocol, capability model
- [@paperclipai/shared package.json](https://github.com/paperclipai/paperclip/blob/master/packages/shared/package.json) -- Confirmed Zod version: `^3.24.2`
- [Paperclip monorepo structure (DeepWiki)](https://deepwiki.com/paperclipai/paperclip/1.2-monorepo-structure) -- Package layout, adapter architecture, shared types
- [JSON-RPC 2.0 Specification](https://www.jsonrpc.org/specification) -- Complete protocol spec with error codes
- gsd-tools.cjs live output -- Verified `roadmap analyze`, `roadmap get-phase`, `state json`, `find-phase` output structures by running against this project's ROADMAP.md

### Secondary (MEDIUM confidence)
- [Zod 4 versioning strategy](https://zod.dev/v4/versioning) -- Subpath import compatibility (`zod/v4` in `zod@^3.25.0`)
- [Zod 4 API reference](https://zod.dev/api) -- Schema definition patterns
- [Biome vs ESLint (PkgPulse 2026)](https://www.pkgpulse.com/blog/eslint-vs-biome-2026) -- Performance benchmarks, rule coverage
- [Vitest 4.1 release](https://vitest.dev/blog/vitest-4-1) -- Latest features and ESM support
- [execa API docs](https://github.com/sindresorhus/execa/blob/main/docs/api.md) -- Promise API, timeout, TypeScript types
- [TypeScript nodenext docs](https://www.typescriptlang.org/tsconfig/module) -- Module resolution behavior

### Tertiary (LOW confidence)
- [Pino 9 configuration (SigNoz)](https://signoz.io/guides/pino-logger/) -- Stderr configuration pattern
- [js-yaml vs yaml performance (GitHub Discussion)](https://github.com/eemeli/yaml/discussions/358) -- Performance comparison (js-yaml much faster for simple YAML)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- All library versions verified against npm/GitHub. Zod version confirmed against @paperclipai/shared package.json. All gsd-tools output structures verified by running live commands.
- Architecture: HIGH -- Project structure follows decisions locked in CONTEXT.md. JSON-RPC protocol fully specified. Component boundaries are clear from ARCHITECTURE.md research.
- Pitfalls: HIGH -- Stdout corruption, Zod version mismatch, and ESM extension issues are well-documented in the ecosystem. gsd-tools path discovery verified manually.

**Research date:** 2026-03-18
**Valid until:** 2026-04-18 (30 days -- stable toolchain, no fast-moving targets)
