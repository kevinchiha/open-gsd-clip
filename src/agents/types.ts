/**
 * GSD agent roles. Each role maps to a Paperclip agent definition
 * with specific instructions and GSD commands to run.
 */
export type AgentRole =
  | 'ceo'
  | 'discusser'
  | 'planner'
  | 'executor'
  | 'verifier';

/**
 * All GSD roles as an array for iteration.
 */
export const AGENT_ROLES: AgentRole[] = [
  'ceo',
  'discusser',
  'planner',
  'executor',
  'verifier',
];

/**
 * Maps GSD roles to Paperclip agent role strings.
 */
export const PAPERCLIP_ROLE_MAP: Record<AgentRole, string> = {
  ceo: 'ceo',
  discusser: 'engineer',
  planner: 'pm',
  executor: 'engineer',
  verifier: 'qa',
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

/**
 * Result type for operations that can fail.
 */
export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

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
