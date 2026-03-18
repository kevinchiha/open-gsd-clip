/**
 * Agent factory for GSD roles.
 *
 * Implements the create-or-lookup pattern for Paperclip agents:
 * 1. Check for existing gsd-{role} agents
 * 2. Create missing agents with correct adapterConfig
 * 3. Return all agent definitions (idempotent)
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createChildLogger } from '../shared/logger.js';
import type {
  AgentConfig,
  AgentDefinition,
  AgentRole,
  HostServices,
} from './types.js';
import { AGENT_ROLES, PAPERCLIP_ROLE_MAP } from './types.js';

const log = createChildLogger('agent-factory');

/**
 * Instruction content for each GSD role.
 * These are minimal (~100-200 tokens) and include role identity
 * and GSD_SIGNAL output format.
 */
const AUTONOMOUS_PREAMBLE = `
## CRITICAL: Autonomous Mode

You are running as a Paperclip agent in a headless heartbeat. There is NO human to interact with.

**Rules:**
- NEVER use AskUserQuestion or any interactive prompts
- NEVER wait for user input — make decisions autonomously using sensible defaults
- Read project files in .planning/ for context (PROJECT.md, REQUIREMENTS.md, ROADMAP.md, STATE.md, research/)
- When you have options, pick the one recommended by the research files or use industry best practices
- Always post a GSD_SIGNAL comment on your issue when done

## Signal Format

Post this as a comment on your assigned issue when complete:

\`\`\`
GSD_SIGNAL:{SIGNAL_TYPE}
phase: {N}
status: success
summary: {what you did}
\`\`\`
`;

const INSTRUCTION_CONTENT: Record<AgentRole, string> = {
  ceo: `# GSD CEO Agent
${AUTONOMOUS_PREAMBLE}

## Your Role

You orchestrate the entire GSD workflow by:
1. Receiving project briefs and running \`/gsd:new-project --auto\` to initialize
2. Reading the generated .planning/ files to understand the project
3. Making architectural decisions based on research files

## Signal Type
Use \`PROJECT_READY\` when project initialization is complete.
`,
  discusser: `# GSD Discusser Agent
${AUTONOMOUS_PREAMBLE}

## Your Role

You analyze phase requirements and make design decisions by:
1. Reading .planning/REQUIREMENTS.md and .planning/phases/ for context
2. Reading .planning/research/ files for technology recommendations
3. Making decisions autonomously — do NOT ask questions, just decide based on research
4. Writing your analysis and decisions as a comment on the assigned issue

When the research recommends a specific approach, adopt it. When multiple options exist with no clear recommendation, pick the simplest one.

## Signal Type
Use \`DISCUSS_COMPLETE\` when your analysis is done.
`,
  planner: `# GSD Planner Agent
${AUTONOMOUS_PREAMBLE}

## Your Role

You create detailed execution plans by:
1. Reading phase requirements and any discussion output
2. Breaking down the phase into actionable implementation tasks
3. Identifying dependencies between tasks
4. Writing the plan as a comment on the assigned issue

## Signal Type
Use \`PLAN_COMPLETE\` when the plan is ready.
`,
  executor: `# GSD Executor Agent
${AUTONOMOUS_PREAMBLE}

## Your Role

You execute plans by:
1. Reading the plan from prior comments on the issue
2. Implementing code changes following the plan
3. Running tests to verify your work
4. Committing changes with clear commit messages

## Signal Type
Use \`EXECUTE_COMPLETE\` when implementation is done.
`,
  verifier: `# GSD Verifier Agent
${AUTONOMOUS_PREAMBLE}

## Your Role

You verify completed work by:
1. Reviewing the code changes from the executor
2. Running tests and linting
3. Confirming all success criteria from the plan are met
4. Reporting any issues found

## Signal Types
Use \`VERIFY_COMPLETE\` if all checks pass.
Use \`VERIFY_FAILED\` with a list of issues if checks fail.
`,
};

/**
 * Get the directory where instruction files are stored.
 * Creates the directory if it doesn't exist.
 *
 * @returns Absolute path to ~/.open-gsd-clip/agents
 */
export function getInstructionsDir(): string {
  const dir = path.join(os.homedir(), '.open-gsd-clip', 'agents');

  if (!fs.existsSync(dir)) {
    log.info({ dir }, 'Creating instructions directory');
    fs.mkdirSync(dir, { recursive: true });
  }

  return dir;
}

/**
 * Write an instruction file for a specific role.
 *
 * @param role - The GSD agent role
 * @returns Absolute path to the written instruction file
 */
export function writeInstructionFile(role: AgentRole): string {
  const dir = getInstructionsDir();
  const filePath = path.join(dir, `${role}.md`);

  log.debug({ role, filePath }, 'Writing instruction file');
  fs.writeFileSync(filePath, INSTRUCTION_CONTENT[role], 'utf-8');

  return filePath;
}

