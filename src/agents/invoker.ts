/**
 * Agent invoker for spawning GSD agents via issue creation and invocation.
 *
 * The invoker is the action layer: it takes an agent definition and context,
 * creates a Paperclip issue, and wakes the agent. The event handler (in
 * rpc-handler.ts) is the reaction layer that detects when agents complete.
 */

import type { ErrorType, PhaseEvent } from '../pipeline/types.js';
import { createChildLogger } from '../shared/logger.js';
import type { GsdSignal } from '../signals/types.js';
import {
  type AgentContext,
  buildIssueDescription,
  buildIssueTitle,
} from './context.js';
import type { HostServices } from './types.js';

const log = createChildLogger('agent-invoker');

/**
 * Result of spawning an agent.
 */
export interface SpawnResult {
  issueId: string;
  runId: string;
}

/**
 * Spawn an agent by creating an issue assigned to it.
 *
 * Creates an issue with isolated workspace settings and assigneeAgentId.
 * Paperclip's issue creation endpoint automatically triggers
 * heartbeat.wakeup() when an issue is assigned to an agent with
 * a non-backlog status, so no explicit invoke call is needed.
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
      mode: 'isolated_workspace',
    },
  });

  if (!issueResult.ok) {
    throw new Error(
      `Failed to create issue for ${ctx.role}: ${issueResult.error}`,
    );
  }

  const issueId = issueResult.value.id;

  log.info(
    { role: ctx.role, issueId },
    'Issue created with assigneeAgentId — agent wakeup is automatic',
  );

  return { issueId, runId: issueId };
}

/**
 * Map a GSD signal to a PhaseEvent for FSM dispatch.
 *
 * Converts signal types from agent completion into events that
 * the pipeline/phase FSM can process. Returns null for signals
 * that don't directly map to phase events (e.g. DECISION_NEEDED,
 * STALE_HEARTBEAT) -- those are handled by Phase 4 orchestration.
 *
 * @param signal - Parsed GSD signal from an agent
 * @returns PhaseEvent or null if not applicable
 */
export function mapSignalToPhaseEvent(signal: GsdSignal): PhaseEvent | null {
  switch (signal.type) {
    case 'PROJECT_READY':
      return { type: 'STEP_COMPLETED' };

    case 'DISCUSS_COMPLETE':
      if (signal.status === 'success') {
        return { type: 'STEP_COMPLETED' };
      }
      return {
        type: 'STEP_FAILED',
        errorType: 'fatal' as ErrorType,
        message: signal.summary ?? 'Discussion failed',
      };

    case 'APPROVED':
      return { type: 'APPROVED' };

    case 'REVISION_NEEDED':
      return { type: 'REVISION_NEEDED' };

    case 'UI_DESIGN_COMPLETE':
      if (signal.status === 'success') {
        return { type: 'STEP_COMPLETED' };
      }
      return {
        type: 'STEP_FAILED',
        errorType: 'fatal' as ErrorType,
        message: signal.summary ?? 'UI design failed',
      };

    case 'UI_REVIEW_COMPLETE':
      if (signal.status === 'success') {
        return { type: 'STEP_COMPLETED' };
      }
      return {
        type: 'STEP_FAILED',
        errorType: 'fatal' as ErrorType,
        message: signal.summary ?? 'UI review failed',
      };

    case 'PLAN_COMPLETE':
      if (signal.status === 'success') {
        return { type: 'STEP_COMPLETED' };
      }
      return {
        type: 'STEP_FAILED',
        errorType: 'fatal' as ErrorType,
        message: signal.summary ?? 'Planning failed',
      };

    case 'EXECUTE_COMPLETE':
      if (signal.status === 'success') {
        return { type: 'STEP_COMPLETED' };
      }
      return {
        type: 'STEP_FAILED',
        errorType: 'fatal' as ErrorType,
        message: signal.summary ?? 'Execution failed',
      };

    case 'AGENT_ERROR':
      return {
        type: 'STEP_FAILED',
        errorType: 'fatal' as ErrorType,
        message: signal.error,
      };

    case 'DECISION_NEEDED':
    case 'DECISION_MADE':
    case 'STALE_HEARTBEAT':
      // These signals don't directly map to phase events.
      // They're handled by Phase 4 orchestration or monitoring.
      return null;

    default:
      return null;
  }
}
