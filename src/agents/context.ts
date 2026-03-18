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
 * Signal types that each role emits on completion.
 */
export const ROLE_SIGNALS: Record<AgentRole, string> = {
  ceo: 'PROJECT_READY',
  discusser: 'DISCUSS_COMPLETE',
  planner: 'PLAN_COMPLETE',
  executor: 'EXECUTE_COMPLETE',
  verifier: 'VERIFY_COMPLETE',
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

/**
 * Builds the issue description for an agent task.
 *
 * The description includes:
 * - GSD Task header
 * - Project path
 * - Command to run
 * - Phase number (for non-CEO roles)
 * - Brief section (CEO only)
 * - When Complete section with GSD_SIGNAL template
 *
 * @param ctx - The agent context
 * @returns The issue description string
 */
export function buildIssueDescription(ctx: AgentContext): string {
  const signal = ROLE_SIGNALS[ctx.role];
  const lines: string[] = [];

  // Header
  lines.push('# GSD Task');
  lines.push('');

  // Project path
  lines.push(`**Project:** \`${ctx.projectPath}\``);
  lines.push('');

  // Phase number (for non-CEO roles)
  if (ctx.phaseNumber !== undefined) {
    lines.push(`**Phase:** ${ctx.phaseNumber}`);
    lines.push('');
  }

  // Command section
  lines.push('## Your Task');
  lines.push('');
  lines.push('Run the following command:');
  lines.push('');
  lines.push('```');
  lines.push(ctx.gsdCommand);
  lines.push('```');
  lines.push('');

  // CEO special instructions for passing brief to --auto
  if (ctx.role === 'ceo' && ctx.brief) {
    lines.push('## Project Brief');
    lines.push('');
    lines.push(ctx.brief);
    lines.push('');
    lines.push(
      'Pass this brief to the --auto flag so the agent can work autonomously.',
    );
    lines.push('');
  }

  // When Complete section with signal template
  lines.push('## When Complete');
  lines.push('');
  lines.push('Post a comment on this issue with the following signal:');
  lines.push('');
  lines.push('---');
  lines.push(`GSD_SIGNAL:${signal}`);
  if (ctx.phaseNumber !== undefined) {
    lines.push(`phase: ${ctx.phaseNumber}`);
  } else {
    lines.push('phase: 0');
  }
  lines.push('status: success');
  lines.push('summary: [brief description of what was done]');
  lines.push('---');

  return lines.join('\n');
}
