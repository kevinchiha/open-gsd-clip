/**
 * GSD agent roles. Each role maps to a Paperclip agent definition
 * with specific instructions and GSD commands to run.
 */
export type AgentRole =
  | 'ceo'
  | 'discusser'
  | 'designer'
  | 'planner'
  | 'executor';

/**
 * All GSD roles as an array for iteration.
 */
export const AGENT_ROLES: AgentRole[] = [
  'ceo',
  'discusser',
  'designer',
  'planner',
  'executor',
];

/**
 * Maps GSD roles to Paperclip agent role strings.
 */
export const PAPERCLIP_ROLE_MAP: Record<AgentRole, string> = {
  ceo: 'ceo',
  discusser: 'engineer',
  designer: 'designer',
  planner: 'pm',
  executor: 'engineer',
};

/**
 * Agent definition returned by the factory.
 */
export interface AgentDefinition {
  agentId: string;
  role: AgentRole;
  name: string;
  companyId?: string;
}

/**
 * Configuration for the claude_local adapter.
 */
export interface AgentConfig {
  cwd: string;
  instructionsFilePath: string;
  model: string;
}

import type { Result } from '../shared/types.js';

export type { Result } from '../shared/types.js';

/**
 * Partial HostServices interface for GSD agent operations.
 * The full interface is provided by Paperclip at runtime.
 */
export interface HostServices {
  agents: {
    invoke(params: {
      companyId: string;
      agentId: string;
      reason?: string | null;
      prompt?: string;
    }): Promise<Result<{ runId: string }>>;
    /** List agents (optional - may not be available) */
    list?(params: {
      name?: string;
      companyId?: string;
    }): Promise<Result<AgentDefinition[]>>;
    /** Create a new agent (optional - may not be available) */
    create?(params: {
      name: string;
      role: string;
      adapterConfig: AgentConfig;
    }): Promise<Result<AgentDefinition>>;
  };
  issues: {
    create(params: {
      companyId: string;
      title: string;
      description: string;
      status: string;
      priority: string;
      assigneeAgentId: string;
      executionWorkspaceSettings?: { mode: string };
    }): Promise<Result<{ id: string; [key: string]: unknown }>>;
    createComment(params: {
      companyId: string;
      issueId: string;
      body: string;
    }): Promise<Result<void>>;
    listComments(params: {
      companyId: string;
      issueId: string;
    }): Promise<
      Result<Array<{ id: string; body: string; [key: string]: unknown }>>
    >;
  };
}
