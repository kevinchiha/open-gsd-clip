/**
 * Tests for agent invoker - spawns agents via issue creation and invocation.
 */

import { describe, expect, it, vi } from 'vitest';
import type { GsdSignal } from '../signals/types.js';
import type { AgentContext } from './context.js';
import { mapSignalToPhaseEvent, spawnAgent } from './invoker.js';
import type { HostServices } from './types.js';

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

describe('mapSignalToPhaseEvent', () => {
  it('maps PROJECT_READY to STEP_COMPLETED', () => {
    const signal: GsdSignal = { type: 'PROJECT_READY', phase: 0 };
    expect(mapSignalToPhaseEvent(signal)).toEqual({ type: 'STEP_COMPLETED' });
  });

  it('maps DISCUSS_COMPLETE success to STEP_COMPLETED', () => {
    const signal: GsdSignal = {
      type: 'DISCUSS_COMPLETE',
      phase: 1,
      status: 'success',
    };
    expect(mapSignalToPhaseEvent(signal)).toEqual({ type: 'STEP_COMPLETED' });
  });

  it('maps DISCUSS_COMPLETE failure to STEP_FAILED with fatal', () => {
    const signal: GsdSignal = {
      type: 'DISCUSS_COMPLETE',
      phase: 1,
      status: 'failure',
      summary: 'Could not reach consensus',
    };
    expect(mapSignalToPhaseEvent(signal)).toEqual({
      type: 'STEP_FAILED',
      errorType: 'fatal',
      message: 'Could not reach consensus',
    });
  });

  it('maps DISCUSS_COMPLETE failure with no summary to default message', () => {
    const signal: GsdSignal = {
      type: 'DISCUSS_COMPLETE',
      phase: 1,
      status: 'failure',
    };
    expect(mapSignalToPhaseEvent(signal)).toEqual({
      type: 'STEP_FAILED',
      errorType: 'fatal',
      message: 'Discussion failed',
    });
  });

  it('maps APPROVED to APPROVED', () => {
    const signal: GsdSignal = { type: 'APPROVED', phase: 1 };
    expect(mapSignalToPhaseEvent(signal)).toEqual({ type: 'APPROVED' });
  });

  it('maps REVISION_NEEDED to REVISION_NEEDED', () => {
    const signal: GsdSignal = {
      type: 'REVISION_NEEDED',
      phase: 1,
      feedback: 'Needs work',
    };
    expect(mapSignalToPhaseEvent(signal)).toEqual({ type: 'REVISION_NEEDED' });
  });

  it('maps PLAN_COMPLETE success to STEP_COMPLETED', () => {
    const signal: GsdSignal = {
      type: 'PLAN_COMPLETE',
      phase: 2,
      status: 'success',
    };
    expect(mapSignalToPhaseEvent(signal)).toEqual({ type: 'STEP_COMPLETED' });
  });

  it('maps PLAN_COMPLETE failure to STEP_FAILED', () => {
    const signal: GsdSignal = {
      type: 'PLAN_COMPLETE',
      phase: 2,
      status: 'failure',
      summary: 'Plan incomplete',
    };
    expect(mapSignalToPhaseEvent(signal)).toEqual({
      type: 'STEP_FAILED',
      errorType: 'fatal',
      message: 'Plan incomplete',
    });
  });

  it('maps EXECUTE_COMPLETE success to STEP_COMPLETED', () => {
    const signal: GsdSignal = {
      type: 'EXECUTE_COMPLETE',
      phase: 3,
      status: 'success',
    };
    expect(mapSignalToPhaseEvent(signal)).toEqual({ type: 'STEP_COMPLETED' });
  });

  it('maps EXECUTE_COMPLETE failure to STEP_FAILED', () => {
    const signal: GsdSignal = {
      type: 'EXECUTE_COMPLETE',
      phase: 3,
      status: 'failure',
      summary: 'Build errors',
    };
    expect(mapSignalToPhaseEvent(signal)).toEqual({
      type: 'STEP_FAILED',
      errorType: 'fatal',
      message: 'Build errors',
    });
  });

  it('maps VERIFY_COMPLETE to STEP_COMPLETED', () => {
    const signal: GsdSignal = { type: 'VERIFY_COMPLETE', phase: 3 };
    expect(mapSignalToPhaseEvent(signal)).toEqual({ type: 'STEP_COMPLETED' });
  });

  it('maps VERIFY_FAILED to STEP_FAILED with test_failure', () => {
    const signal: GsdSignal = {
      type: 'VERIFY_FAILED',
      phase: 3,
      issues: ['Test A failed', 'Lint error in file.ts'],
    };
    expect(mapSignalToPhaseEvent(signal)).toEqual({
      type: 'STEP_FAILED',
      errorType: 'test_failure',
      message: 'Test A failed; Lint error in file.ts',
    });
  });

  it('maps AGENT_ERROR to STEP_FAILED with fatal', () => {
    const signal: GsdSignal = {
      type: 'AGENT_ERROR',
      phase: 2,
      error: 'Agent crashed unexpectedly',
    };
    expect(mapSignalToPhaseEvent(signal)).toEqual({
      type: 'STEP_FAILED',
      errorType: 'fatal',
      message: 'Agent crashed unexpectedly',
    });
  });

  it('maps DECISION_NEEDED to null', () => {
    const signal: GsdSignal = {
      type: 'DECISION_NEEDED',
      phase: 1,
      context: 'Need to choose DB',
      options: ['Postgres', 'SQLite'],
    };
    expect(mapSignalToPhaseEvent(signal)).toBeNull();
  });

  it('maps DECISION_MADE to null', () => {
    const signal: GsdSignal = {
      type: 'DECISION_MADE',
      phase: 1,
      decision: 'Use Postgres',
      reasoning: 'Better for production',
    };
    expect(mapSignalToPhaseEvent(signal)).toBeNull();
  });

  it('maps STALE_HEARTBEAT to null', () => {
    const signal: GsdSignal = {
      type: 'STALE_HEARTBEAT',
      phase: 2,
      agent_id: 'agent-123',
      elapsed_ms: 60000,
    };
    expect(mapSignalToPhaseEvent(signal)).toBeNull();
  });
});
