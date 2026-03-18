/**
 * @open-gsd/clip - Paperclip plugin for autonomous GSD pipeline orchestration
 *
 * Modules:
 * - plugin/        : JSON-RPC transport and handler for Paperclip host communication
 * - bridge/        : Typed wrapper around gsd-tools.cjs CLI
 * - signals/       : GSD_SIGNAL structured comment parser
 * - shared/        : Logger, base errors, utility types
 * - api/           : Action handlers, chat parser, request schemas
 * - notifications/ : Pipeline event formatting and notification delivery
 */
export const VERSION = '0.1.0';

export * from './api/index.js';
export * from './notifications/index.js';
