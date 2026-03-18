/**
 * Tests for context builder - constructs issue titles and descriptions for agent roles.
 */

import { describe, expect, it } from 'vitest';
import { type AgentContext, buildIssueTitle, ROLE_LABELS } from './context.js';
import type { AgentRole } from './types.js';

describe('AgentContext type', () => {
  it('should accept context for CEO role with brief', () => {
    const ctx: AgentContext = {
      role: 'ceo',
      projectPath: '/path/to/project',
      gsdCommand: '/gsd:new-project --auto',
      brief: 'Build a task management app',
    };
    expect(ctx.role).toBe('ceo');
    expect(ctx.brief).toBeDefined();
    expect(ctx.phaseNumber).toBeUndefined();
  });

  it('should accept context for non-CEO role with phaseNumber', () => {
    const ctx: AgentContext = {
      role: 'planner',
      projectPath: '/path/to/project',
      phaseNumber: 2,
      gsdCommand: '/gsd:plan-phase 2',
    };
    expect(ctx.role).toBe('planner');
    expect(ctx.phaseNumber).toBe(2);
    expect(ctx.brief).toBeUndefined();
  });
});

describe('ROLE_LABELS constant', () => {
  it('should have labels for all five roles', () => {
    expect(ROLE_LABELS['ceo']).toBe('CEO');
    expect(ROLE_LABELS['discusser']).toBe('Discusser');
    expect(ROLE_LABELS['planner']).toBe('Planner');
    expect(ROLE_LABELS['executor']).toBe('Executor');
    expect(ROLE_LABELS['verifier']).toBe('Verifier');
  });
});

describe('buildIssueTitle', () => {
  it('should return correct title for CEO role', () => {
    const ctx: AgentContext = {
      role: 'ceo',
      projectPath: '/path/to/project',
      gsdCommand: '/gsd:new-project --auto',
      brief: 'Build a task management app',
    };
    expect(buildIssueTitle(ctx)).toBe(
      'CEO: Initialize project with /gsd:new-project --auto',
    );
  });

  it('should return correct title for discusser role with phase number', () => {
    const ctx: AgentContext = {
      role: 'discusser',
      projectPath: '/path/to/project',
      phaseNumber: 3,
      gsdCommand: '/gsd:discuss-phase 3 --auto',
    };
    expect(buildIssueTitle(ctx)).toBe(
      'Discusser: Run /gsd:discuss-phase 3 --auto',
    );
  });

  it('should return correct title for planner role with phase number', () => {
    const ctx: AgentContext = {
      role: 'planner',
      projectPath: '/path/to/project',
      phaseNumber: 2,
      gsdCommand: '/gsd:plan-phase 2',
    };
    expect(buildIssueTitle(ctx)).toBe('Planner: Run /gsd:plan-phase 2');
  });

  it('should return correct title for executor role with phase number', () => {
    const ctx: AgentContext = {
      role: 'executor',
      projectPath: '/path/to/project',
      phaseNumber: 2,
      gsdCommand: '/gsd:execute-phase 2',
    };
    expect(buildIssueTitle(ctx)).toBe('Executor: Run /gsd:execute-phase 2');
  });

  it('should return correct title for verifier role with phase number', () => {
    const ctx: AgentContext = {
      role: 'verifier',
      projectPath: '/path/to/project',
      phaseNumber: 2,
      gsdCommand: '/gsd:verify-work 2',
    };
    expect(buildIssueTitle(ctx)).toBe('Verifier: Run /gsd:verify-work 2');
  });

  it('should interpolate phase number for non-CEO roles', () => {
    const roles: AgentRole[] = ['discusser', 'planner', 'executor', 'verifier'];
    for (const role of roles) {
      const ctx: AgentContext = {
        role,
        projectPath: '/path/to/project',
        phaseNumber: 5,
        gsdCommand: `/gsd:test ${role}`,
      };
      const title = buildIssueTitle(ctx);
      expect(title).toContain('5');
    }
  });
});
