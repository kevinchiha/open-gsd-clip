---
phase: 03-agent-spawning-infrastructure
plan: 02
subsystem: agent-spawning
tags: [agents, context, issue-builder, typescript, tdd]
requires:
  - phase-01-foundation
  - phase-02-state-machines
  - 03-01 (agent types)
provides:
  - AgentContext type
  - buildIssueTitle function
  - buildIssueDescription function with GSD_SIGNAL templates
affects:
  - 03-03 (invoker uses context builder)
tech-stack:
  added: []
  patterns:
    - Context injection via issue descriptions (dynamic per-run)
    - Role-specific GSD command and signal templates
key-files:
  created:
    - src/agents/context.ts
    - src/agents/context.test.ts
  modified: []
decisions:
  - Context injection via issue descriptions (dynamic per-run), not instructionsFilePath (static)
  - CEO description includes brief-passing instructions for --auto flag
  - Each role has specific GSD_SIGNAL type (PROJECT_READY, DISCUSS_COMPLETE, etc.)
duration: 10min
completed: 2026-03-18
---

# Phase 3 Plan 2: Context Builder Summary

## One-Liner

Context builder that constructs issue titles and descriptions with role-specific context and GSD_SIGNAL templates for agent task assignment.

## Objective Achieved

Implemented the context builder that constructs issue titles and descriptions for each agent role (CEO, Discusser, Planner, Executor, Verifier) with rich, unambiguous descriptions that tell the agent exactly what to do and what signal to emit on completion.

## Task Commits

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Define AgentContext type and buildIssueTitle | 6238228 | src/agents/context.ts |
| 1a | Context builder tests (TDD RED) | 3df03b1 | src/agents/context.test.ts |
| 2 | Build issue description with signal template | 7efebac | src/agents/context.ts |
| 2a | Fix phase number assertion | 1ed23dc | src/agents/context.test.ts |

## Decisions Made

1. **Context injection mechanism**: Issue descriptions are the primary context injection mechanism (dynamic per-run), not instructionsFilePath (static). This allows different phase numbers and briefs per invocation.

2. **CEO brief-passing instructions**: CEO description includes special instructions for passing the project brief to the `--auto` flag via temp file.

3. **Role-specific GSD_SIGNAL types**:
   - CEO → PROJECT_READY
   - Discusser → DISCUSS_COMPLETE
   - Planner → PLAN_COMPLETE
   - Executor → EXECUTE_COMPLETE
   - Verifier → VERIFY_COMPLETE

4. **Issue description format**: Structured with GSD Task header, project path, command, phase (for non-CEO), brief (CEO only), instructions (CEO only), and When Complete section with YAML signal template.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Phase number assertion format mismatch**

- **Found during:** Test verification
- **Issue:** Test expected `Phase 3` but implementation outputs `**Phase:** 3`
- **Fix:** Updated test assertion to match actual format `**Phase:** 3`
- **Files:** src/agents/context.test.ts
- **Commit:** 1ed23dc

## Verification Results

### Tests
```
✓ src/agents/context.test.ts (24 tests)
  ✓ AgentContext type (2 tests)
  ✓ ROLE_LABELS constant (1 test)
  ✓ buildIssueTitle (6 tests)
  ✓ ROLE_SIGNALS constant (1 test)
  ✓ buildIssueDescription (14 tests)
```

### TypeScript
```
No errors
```

### Biome
```
Clean
```

## Next Phase Readiness

### Blockers
None - all deliverables complete.

### Concerns
None.

### Recommendations for Next Plan
- Plan 03 (invoker) will use buildIssueTitle and buildIssueDescription
- Invoker creates issues with the context built by these functions

## Files Created/Modified

### Created
- `src/agents/context.ts` - AgentContext type, buildIssueTitle, buildIssueDescription
- `src/agents/context.test.ts` - Comprehensive tests (24 passing)

## Self-Check: PASSED
