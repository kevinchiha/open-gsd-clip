/**
 * Barrel export for the API module.
 *
 * Provides action handlers, chat parser, and request schemas
 * for the GSD user-facing integration layer.
 */

// Action handlers
export { ACTION_HANDLERS } from './actions.js';
export type { ActionHandler, ActionResult } from './actions.js';

// Chat parser
export { parseCommand } from './chat-parser.js';
export type { ParsedCommand } from './chat-parser.js';

// Schemas
export {
  OverrideSchema,
  PreferenceSchema,
  RetrySchema,
  StartSchema,
} from './schemas.js';
export type {
  OverrideInput,
  PreferenceInput,
  RetryInput,
  StartInput,
} from './schemas.js';
