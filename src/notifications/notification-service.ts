/**
 * Notification service for posting pipeline activity via HostServices.
 *
 * Formats pipeline events into human-readable messages and posts
 * them as issue comments on a dedicated status issue. Respects
 * user notification preferences to filter low-interest events.
 */

import type { HostServices } from '../agents/types.js';
import { createChildLogger } from '../shared/logger.js';
import type { PipelineNotificationEvent } from './formatters.js';
import { formatPipelineEvent } from './formatters.js';
import type { NotificationPreference } from './preferences.js';
import { shouldNotify } from './preferences.js';

export type { PipelineNotificationEvent } from './formatters.js';

const log = createChildLogger('notification-service');

/**
 * Posts formatted pipeline activity as issue comments via HostServices.
 *
 * Notifications are fire-and-forget: errors are logged but never thrown
 * to avoid disrupting pipeline execution.
 */
export class NotificationService {
  private preference: NotificationPreference = 'all';

  constructor(
    private readonly services: HostServices,
    private readonly companyId: string,
    private readonly statusIssueId: string,
  ) {}

  /**
   * Set the notification preference for filtering events.
   */
  setPreference(pref: NotificationPreference): void {
    this.preference = pref;
  }

  /**
   * Get the current notification preference.
   */
  getPreference(): NotificationPreference {
    return this.preference;
  }

  /**
   * Post a notification for the given pipeline event.
   *
   * Checks the user's preference to determine if the event
   * should be surfaced. If allowed, formats the event and
   * posts it as an issue comment.
   *
   * Errors are caught and logged -- notifications never throw.
   */
  async notify(event: PipelineNotificationEvent): Promise<void> {
    if (!shouldNotify(this.preference, event.type)) {
      log.debug(
        { eventType: event.type, preference: this.preference },
        'Event filtered by preference',
      );
      return;
    }

    const message = formatPipelineEvent(event);

    try {
      await this.services.issues.createComment({
        companyId: this.companyId,
        issueId: this.statusIssueId,
        body: message,
      });
    } catch (err) {
      log.error(
        { err, eventType: event.type },
        'Failed to post notification comment',
      );
    }
  }
}
