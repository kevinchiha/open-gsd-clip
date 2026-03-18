/**
 * Tests for context builder - constructs issue titles and descriptions for agent roles.
 */

import { describe, expect, it } from 'vitest';
import {
  type AgentContext,
  buildIssueDescription,
  buildIssueTitle,
  ROLE_LABELS,
  ROLE_SIGNALS,
} from './context.js';
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
        gsdCommand: `/gsd:${role}-phase 5`,
      };
      const title = buildIssueTitle(ctx);
      expect(title).toContain('5');
    }
  });
});

describe('ROLE_SIGNALS constant', () => {
  it('should have signal types for all five roles', () => {
    expect(ROLE_SIGNALS['ceo']).toBe('PROJECT_READY');
    expect(ROLE_SIGNALS['discusser']).toBe('DISCUSS_COMPLETE');
    expect(ROLE_SIGNALS['planner']).toBe('PLAN_COMPLETE');
    expect(ROLE_SIGNALS['executor']).toBe('EXECUTE_COMPLETE');
    expect(ROLE_SIGNALS['verifier']).toBe('VERIFY_COMPLETE');
  });
});

describe('buildIssueDescription', () => {
  describe('CEO role', () => {
    it('should include project path', () => {
      const ctx: AgentContext = {
        role: 'ceo',
        projectPath: '/projects/my-app',
        gsdCommand: '/gsd:new-project --auto',
        brief: 'Build a task app',
      };
      const desc = buildIssueDescription(ctx);
      expect(desc).toContain('/projects/my-app');
    });

    it('should include project brief section', () => {
      const ctx: AgentContext = {
        role: 'ceo',
        projectPath: '/projects/my-app',
        gsdCommand: '/gsd:new-project --auto',
        brief: 'Build a task management application',
      };
      const desc = buildIssueDescription(ctx);
      expect(desc).toContain('## Project Brief');
      expect(desc).toContain('Build a task management application');
    });

    it('should include instructions for passing brief to --auto flag', () => {
      const ctx: AgentContext = {
        role: 'ceo',
        projectPath: '/projects/my-app',
        gsdCommand: '/gsd:new-project --auto',
        brief: 'Build a task app',
      };
      const desc = buildIssueDescription(ctx);
      expect(desc).toContain('--auto');
      expect(desc).toContain('brief');
    });

    it('should include GSD_SIGNAL template with PROJECT_READY', () => {
      const ctx: AgentContext = {
        role: 'ceo',
        projectPath: '/projects/my-app',
        gsdCommand: '/gsd:new-project --auto',
        brief: 'Build a task app',
      };
      const desc = buildIssueDescription(ctx);
      expect(desc).toContain('GSD_SIGNAL:PROJECT_READY');
      expect(desc).toContain('phase: 0');
    });

    it('should include When Complete section', () => {
      const ctx: AgentContext = {
        role: 'ceo',
        projectPath: '/projects/my-app',
        gsdCommand: '/gsd:new-project --auto',
        brief: 'Build a task app',
      };
      const desc = buildIssueDescription(ctx);
      expect(desc).toContain('## When Complete');
    });
  });

  describe('Discusser role', () => {
    it('should include project path and phase number', () => {
      const ctx: AgentContext = {
        role: 'discusser',
        projectPath: '/projects/my-app',
        phaseNumber: 3,
        gsdCommand: '/gsd:discuss-phase 3 --auto',
      };
      const desc = buildIssueDescription(ctx);
      expect(desc).toContain('/projects/my-app');
      expect(desc).toContain('Phase 3');
    });

    it('should include GSD_SIGNAL template with DISCUSS_COMPLETE', () => {
      const ctx: AgentContext = {
        role: 'discusser',
        projectPath: '/projects/my-app',
        phaseNumber: 3,
        gsdCommand: '/gsd:discuss-phase 3 --auto',
      };
      const desc = buildIssueDescription(ctx);
      expect(desc).toContain('GSD_SIGNAL:DISCUSS_COMPLETE');
      expect(desc).toContain('phase: 3');
    });

    it('should not include brief section', () => {
      const ctx: AgentContext = {
        role: 'discusser',
        projectPath: '/projects/my-app',
        phaseNumber: 3,
        gsdCommand: '/gsd:discuss-phase 3 --auto',
      };
      const desc = buildIssueDescription(ctx);
      expect(desc).not.toContain('## Project Brief');
    });
  });

  describe('Planner role', () => {
    it('should include GSD_SIGNAL template with PLAN_COMPLETE', () => {
      const ctx: AgentContext = {
        role: 'planner',
        projectPath: '/projects/my-app',
        phaseNumber: 2,
        gsdCommand: '/gsd:plan-phase 2',
      };
      const desc = buildIssueDescription(ctx);
      expect(desc).toContain('GSD_SIGNAL:PLAN_COMPLETE');
      expect(desc).toContain('phase: 2');
    });
  });

  describe('Executor role', () => {
    it('should include GSD_SIGNAL template with EXECUTE_COMPLETE', () => {
      const ctx: AgentContext = {
        role: 'executor',
        projectPath: '/projects/my-app',
        phaseNumber: 2,
        gsdCommand: '/gsd:execute-phase 2',
      };
      const desc = buildIssueDescription(ctx);
      expect(desc).toContain('GSD_SIGNAL:EXECUTE_COMPLETE');
      expect(desc).toContain('phase: 2');
    });
  });

  describe('Verifier role', () => {
    it('should include GSD_SIGNAL template with VERIFY_COMPLETE', () => {
      const ctx: AgentContext = {
        role: 'verifier',
        projectPath: '/projects/my-app',
        phaseNumber: 2,
        gsdCommand: '/gsd:verify-work 2',
      };
      const desc = buildIssueDescription(ctx);
      expect(desc).toContain('GSD_SIGNAL:VERIFY_COMPLETE');
      expect(desc).toContain('phase: 2');
    });
  });

  describe('All roles', () => {
    it('should include exact GSD command to run', () => {
      const roles: AgentRole[] = [
        'ceo',
        'discusser',
        'planner',
        'executor',
        'verifier',
      ];
      for (const role of roles) {
        const ctx: AgentContext = {
          role,
          projectPath: '/projects/test',
          phaseNumber: role === 'ceo' ? undefined : 1,
          gsdCommand: `/gsd:${role}-command`,
          brief: role === 'ceo' ? 'Test brief' : undefined,
        };
        const desc = buildIssueDescription(ctx);
        expect(desc).toContain(`/gsd:${role}-command`);
      }
    });

    it('should include GSD_SIGNAL template that agent can copy', () => {
      const ctx: AgentContext = {
        role: 'planner',
        projectPath: '/projects/test',
        phaseNumber: 2,
        gsdCommand: '/gsd:plan-phase 2',
      };
      const desc = buildIssueDescription(ctx);
      // Should have the template format with --- delimiters
      expect(desc).toContain('---');
      expect(desc).toContain('GSD_SIGNAL:');
      expect(desc).toContain('phase:');
      expect(desc).toContain('status:');
      expect(desc).toContain('summary:');
    });
  });
});
