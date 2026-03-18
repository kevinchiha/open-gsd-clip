/**
 * Agent invoker for spawning GSD agents via issue creation and invocation.
 *
 * The invoker is the action layer: it takes an agent definition and context,
 * creates a Paperclip issue, and wakes the agent. The event handler (in
 * rpc-handler.ts) is the reaction layer that detects when agents complete.
 */

import { createChildLogger } from '../shared/logger.js';
import type { HostServices } from './types.js';
import {
  buildIssueTitle,
  buildIssueDescription,
  type AgentContext,
} from './context.js';

const log = createChildLogger('agent-invoker');

/**
 * Result of spawning an agent.
 */
export interface SpawnResult {
  issueId: string;
  runId: string;
}

/**
 * Spawn an agent by creating an issue and invoking the agent.
 *
 * Creates an issue with isolated workspace settings, then invokes
 * the agent with a prompt pointing to the issue.
 *
 * @param services - HostServices for Paperclip API access
 * @param companyId - Company/tenant ID
 * @param agentId - Paperclip agent ID to invoke
 * @param ctx - Agent context with role, project path, phase, etc.
 * @returns SpawnResult with issue and run IDs
 */
export async function spawnAgent(
  services: HostServices,
  companyId: string,
  agentId: string,
  ctx: AgentContext,
): Promise<SpawnResult> {
  const title = buildIssueTitle(ctx);
  const description = buildIssueDescription(ctx);

  log.info({ role: ctx.role, agentId, title }, 'Creating issue for agent');

  const issueResult = await services.issues.create({
    companyId,
    title,
    description,
    status: 'todo',
    priority: 'high',
    assigneeAgentId: agentId,
    executionWorkspaceSettings: {
      mode: 'isolated',
    },
  });

  if (!issueResult.ok) {
    throw new Error(`Failed to create issue for ${ctx.role}: ${issueResult.error}`);
  }

  const issueId = issueResult.value.id;

  log.info({ role: ctx.role, issueId }, 'Issue created, invoking agent');

  const invokeResult = await services.agents.invoke({
    companyId,
    agentId,
    reason: `GSD ${ctx.role} task: ${title}`,
    prompt: `You have a new task assigned. Issue ID: ${issueId}. Check your assigned issues and complete the task.`,
  });

  if (!invokeResult.ok) {
    throw new Error(`Failed to invoke agent for ${ctx.role}: ${invokeResult.error}`);
  }

  const { runId } = invokeResult.value;

  log.info({ role: ctx.role, issueId, runId }, 'Agent invoked');

  return { issueId, runId };
}
