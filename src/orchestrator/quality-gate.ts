/**
 * CEO quality gate review and revision logic.
 *
 * After a discusser completes CONTEXT.md, the CEO reviews it via a
 * quality gate. The CEO either approves (advancing to planning) or
 * requests revision (re-triggering discussion with feedback injected).
 *
 * This module builds the AgentContext and issue descriptions for both
 * the review and revision flows.
 */

import type { AgentContext } from '../agents/context.js';

/**
 * Build an AgentContext for the CEO review step.
 *
 * The CEO reviews CONTEXT.md produced by the discusser and decides
 * whether the phase is ready to proceed to planning.
 */
export function buildCeoReviewContext(
  projectPath: string,
  phaseNumber: number,
): AgentContext {
  return {
    role: 'ceo',
    projectPath,
    phaseNumber,
    gsdCommand: 'review-context',
  };
}

/**
 * Build the issue description for a CEO quality gate review.
 *
 * Includes evaluation criteria, the CONTEXT.md path, and signal
 * templates for both APPROVED and REVISION_NEEDED outcomes.
 */
export function buildReviewIssueDescription(
  projectPath: string,
  phaseNumber: number,
  contextMdPath: string,
): string {
  const lines: string[] = [];

  lines.push('## CEO Quality Gate Review');
  lines.push('');
  lines.push(`**Project:** \`${projectPath}\``);
  lines.push(`**Phase:** ${phaseNumber}`);
  lines.push(`**File to review:** \`${contextMdPath}\``);
  lines.push('');

  // Instructions
  lines.push('## Instructions');
  lines.push('');
  lines.push('Review the CONTEXT.md file produced by the discusser. Evaluate:');
  lines.push('');
  lines.push('- Are all decisions clear and unambiguous?');
  lines.push('- Are there gaps or missing considerations?');
  lines.push('- Does it align with the project requirements?');
  lines.push('');

  // APPROVED section
  lines.push('## When Approved');
  lines.push('');
  lines.push('If the context document is satisfactory, post:');
  lines.push('');
  lines.push('---');
  lines.push('GSD_SIGNAL:APPROVED');
  lines.push(`phase: ${phaseNumber}`);
  lines.push('status: success');
  lines.push('summary: [brief reason for approval]');
  lines.push('---');
  lines.push('');

  // REVISION_NEEDED section
  lines.push('## When Revision Needed');
  lines.push('');
  lines.push('If the context document needs improvement, post:');
  lines.push('');
  lines.push('---');
  lines.push('GSD_SIGNAL:REVISION_NEEDED');
  lines.push(`phase: ${phaseNumber}`);
  lines.push('status: revision');
  lines.push('feedback: [specific gaps or issues to address]');
  lines.push('---');

  return lines.join('\n');
}

/**
 * Build an AgentContext for re-discussion after CEO revision request.
 *
 * The discusser is re-spawned with the CEO's feedback so it can
 * address specific gaps identified during review.
 */
export function buildRevisionContext(
  projectPath: string,
  phaseNumber: number,
  _feedback: string,
): AgentContext {
  return {
    role: 'discusser',
    projectPath,
    phaseNumber,
    gsdCommand: `/gsd:discuss-phase ${phaseNumber} --auto`,
  };
}

/**
 * Build the issue description for a revision re-discussion.
 *
 * Includes the original GSD command, the CEO's feedback under a
 * "Previous Review Feedback" section, and the DISCUSS_COMPLETE
 * signal template.
 */
export function buildRevisionIssueDescription(
  projectPath: string,
  phaseNumber: number,
  feedback: string,
  gsdCommand: string,
): string {
  const lines: string[] = [];

  lines.push('# GSD Task');
  lines.push('');
  lines.push(`**Project:** \`${projectPath}\``);
  lines.push(`**Phase:** ${phaseNumber}`);
  lines.push('');

  // Command section
  lines.push('## Your Task');
  lines.push('');
  lines.push('Run the following command:');
  lines.push('');
  lines.push('```');
  lines.push(gsdCommand);
  lines.push('```');
  lines.push('');

  // CEO feedback section
  lines.push('## Previous Review Feedback');
  lines.push('');
  lines.push('The CEO reviewed the previous CONTEXT.md and identified these gaps:');
  lines.push('');
  lines.push(feedback);
  lines.push('');
  lines.push('Address all feedback items in this revision.');
  lines.push('');

  // When Complete section
  lines.push('## When Complete');
  lines.push('');
  lines.push('Post a comment on this issue with the following signal:');
  lines.push('');
  lines.push('---');
  lines.push('GSD_SIGNAL:DISCUSS_COMPLETE');
  lines.push(`phase: ${phaseNumber}`);
  lines.push('status: success');
  lines.push('summary: [brief description of what was revised]');
  lines.push('---');

  return lines.join('\n');
}
