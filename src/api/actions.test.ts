import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PipelineRunner } from '../orchestrator/pipeline-runner.js';
import { ACTION_HANDLERS } from './actions.js';

function createMockRunner(): PipelineRunner {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    getState: vi.fn().mockReturnValue({
      status: 'running',
      phases: [
        { phaseNumber: 1, status: 'discussing' },
        { phaseNumber: 2, status: 'pending' },
      ],
      executionPlan: {
        groups: [[1], [2]],
        phaseOrder: [1, 2],
      },
      startedAt: '2026-01-01T00:00:00Z',
      completedAt: null,
      lastTransitionAt: '2026-01-01T00:00:00Z',
      projectPath: '/test',
      brief: 'Test brief',
    }),
    retryPhase: vi.fn().mockResolvedValue(undefined),
    resolveEscalation: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
  } as unknown as PipelineRunner;
}

describe('ACTION_HANDLERS', () => {
  let runner: PipelineRunner;

  beforeEach(() => {
    vi.clearAllMocks();
    runner = createMockRunner();
  });

  // ── gsd.start ──────────────────────────────────────────────────────

  describe('gsd.start', () => {
    it('calls runner.start with valid params and returns success', async () => {
      const result = await ACTION_HANDLERS['gsd.start']!(
        { projectPath: '/my/project', brief: 'Build a todo app' },
        runner,
      );
      expect(result).toEqual({ success: true, data: { status: 'started' } });
      expect(runner.start).toHaveBeenCalledWith('/my/project', 'Build a todo app');
    });

    it('returns error for invalid params', async () => {
      const result = await ACTION_HANDLERS['gsd.start']!({}, runner);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('catches thrown errors from runner.start', async () => {
      (runner.start as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Start failed'),
      );
      const result = await ACTION_HANDLERS['gsd.start']!(
        { projectPath: '/test', brief: 'test' },
        runner,
      );
      expect(result).toEqual({ success: false, error: 'Start failed' });
    });
  });

  // ── gsd.status ─────────────────────────────────────────────────────

  describe('gsd.status', () => {
    it('returns pipeline state when running', async () => {
      const result = await ACTION_HANDLERS['gsd.status']!({}, runner);
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('status', 'running');
    });

    it('returns error when pipeline not started', async () => {
      (runner.getState as ReturnType<typeof vi.fn>).mockReturnValue(null);
      const result = await ACTION_HANDLERS['gsd.status']!({}, runner);
      expect(result).toEqual({
        success: false,
        error: 'Pipeline not started',
      });
    });
  });

  // ── gsd.phases ─────────────────────────────────────────────────────

  describe('gsd.phases', () => {
    it('returns phase data from execution plan', async () => {
      const result = await ACTION_HANDLERS['gsd.phases']!({}, runner);
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('phases');
      expect(result.data).toHaveProperty('executionPlan');
    });

    it('returns error when no execution plan', async () => {
      (runner.getState as ReturnType<typeof vi.fn>).mockReturnValue({
        status: 'initializing',
        phases: [],
        executionPlan: null,
      });
      const result = await ACTION_HANDLERS['gsd.phases']!({}, runner);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/no execution plan/i);
    });

    it('returns error when pipeline not started', async () => {
      (runner.getState as ReturnType<typeof vi.fn>).mockReturnValue(null);
      const result = await ACTION_HANDLERS['gsd.phases']!({}, runner);
      expect(result.success).toBe(false);
    });
  });

  // ── gsd.retry ──────────────────────────────────────────────────────

  describe('gsd.retry', () => {
    it('calls runner.retryPhase with valid params', async () => {
      const result = await ACTION_HANDLERS['gsd.retry']!(
        { phaseNumber: 3 },
        runner,
      );
      expect(result.success).toBe(true);
      expect(runner.retryPhase).toHaveBeenCalledWith(3, undefined);
    });

    it('returns error for invalid params', async () => {
      const result = await ACTION_HANDLERS['gsd.retry']!(
        { phaseNumber: -1 },
        runner,
      );
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('catches thrown errors from runner.retryPhase', async () => {
      (runner.retryPhase as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Phase not failed'),
      );
      const result = await ACTION_HANDLERS['gsd.retry']!(
        { phaseNumber: 3 },
        runner,
      );
      expect(result).toEqual({ success: false, error: 'Phase not failed' });
    });
  });

  // ── gsd.override ───────────────────────────────────────────────────

  describe('gsd.override', () => {
    it('calls runner.resolveEscalation with valid params', async () => {
      const id = 'ESC-550e8400-e29b-41d4-a716-446655440000';
      const result = await ACTION_HANDLERS['gsd.override']!(
        { escalationId: id, decision: 'option 2' },
        runner,
      );
      expect(result.success).toBe(true);
      expect(runner.resolveEscalation).toHaveBeenCalledWith(id, 'option 2');
    });

    it('returns error for invalid params', async () => {
      const result = await ACTION_HANDLERS['gsd.override']!(
        { escalationId: 'not-an-esc-id', decision: 'option 2' },
        runner,
      );
      expect(result.success).toBe(false);
    });

    it('catches thrown errors from runner.resolveEscalation', async () => {
      (runner.resolveEscalation as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Escalation not found'),
      );
      const id = 'ESC-550e8400-e29b-41d4-a716-446655440000';
      const result = await ACTION_HANDLERS['gsd.override']!(
        { escalationId: id, decision: 'test' },
        runner,
      );
      expect(result).toEqual({ success: false, error: 'Escalation not found' });
    });
  });

  // ── gsd.pause ──────────────────────────────────────────────────────

  describe('gsd.pause', () => {
    it('calls runner.pause and returns success', async () => {
      const result = await ACTION_HANDLERS['gsd.pause']!({}, runner);
      expect(result).toEqual({ success: true, data: { status: 'paused' } });
      expect(runner.pause).toHaveBeenCalledOnce();
    });

    it('catches thrown errors', async () => {
      (runner.pause as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Not running'),
      );
      const result = await ACTION_HANDLERS['gsd.pause']!({}, runner);
      expect(result).toEqual({ success: false, error: 'Not running' });
    });
  });

  // ── gsd.resume ─────────────────────────────────────────────────────

  describe('gsd.resume', () => {
    it('calls runner.resume and returns success', async () => {
      const result = await ACTION_HANDLERS['gsd.resume']!({}, runner);
      expect(result).toEqual({ success: true, data: { status: 'resumed' } });
      expect(runner.resume).toHaveBeenCalledOnce();
    });

    it('catches thrown errors', async () => {
      (runner.resume as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Not paused'),
      );
      const result = await ACTION_HANDLERS['gsd.resume']!({}, runner);
      expect(result).toEqual({ success: false, error: 'Not paused' });
    });
  });
});
