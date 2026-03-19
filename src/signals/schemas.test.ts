import { describe, expect, it } from 'vitest';
import { SIGNAL_TYPES } from './types.js';
import { gsdSignalSchema, signalSchemas } from './schemas.js';

describe('Signal schemas', () => {
  it('has schemas for all 10 signal types', () => {
    for (const type of SIGNAL_TYPES) {
      expect(signalSchemas[type]).toBeDefined();
    }
  });

  describe('PROJECT_READY', () => {
    it('validates valid data', () => {
      const result = signalSchemas.PROJECT_READY.safeParse({
        type: 'PROJECT_READY',
        phase: 1,
        artifacts: ['package.json'],
        summary: 'Project initialized',
      });
      expect(result.success).toBe(true);
    });

    it('accepts minimal valid data (no optional fields)', () => {
      const result = signalSchemas.PROJECT_READY.safeParse({
        type: 'PROJECT_READY',
        phase: 1,
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing required field (phase)', () => {
      const result = signalSchemas.PROJECT_READY.safeParse({
        type: 'PROJECT_READY',
      });
      expect(result.success).toBe(false);
    });

    it('strips unknown fields', () => {
      const result = signalSchemas.PROJECT_READY.safeParse({
        type: 'PROJECT_READY',
        phase: 1,
        unknown_field: 'should be stripped',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).not.toHaveProperty('unknown_field');
      }
    });
  });

  describe('DISCUSS_COMPLETE', () => {
    it('validates valid data', () => {
      const result = signalSchemas.DISCUSS_COMPLETE.safeParse({
        type: 'DISCUSS_COMPLETE',
        phase: 1,
        status: 'success',
        artifacts: ['plan.md'],
        summary: 'Discussion done',
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing required field (status)', () => {
      const result = signalSchemas.DISCUSS_COMPLETE.safeParse({
        type: 'DISCUSS_COMPLETE',
        phase: 1,
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid status value', () => {
      const result = signalSchemas.DISCUSS_COMPLETE.safeParse({
        type: 'DISCUSS_COMPLETE',
        phase: 1,
        status: 'invalid',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('APPROVED', () => {
    it('validates valid data', () => {
      const result = signalSchemas.APPROVED.safeParse({
        type: 'APPROVED',
        phase: 1,
        summary: 'Looks good',
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing phase', () => {
      const result = signalSchemas.APPROVED.safeParse({
        type: 'APPROVED',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('REVISION_NEEDED', () => {
    it('validates valid data', () => {
      const result = signalSchemas.REVISION_NEEDED.safeParse({
        type: 'REVISION_NEEDED',
        phase: 1,
        feedback: 'Please fix the auth module',
        summary: 'Changes needed',
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing required field (feedback)', () => {
      const result = signalSchemas.REVISION_NEEDED.safeParse({
        type: 'REVISION_NEEDED',
        phase: 1,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('PLAN_COMPLETE', () => {
    it('validates valid data', () => {
      const result = signalSchemas.PLAN_COMPLETE.safeParse({
        type: 'PLAN_COMPLETE',
        phase: 2,
        status: 'success',
        artifacts: ['plan.md', 'context.md'],
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing required field (status)', () => {
      const result = signalSchemas.PLAN_COMPLETE.safeParse({
        type: 'PLAN_COMPLETE',
        phase: 2,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('EXECUTE_COMPLETE', () => {
    it('validates valid data', () => {
      const result = signalSchemas.EXECUTE_COMPLETE.safeParse({
        type: 'EXECUTE_COMPLETE',
        phase: 1,
        status: 'failure',
        summary: 'Build failed',
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing required field (status)', () => {
      const result = signalSchemas.EXECUTE_COMPLETE.safeParse({
        type: 'EXECUTE_COMPLETE',
        phase: 1,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('DECISION_NEEDED', () => {
    it('validates valid data', () => {
      const result = signalSchemas.DECISION_NEEDED.safeParse({
        type: 'DECISION_NEEDED',
        phase: 2,
        context: 'Which database to use?',
        options: ['PostgreSQL', 'SQLite', 'MongoDB'],
        summary: 'DB choice required',
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing required field (context)', () => {
      const result = signalSchemas.DECISION_NEEDED.safeParse({
        type: 'DECISION_NEEDED',
        phase: 2,
        options: ['A', 'B'],
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing required field (options)', () => {
      const result = signalSchemas.DECISION_NEEDED.safeParse({
        type: 'DECISION_NEEDED',
        phase: 2,
        context: 'Which DB?',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('DECISION_MADE', () => {
    it('validates valid data', () => {
      const result = signalSchemas.DECISION_MADE.safeParse({
        type: 'DECISION_MADE',
        phase: 2,
        decision: 'PostgreSQL',
        reasoning: 'Better for relational data',
        summary: 'Decision recorded',
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing required field (decision)', () => {
      const result = signalSchemas.DECISION_MADE.safeParse({
        type: 'DECISION_MADE',
        phase: 2,
        reasoning: 'Some reasoning',
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing required field (reasoning)', () => {
      const result = signalSchemas.DECISION_MADE.safeParse({
        type: 'DECISION_MADE',
        phase: 2,
        decision: 'Option A',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('AGENT_ERROR', () => {
    it('validates valid data', () => {
      const result = signalSchemas.AGENT_ERROR.safeParse({
        type: 'AGENT_ERROR',
        phase: 1,
        error: 'Command timed out after 30s',
        command: 'npm test',
        summary: 'Agent encountered error',
      });
      expect(result.success).toBe(true);
    });

    it('accepts minimal valid data (no optional fields)', () => {
      const result = signalSchemas.AGENT_ERROR.safeParse({
        type: 'AGENT_ERROR',
        phase: 1,
        error: 'Unknown failure',
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing required field (error)', () => {
      const result = signalSchemas.AGENT_ERROR.safeParse({
        type: 'AGENT_ERROR',
        phase: 1,
      });
      expect(result.success).toBe(false);
    });

    it('strips unknown fields', () => {
      const result = signalSchemas.AGENT_ERROR.safeParse({
        type: 'AGENT_ERROR',
        phase: 1,
        error: 'test error',
        extra_field: 'should be removed',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).not.toHaveProperty('extra_field');
      }
    });
  });

  describe('STALE_HEARTBEAT', () => {
    it('validates valid data', () => {
      const result = signalSchemas.STALE_HEARTBEAT.safeParse({
        type: 'STALE_HEARTBEAT',
        phase: 1,
        agent_id: 'agent-executor-01',
        elapsed_ms: 120000,
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing required field (agent_id)', () => {
      const result = signalSchemas.STALE_HEARTBEAT.safeParse({
        type: 'STALE_HEARTBEAT',
        phase: 1,
        elapsed_ms: 120000,
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing required field (elapsed_ms)', () => {
      const result = signalSchemas.STALE_HEARTBEAT.safeParse({
        type: 'STALE_HEARTBEAT',
        phase: 1,
        agent_id: 'agent-01',
      });
      expect(result.success).toBe(false);
    });

    it('strips unknown fields', () => {
      const result = signalSchemas.STALE_HEARTBEAT.safeParse({
        type: 'STALE_HEARTBEAT',
        phase: 1,
        agent_id: 'agent-01',
        elapsed_ms: 5000,
        extra: 'removed',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).not.toHaveProperty('extra');
      }
    });
  });
});

describe('gsdSignalSchema (discriminated union)', () => {
  it('validates each signal type through the union', () => {
    const validSignals = [
      { type: 'PROJECT_READY', phase: 1 },
      { type: 'DISCUSS_COMPLETE', phase: 1, status: 'success' },
      { type: 'APPROVED', phase: 1 },
      { type: 'REVISION_NEEDED', phase: 1, feedback: 'Fix it' },
      { type: 'PLAN_COMPLETE', phase: 1, status: 'failure' },
      { type: 'EXECUTE_COMPLETE', phase: 1, status: 'success' },
      { type: 'DECISION_NEEDED', phase: 1, context: 'ctx', options: ['a'] },
      { type: 'DECISION_MADE', phase: 1, decision: 'd', reasoning: 'r' },
      { type: 'AGENT_ERROR', phase: 1, error: 'err' },
      { type: 'STALE_HEARTBEAT', phase: 1, agent_id: 'a1', elapsed_ms: 100 },
    ];

    for (const signal of validSignals) {
      const result = gsdSignalSchema.safeParse(signal);
      expect(result.success, `Expected ${signal.type} to pass`).toBe(true);
    }
  });

  it('rejects unknown signal type', () => {
    const result = gsdSignalSchema.safeParse({
      type: 'UNKNOWN_TYPE',
      phase: 1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects signal with missing type-specific required field', () => {
    const result = gsdSignalSchema.safeParse({
      type: 'DISCUSS_COMPLETE',
      phase: 1,
      // missing 'status' field
    });
    expect(result.success).toBe(false);
  });
});
