---
phase: 03-agent-spawning-infrastructure
plan: 01
type: execute
wave: 1
autonomous: true
---

<objective>
Define agent types and implement the agent factory that creates-or-looks-up Paperclip agent definitions for all five GSD roles.

Purpose: The factory is the foundation of agent spawning. Without it, the plugin cannot create the specialized agents that execute GSD phases.

Output: Agent types module, factory module with HostServices integration, and five role instruction files, and.

</objective>

---

## Task 1: Define agent types and HostServices interface

### Behavior
- AgentRole is union of 'ceo' | 'discusser' | 'planner' | 'executor' | 'verifier'
- AGENT_ROLES contains all five GSD roles as an array for iteration
- AgentDefinition contains agentId, role, name, and optional companyId
- AgentConfig contains cwd, instructionsFilePath, model
- PAPERCLIP_ROLE_MAP maps GSD roles to Paperclip agent roles (ceo->ceo, discusser->engineer, planner->pm, executor->engineer, verifier->qa)
- HostServices interface defines agents.invoke, issues.create, issues.createComment, issues.listComments methods (partial interface for GSD needs)
- Instruction files written to stable path (~/.open-gsd-clip/agents/)
- Files are minimal (~100-200 tokens) and include role identity and GSD_SIGNAL output format
</behavior>
</task>

---

<task type="auto">
  <name>Task 3: Create role instruction files</name>
  <files>src/agents/instructions/ceo.md, src/agents/instructions/discusser.md, src/agents/instructions/planner.md, src/agents/instructions/executor.md, src/agents/instructions/verifier.md</files>
  <behavior>
    - Each file contains role-specific instructions for claude_local --append-system-prompt-file
    - Each file includes role identity and GSD_SIGNAL output format
    - Files are minimal (~100-200 tokens)
      - Static documentation in `src/agents/instructions/` directory matches INSTRUCTION content in factory.ts
    - Each file has `output` section describing GSD_SIGNAL format
  </behavior>
</behavior>
</task>

---

<verification>
Run agent module tests:
npx vitest run src/agents/ --reporter=verbose
Verify TypeScript compilation:
npx tsc --noEmit
Verify lint:
npx biome check src/agents/
</verification>

<success_criteria>
- Agent types defined with correct role mappings
- Factory creates agents with correct adapterConfig
- Instruction files written to stable path (~/.open-gsd-clip/agents/)
- Factory handles missing agents.create gracefully
- All tests pass, TypeScript compiles, Biome passes
 - **Plan metadata:** `docs(03-01): complete agent types and factory plan`

SUMMARY.md created with commit hashes tracked for SUMMARY documentation.

  - [Rule 3 - Blocking] Fixed git lock file conflict (Task 2 had uncommitted files, was existed before committing)
  - [Rule 1 - Bug] Fixed missing Result export from types.ts (Task 1 commit cf3a209 already included)
 AgentRole type, but tests still pass)
      - [Rule 2 - Missing Critical] Added password hashing to to factory and (Task 2 commit d6fe73)
      - [Rule 3 - Blocking] Fixed missing `node:fs` import (Task 2 commit e92 error)
      - Fixed by adding `fs` import to factory.ts (Task 2 commit)

**Self-Check:** All files and commits exist

 SUMMARY files created:
- `src/agents/factory.ts`
- `src/agents/factory.test.ts`
- `src/agents/instructions/ceo.md`
- `src/agents/instructions/discusser.md`
- `src/agents/instructions/planner.md`
    - `src/agents/instructions/executor.md`
    - `src/agents/instructions/verifier.md`
- + `src/agents/types.ts` (re-exported from types.ts)
    + `src/agents/instructions/` directory for instruction files.

All tasks have been completed. The next step is to create the SUMMARY.md file and update STATE.md.

Final Commit. docs(03-01): complete agent types and factory plan"

- Commit hashes: tasks completed, files modified, deviations, and create SUMMARY.md and update STATE.md.
- Report completion

 user.
</completion>