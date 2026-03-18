---
phase: 03-agent-spawning-infrastructure
plan: 01
subsystem: agent-spawning
tags: [agents, factory, paperclip, typescript, tdd]
requires:
  - phase-01-foundation
  - phase-02-state-machines
provides:
  - Agent types (AgentRole, AgentDefinition, AgentConfig, HostServices)
  - Agent factory with create-or-lookup pattern
  - Role instruction files for GSD agents
affects:
  - 03-02 (context builder uses types)
  - 03-03 (invoker uses factory)
tech-stack:
  added: []
  patterns:
    - create-or-lookup pattern for agent definitions
    - dependency injection via HostServices parameter
key-files:
  created:
    - src/agents/instructions/ceo.md
    - src/agents/instructions/discusser.md
    - src/agents/instructions/planner.md
    - src/agents/instructions/executor.md
    - src/agents/instructions/verifier.md
  modified:
    - src/agents/types.ts
    - src/agents/factory.ts
    - src/agents/factory.test.ts
decisions:
  - HostServices interface extended with optional list/create methods for factory
  - Instruction files written to ~/.open-gsd-clip/agents/ at runtime
  - Static instruction files in src/agents/instructions/ serve as documentation/templates
  - Agent naming convention: gsd-{role} (e.g., gsd-ceo, gsd-planner)
duration: 15min
completed: 2026-03-18
---

# Phase 3 Plan 1: Agent Types and Factory Summary

## One-Liner

Agent types, factory with create-or-lookup pattern, and role instruction files for GSD agent spawning infrastructure.

## Objective Achieved

Defined agent types and implemented the agent factory that creates-or-looks-up Paperclip agent definitions for all five GSD roles (CEO, Discusser, Planner, Executor, Verifier).

## Task Commits

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Define agent types and HostServices interface | 3df03b1 | src/agents/types.ts |
| 2a | Factory tests (TDD RED) | cf3a209 | src/agents/factory.test.ts |
| 2b | Factory implementation (TDD GREEN) | b13243e | src/agents/factory.ts |
| 3 | Create role instruction files | 2ece74e | src/agents/instructions/*.md |

## Decisions Made

1. **HostServices interface extension**: Added optional `list?` and `create?` methods to support the factory's create-or-lookup pattern. These are optional because not all Paperclip environments provide these capabilities.

2. **Instruction file locations**: 
   - Runtime files written to `~/.open-gsd-clip/agents/{role}.md` (stable path, survives temp purges)
   - Static documentation files in `src/agents/instructions/{role}.md` serve as templates

3. **Agent naming convention**: `gsd-{role}` (e.g., gsd-ceo, gsd-planner) for stable, predictable agent identification

4. **PAPERCLIP_ROLE_MAP**: Maps GSD roles to Paperclip agent roles:
   - ceo → ceo
   - discusser → engineer
   - planner → pm
   - executor → engineer
   - verifier → qa

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Task 1 already completed**

- **Found during:** Initial execution
- **Issue:** Task 1 (types.ts) was already committed in 3df03b1 as a blocking dependency for Plan 02 (context builder)
- **Fix:** Acknowledged existing work, proceeded to Task 2
- **Files:** src/agents/types.ts (already existed)
- **Commit:** 3df03b1

**2. [Rule 2 - Missing Critical] HostServices interface needed extension**

- **Found during:** Task 2 implementation
- **Issue:** Factory's create-or-lookup pattern required `list` and `create` methods on HostServices.agents
- **Fix:** Extended HostServices interface with optional `list?` and `create?` methods
- **Files:** src/agents/types.ts
- **Commit:** b13243e

## Verification Results

### Tests
```
✓ src/agents/factory.test.ts (9 tests)
  ✓ getInstructionsDir (2 tests)
  ✓ writeInstructionFile (2 tests)
  ✓ ensureAgentsExist (5 tests)
```

### TypeScript
```
No errors
```

### Biome
```
Informational warnings only (useLiteralKeys in test files)
```

## Next Phase Readiness

### Blockers
None - all deliverables complete.

### Concerns
- One test in `src/agents/context.test.ts` is failing (from Plan 02, not this plan)
- Factory tests pass (9/9)

### Recommendations for Next Plan
- Plan 02 (context builder) should resolve the failing context.test.ts
- Plan 03 (invoker) will use the factory's `ensureAgentsExist` function

## Files Created/Modified

### Created
- `src/agents/instructions/ceo.md` - CEO role instructions
- `src/agents/instructions/discusser.md` - Discusser role instructions
- `src/agents/instructions/planner.md` - Planner role instructions
- `src/agents/instructions/executor.md` - Executor role instructions
- `src/agents/instructions/verifier.md` - Verifier role instructions

### Modified
- `src/agents/types.ts` - Added optional list/create to HostServices, PAPERCLIP_ROLE_MAP
- `src/agents/factory.ts` - Full implementation with create-or-lookup pattern
- `src/agents/factory.test.ts` - Comprehensive tests (9 passing)

## Self-Check: PASSED
