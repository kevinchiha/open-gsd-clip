/**
 * Context builder for constructing issue titles and descriptions for GSD agent roles.
 *
 * The context builder is the primary context injection mechanism. Agents receive
 * their task context via the issue they're assigned to. This module constructs
 * rich, unambiguous descriptions that tell the agent exactly what to do and
 * what signal to emit on completion.
 */

import type { AgentRole } from './types.js';

/**
 * Human-readable labels for each GSD agent role.
 */
export const ROLE_LABELS: Record<AgentRole, string> = {
  ceo: 'CEO',
  discusser: 'Discusser',
  planner: 'Planner',
  executor: 'Executor',
  verifier: 'Verifier',
};

/**
 * Context for building an agent's issue title and description.
 */
export interface AgentContext {
  /** The GSD agent role */
  role: AgentRole;
  /** Path to the project directory */
  projectPath: string;
  /** Phase number (required for non-CEO roles) */
  phaseNumber?: number;
  /** Project brief (CEO only) */
  brief?: string;
  /** The GSD command to run */
  gsdCommand: string;
}

/**
 * Builds the issue title for an agent task.
 *
 * Format: "{Role}: {action description}"
 * - CEO: "CEO: Initialize project with /gsd:new-project --auto"
 * - Non-CEO: "{Role}: Run /gsd:{command} {phase}"
 *
 * @param ctx - The agent context
 * @returns The issue title string
 */
export function buildIssueTitle(ctx: AgentContext): string {
  const label = ROLE_LABELS[ctx.role];

  if (ctx.role === 'ceo') {
    return `${label}: Initialize project with ${ctx.gsdCommand}`;
  }

  return `${label}: Run ${ctx.gsdCommand}`;
}
