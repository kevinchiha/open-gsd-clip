/**
 * Notification preference types and filter logic.
 *
 * Controls which pipeline events are surfaced to the user
 * based on their notification preference setting.
 */

/**
 * Notification preference modes controlling event visibility.
 */
export type NotificationPreference =
  | 'all'
  | 'failures_only'
  | 'completions_only'
  | 'escalations_only';

/**
 * All valid notification preference values as an array for iteration.
 */
export const NOTIFICATION_PREFERENCES: NotificationPreference[] = [
  'all',
  'failures_only',
  'completions_only',
  'escalations_only',
];

/** Event types that match each preference filter. */
const PREFERENCE_FILTERS: Record<
  Exclude<NotificationPreference, 'all'>,
  ReadonlySet<string>
> = {
  failures_only: new Set(['phase_failed', 'pipeline_failed']),
  completions_only: new Set(['phase_completed', 'pipeline_completed']),
  escalations_only: new Set(['escalation']),
};

/**
 * Determine whether an event should be notified based on the user's preference.
 *
 * @param preference - The user's notification preference
 * @param eventType - The pipeline event type string
 * @returns true if the event should be sent as a notification
 */
export function shouldNotify(
  preference: NotificationPreference,
  eventType: string,
): boolean {
  if (preference === 'all') {
    return true;
  }
  const allowedEvents = PREFERENCE_FILTERS[preference];
  return allowedEvents.has(eventType);
}