/**
 * Ensure all GSD agents exist in Paperclip.
 *
 * Implements the create-or-lookup pattern:
 * 1. Lists existing agents with gsd-* names
 * 2. Creates missing agents with correct adapterConfig
 * 3. Returns all agent definitions (idempotent)
 *
 * @param services - HostServices from Paperclip
 * @param projectPath - Current project working directory
 * @param companyId - Paperclip company ID
 * @returns Record mapping AgentRole to AgentDefinition
 */
export async function ensureAgentsExist(
  services: HostServices,
  projectPath: string,
  companyId: string,
  model = 'claude-opus-4-6',
): Promise<Record<AgentRole, AgentDefinition>> {
  log.info({ companyId, projectPath }, 'Ensuring GSD agents exist');

  // Get existing agents
  const existingAgents = await listGsdAgents(services, companyId);
  const existingByRole = new Map<AgentRole, AgentDefinition>();

  for (const agent of existingAgents) {
    const role = agent.name.toLowerCase().replace('gsd ', '') as AgentRole;
    if (AGENT_ROLES.includes(role)) {
      existingByRole.set(role, agent);
    }
  }

  log.debug(
    { existingCount: existingByRole.size },
    'Found existing GSD agents',
  );

  // Create missing agents
  const agents: Record<AgentRole, AgentDefinition> = {} as Record<
    AgentRole,
    AgentDefinition
  >;

  for (const role of AGENT_ROLES) {
    if (existingByRole.has(role)) {
      agents[role] = existingByRole.get(role)!;
      log.debug(
        { role, agentId: agents[role].agentId },
        'Using existing agent',
      );
    } else {
      agents[role] = await createGsdAgent(
        services,
        role,
        projectPath,
        companyId,
        model,
      );
      log.info({ role, agentId: agents[role].agentId }, 'Created new agent');
    }
  }

  return agents;
}

/**
 * List existing GSD agents from Paperclip.
 *
 * Tries host services first, falls back to direct HTTP API
 * when the plugin runtime doesn't expose agents.list.
 */
async function listGsdAgents(
  services: HostServices,
  companyId: string,
): Promise<AgentDefinition[]> {
  // Try host services first
  if (services.agents.list) {
    const result = await services.agents.list({ name: 'gsd', companyId });
    if (result.ok) {
      return (result.value || []).filter((agent: AgentDefinition) =>
        agent.name?.toLowerCase().startsWith('gsd '),
      ) as AgentDefinition[];
    }
    log.warn({ error: result.error }, 'agents.list failed, trying HTTP fallback');
  }

  // Fallback: query Paperclip REST API directly
  const port = process.env.PAPERCLIP_PORT || '3100';
  const url = `http://127.0.0.1:${port}/api/companies/${companyId}/agents`;
  log.debug({ url }, 'Fetching agents via HTTP fallback');

  try {
    const res = await fetch(url);
    if (!res.ok) {
      log.warn({ status: res.status }, 'HTTP agent list failed');
      return [];
    }
    const raw = (await res.json()) as Array<{ id: string; name: string; role: string; companyId: string }>;
    return raw
      .filter((a) => a.name?.toLowerCase().startsWith('gsd '))
      .map((a) => ({
        agentId: a.id,
        name: a.name,
        role: a.name.toLowerCase().replace('gsd ', '') as AgentRole,
        companyId: a.companyId,
      }));
  } catch (err) {
    log.warn({ error: (err as Error).message }, 'HTTP agent list fetch failed');
    return [];
  }
}

/**
 * Create a new GSD agent in Paperclip.
 */
async function createGsdAgent(
  services: HostServices,
  role: AgentRole,
  projectPath: string,
  companyId: string,
  model: string,
): Promise<AgentDefinition> {
  const name = getAgentName(role);
  const instructionsFilePath = writeInstructionFile(role);

  const adapterConfig: AgentConfig = {
    cwd: projectPath,
    instructionsFilePath,
    model,
  };

  // Check if create is available
  if (!services.agents.create) {
    throw new Error(
      `agents.create not available - cannot create ${name} agent. ` +
        `Please ensure the Paperclip plugin has create permissions.`,
    );
  }

  const result = await services.agents.create({
    name,
    role: getPaperclipRole(role),
    adapterConfig,
  });

  if (!result.ok) {
    throw new Error(`Failed to create ${name} agent: ${result.error}`);
  }

  return {
    ...result.value!,
    companyId,
  };
}

/**
 * Get the display name for a GSD role.
 */
function getAgentName(role: AgentRole): string {
  const labels: Record<AgentRole, string> = {
    ceo: 'GSD CEO',
    discusser: 'GSD Discusser',
    planner: 'GSD Planner',
    executor: 'GSD Executor',
    verifier: 'GSD Verifier',
  };
  return labels[role];
}

/**
 * Get the Paperclip role for a GSD role.
 */
function getPaperclipRole(role: AgentRole): string {
  return PAPERCLIP_ROLE_MAP[role];
}
