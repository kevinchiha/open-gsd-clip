/**
 * Barrel export for the notifications module.
 *
 * Re-exports all public APIs for pipeline event formatting,
 * notification preference filtering, and activity posting.
 */

export type { PipelineNotificationEvent } from './formatters.js';
export { formatPipelineEvent } from './formatters.js';
export type { NotificationPreference } from './preferences.js';
export { NOTIFICATION_PREFERENCES, shouldNotify } from './preferences.js';
export { NotificationService } from './notification-service.js';
