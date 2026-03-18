/**
 * Human-readable message formatting for pipeline notification events.
 *
 * Each event type maps to a plain-text message (no emojis per project
 * convention). The formatted strings are used by NotificationService
 * for issue comment activity posts.
 */

// ── Event type discriminated union ──────────────────────────────────

export type PipelineNotificationEvent =
  | { type: 'pipeline_started'; projectPath: string; brief: string }
  | { type: 'phase_started'; phaseNumber: number; phaseName: string }
  | { type: 'phase_completed'; phaseNumber: number; phaseName: string }
  | {
      type: 'phase_failed';
      phaseNumber: number;
      phaseName: string;
      error: string;
    }
  | {
      type: 'escalation';
      phaseNumber: number;
      context: string;
      options: string[];
    }
  | { type: 'pipeline_completed'; totalPhases: number }
  | { type: 'pipeline_failed'; error: string }
  | { type: 'pipeline_paused'; reason: string }
  | { type: 'pipeline_resumed' };

// ── Formatter ───────────────────────────────────────────────────────

/**
 * Format a pipeline notification event into a human-readable string.
 *
 * @param event - The discriminated pipeline notification event
 * @returns A plain-text message suitable for posting as a comment
 */
export function formatPipelineEvent(event: PipelineNotificationEvent): string {
  switch (event.type) {
    case 'pipeline_started':
      return `Pipeline started for project: ${event.projectPath}\nBrief: ${event.brief}`;

    case 'phase_started':
      return `Phase ${event.phaseNumber} (${event.phaseName}) started.`;

    case 'phase_completed':
      return `Phase ${event.phaseNumber} (${event.phaseName}) completed successfully.`;

    case 'phase_failed':
      return `Phase ${event.phaseNumber} (${event.phaseName}) failed: ${event.error}`;

    case 'escalation': {
      const numberedOptions = event.options
        .map((opt, i) => `${i + 1}. ${opt}`)
        .join('\n');
      return `[Escalation] Phase ${event.phaseNumber} requires a decision.\n${event.context}\n\nOptions:\n${numberedOptions}`;
    }

    case 'pipeline_completed':
      return `Pipeline completed successfully. ${event.totalPhases} phases executed.`;

    case 'pipeline_failed':
      return `Pipeline failed: ${event.error}`;

    case 'pipeline_paused':
      return `Pipeline paused: ${event.reason}`;

    case 'pipeline_resumed':
      return 'Pipeline resumed.';
  }
}
