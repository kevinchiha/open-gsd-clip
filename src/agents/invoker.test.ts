/**
 * Tests for agent invoker - spawns agents via issue creation and invocation.
 */

import { describe, expect, it, vi } from 'vitest';
import type { HostServices } from './types.js';
import type { AgentContext } from './context.js';
import { spawnAgent } from './invoker.js';

/**
 * Create a mock HostServices for testing.
 */
function createMockServices(overrides?: {
  issueId?: string;
  runId?: string;
}): HostServices {
  const issueId = overrides?.issueId ?? 'issue-123';
  const runId = overrides?.runId ?? 'run-456';

  return {
    agents: {
      invoke: vi.fn().mockResolvedValue({ ok: true, value: { runId } }),
    },
    issues: {
      create: vi.fn().mockResolvedValue({ ok: true, value: { id: issueId } }),
      createComment: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
      listComments: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    },
  };
}

describe('spawnAgent', () => {
  const companyId = 'company-abc';
  const agentId = 'agent-xyz';
  const ctx: AgentContext = {
    role: 'planner',
    projectPath: '/projects/my-app',
    phaseNumber: 3,
    gsdCommand: '/gsd:plan-phase 3',
  };

  it('creates issue with correct params', async () => {
    const services = createMockServices();
    await spawnAgent(services, companyId, agentId, ctx);

    expect(services.issues.create).toHaveBeenCalledWith({
      companyId,
      title: 'Planner: Run /gsd:plan-phase 3',
      description: expect.stringContaining('/projects/my-app'),
      status: 'todo',
      priority: 'high',
      assigneeAgentId: agentId,
      executionWorkspaceSettings: { mode: 'isolated' },
    });
  });

  it('invokes agent after issue creation', async () => {
    const services = createMockServices();
    await spawnAgent(services, companyId, agentId, ctx);

    expect(services.agents.invoke).toHaveBeenCalledWith({
      companyId,
      agentId,
      reason: expect.stringContaining('planner'),
      prompt: expect.stringContaining('issue-123'),
    });
  });

  it('returns SpawnResult with issueId and runId', async () => {
    const services = createMockServices({ issueId: 'iss-99', runId: 'run-77' });
    const result = await spawnAgent(services, companyId, agentId, ctx);

    expect(result).toEqual({ issueId: 'iss-99', runId: 'run-77' });
  });

  it('issue description contains project path, command, and phase', async () => {
    const services = createMockServices();
    await spawnAgent(services, companyId, agentId, ctx);

    const createCall = vi.mocked(services.issues.create).mock.calls[0][0];
    expect(createCall.description).toContain('/projects/my-app');
    expect(createCall.description).toContain('/gsd:plan-phase 3');
    expect(createCall.description).toContain('3');
  });

  it('uses isolated workspace mode', async () => {
    const services = createMockServices();
    await spawnAgent(services, companyId, agentId, ctx);

    const createCall = vi.mocked(services.issues.create).mock.calls[0][0];
    expect(createCall.executionWorkspaceSettings).toEqual({ mode: 'isolated' });
  });
});
