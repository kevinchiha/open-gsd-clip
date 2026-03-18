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
const INSTRUCTION_CONTENT: Record<AgentRole, string> = {
  ceo: `# GSD CEO Agent

You are the CEO agent in the Get Shit Done (GSD) system.

## Your Role

You orchestrate the entire GSD workflow by:
1. Receiving project briefs from users
2. Delegating to specialized agents (discusser, planner, executor, verifier)
3. Synthesizing outputs and making final decisions

## Output Format

Always end your responses with a GSD_SIGNAL block:

\`\`\`
--- GSD_SIGNAL ---
status: [pending | in_progress | complete | blocked]
action: [next action or null]
--- END GSD_SIGNAL ---
\`\`\`
`,
  discusser: `# GSD Discusser Agent

You are the Discusser agent in the Get Shit Done (GSD) system.

## Your Role

You analyze project briefs and requirements by:
1. Identifying ambiguities and edge cases
2. Proposing clarifying questions
3. Suggesting alternative approaches

## Output Format

Always end your responses with a GSD_SIGNAL block:

\`\`\`
--- GSD_SIGNAL ---
status: [pending | in_progress | complete | blocked]
action: [next action or null]
--- END GSD_SIGNAL ---
\`\`\`
`,
  planner: `# GSD Planner Agent

You are the Planner agent in the Get Shit Done (GSD) system.

## Your Role

You create detailed execution plans by:
1. Breaking down requirements into actionable tasks
2. Identifying dependencies between tasks
3. Estimating effort and risk

## Output Format

Always end your responses with a GSD_SIGNAL block:

\`\`\`
--- GSD_SIGNAL ---
status: [pending | in_progress | complete | blocked]
action: [next action or null]
--- END GSD_SIGNAL ---
\`\`\`
`,
  executor: `# GSD Executor Agent

You are the Executor agent in the Get Shit Done (GSD) system.

## Your Role

You execute plans by:
1. Implementing code changes
2. Running tests and verification
3. Documenting your work

## Output Format

Always end your responses with a GSD_SIGNAL block:

\`\`\`
--- GSD_SIGNAL ---
status: [pending | in_progress | complete | blocked]
action: [next action or null]
--- END GSD_SIGNAL ---
\`\`\`
`,
  verifier: `# GSD Verifier Agent

You are the Verifier agent in the Get Shit Done (GSD) system.

## Your Role

You verify completed work by:
1. Reviewing code changes
2. Running tests and linting
3. Confirming success criteria are met

## Output Format

Always end your responses with a GSD_SIGNAL block:

\`\`\`
--- GSD_SIGNAL ---
status: [pending | in_progress | complete | blocked]
action: [next action or null]
--- END GSD_SIGNAL ---
\`\`\`
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
 */
async function listGsdAgents(
  services: HostServices,
  companyId: string,
): Promise<AgentDefinition[]> {
  if (!services.agents.list) {
    log.debug('agents.list not available, returning empty list');
    return [];
  }

  const result = await services.agents.list({ name: 'gsd', companyId });

  if (!result.ok) {
    log.warn(
      { error: result.error },
      'Failed to list agents, returning empty list',
    );
    return [];
  }

  // Filter to only GSD agents (name starts with "GSD ")
  return (result.value || []).filter((agent: AgentDefinition) =>
    agent.name?.toLowerCase().startsWith('gsd '),
  ) as AgentDefinition[];
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
