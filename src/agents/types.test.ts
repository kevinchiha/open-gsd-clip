/**
 * Tests for agent type definitions.
 *
 * These tests verify type correctness at compile time and runtime.
 * They serve as documentation for the expected shape of agent types.
 */

import { describe, expect, it } from 'vitest';
import type {
  AgentConfig,
  AgentDefinition,
  AgentRole,
  HostServices,
} from './types.js';
import { AGENT_ROLES, PAPERCLIP_ROLE_MAP } from './types.js';

describe('AgentRole type', () => {
  it('should accept valid agent roles', () => {
    const roles: AgentRole[] = [
      'ceo',
      'discusser',
      'planner',
      'executor',
    ];
    expect(roles).toHaveLength(4);
  });
});

describe('AGENT_ROLES constant', () => {
  it('should contain all GSD roles', () => {
    expect(AGENT_ROLES).toContain('ceo');
    expect(AGENT_ROLES).toContain('discusser');
    expect(AGENT_ROLES).toContain('planner');
    expect(AGENT_ROLES).toContain('executor');
    expect(AGENT_ROLES).toHaveLength(5);
  });
});

describe('PAPERCLIP_ROLE_MAP', () => {
  it('should map ceo to ceo', () => {
    expect(PAPERCLIP_ROLE_MAP['ceo']).toBe('ceo');
  });

  it('should map discusser to engineer', () => {
    expect(PAPERCLIP_ROLE_MAP['discusser']).toBe('engineer');
  });

  it('should map planner to pm', () => {
    expect(PAPERCLIP_ROLE_MAP['planner']).toBe('pm');
  });

  it('should map executor to engineer', () => {
    expect(PAPERCLIP_ROLE_MAP['executor']).toBe('engineer');
  });

});

describe('AgentDefinition type', () => {
  it('should accept valid agent definition', () => {
    const def: AgentDefinition = {
      agentId: 'gsd-ceo',
      role: 'ceo',
      name: 'GSD CEO',
      companyId: 'company-123',
    };
    expect(def.agentId).toBe('gsd-ceo');
  });

  it('should allow optional companyId', () => {
    const def: AgentDefinition = {
      agentId: 'gsd-planner',
      role: 'planner',
      name: 'GSD Planner',
    };
    expect(def.companyId).toBeUndefined();
  });
});

describe('AgentConfig type', () => {
  it('should accept valid agent config', () => {
    const config: AgentConfig = {
      cwd: '/path/to/project',
      instructionsFilePath: '/path/to/instructions.md',
      model: 'claude-sonnet-4-20250514',
    };
    expect(config.cwd).toBe('/path/to/project');
    expect(config.instructionsFilePath).toBe('/path/to/instructions.md');
    expect(config.model).toBe('claude-sonnet-4-20250514');
  });
});

describe('HostServices interface', () => {
  it('should have agents.invoke method', () => {
    const services: HostServices = {
      agents: {
        invoke: async () => ({ ok: true, value: { runId: 'run-123' } }),
      },
      issues: {
        create: async () => ({ ok: true, value: { id: 'issue-1' } }),
        createComment: async () => ({ ok: true, value: undefined }),
        listComments: async () => ({ ok: true, value: [] }),
      },
    };
    expect(typeof services.agents.invoke).toBe('function');
  });
});
