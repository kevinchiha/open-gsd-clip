/**
 * GSD Signal module - inter-agent communication protocol.
 *
 * Signals are structured YAML blocks embedded in Paperclip issue comments.
 * This module provides parsing, validation, and formatting for all 12 signal types.
 */

export { formatSignal, parseSignal } from './parser.js';
export { gsdSignalSchema, signalSchemas } from './schemas.js';
export type { ValidatedGsdSignal } from './schemas.js';
export { SIGNAL_TYPES } from './types.js';
export type { GsdSignal, SignalType } from './types.js';
