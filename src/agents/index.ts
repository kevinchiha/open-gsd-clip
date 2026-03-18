/**
 * Barrel export for the agents module.
 *
 * Provides a single import point for all agent-related types,
 * factory functions, context builders, and invoker operations.
 */

export type { AgentContext } from './context.js';
// Context
export { buildIssueDescription, buildIssueTitle } from './context.js';

// Factory
export {
  ensureAgentsExist,
  getInstructionsDir,
  writeInstructionFile,
} from './factory.js';
export type { SpawnResult } from './invoker.js';
// Invoker
export { mapSignalToPhaseEvent, spawnAgent } from './invoker.js';
// Types
export type {
  AgentConfig,
  AgentDefinition,
  AgentRole,
  HostServices,
} from './types.js';
export { AGENT_ROLES, PAPERCLIP_ROLE_MAP } from './types.js';
