/**
 * Tests for agent factory module.
 *
 * Tests the create-or-lookup pattern for GSD agents,
 * instruction file writing, and idempotent behavior.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ensureAgentsExist,
  getInstructionsDir,
  writeInstructionFile,
} from './factory.js';
import type { AgentDefinition, AgentRole, HostServices } from './types.js';
import { AGENT_ROLES } from './types.js';

// Mock fs module
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
}));

// Mock logger
vi.mock('../shared/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('getInstructionsDir', () => {
  it('should return path to ~/.open-gsd-clip/agents', () => {
    const dir = getInstructionsDir();
    const expected = path.join(os.homedir(), '.open-gsd-clip', 'agents');
    expect(dir).toBe(expected);
  });

  it('should create directory if it does not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    getInstructionsDir();
    expect(fs.mkdirSync).toHaveBeenCalledWith(
      path.join(os.homedir(), '.open-gsd-clip', 'agents'),
      { recursive: true },
    );
  });
});

describe('writeInstructionFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should write instruction file for each role', () => {
    for (const role of AGENT_ROLES) {
      const filePath = writeInstructionFile(role);
      expect(filePath).toContain('.open-gsd-clip');
      expect(filePath).toContain('agents');
      expect(filePath).toContain(`${role}.md`);
    }
  });

  it('should return absolute path', () => {
    const filePath = writeInstructionFile('ceo');
    expect(path.isAbsolute(filePath)).toBe(true);
  });
});

describe('ensureAgentsExist', () => {
  const createMockHostServices = (
    overrides: Partial<HostServices> = {},
  ): HostServices => ({
    agents: {
      invoke: vi
        .fn()
        .mockResolvedValue({ ok: true, value: { runId: 'run-1' } }),
    },
    issues: {
      create: vi.fn().mockResolvedValue({ ok: true, value: { id: 'issue-1' } }),
      createComment: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
      listComments: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    },
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.writeFileSync).mockReturnValue();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return all five agent definitions', async () => {
    const mockList = vi.fn().mockResolvedValue({
      ok: true,
      value: [] as AgentDefinition[],
    });
    const mockCreate = vi.fn().mockImplementation((params: { name: string }) =>
      Promise.resolve({
        ok: true,
        value: {
          agentId: `gsd-${params.name.toLowerCase().replace('gsd ', '')}`,
          role: params.name.toLowerCase().replace('gsd ', '') as AgentRole,
          name: params.name,
        } as AgentDefinition,
      }),
    );

    const services: HostServices = createMockHostServices({
      agents: {
        invoke: vi.fn(),
        list: mockList,
        create: mockCreate,
      },
    } as unknown as HostServices);

    const agents = await ensureAgentsExist(
      services,
      '/project/path',
      'company-123',
    );

    expect(Object.keys(agents)).toHaveLength(5);
    expect(agents).toHaveProperty('ceo');
    expect(agents).toHaveProperty('discusser');
    expect(agents).toHaveProperty('designer');
    expect(agents).toHaveProperty('planner');
    expect(agents).toHaveProperty('executor');
  });

  it('should be idempotent - return existing agents', async () => {
    const existingAgents: AgentDefinition[] = [
      {
        agentId: 'gsd-ceo',
        role: 'ceo',
        name: 'GSD CEO',
        companyId: 'company-123',
      },
      {
        agentId: 'gsd-discusser',
        role: 'discusser',
        name: 'GSD Discusser',
        companyId: 'company-123',
      },
      {
        agentId: 'gsd-designer',
        role: 'designer',
        name: 'GSD Designer',
        companyId: 'company-123',
      },
      {
        agentId: 'gsd-planner',
        role: 'planner',
        name: 'GSD Planner',
        companyId: 'company-123',
      },
      {
        agentId: 'gsd-executor',
        role: 'executor',
        name: 'GSD Executor',
        companyId: 'company-123',
      },
    ];

    const mockList = vi.fn().mockResolvedValue({
      ok: true,
      value: existingAgents,
    });
    const mockCreate = vi.fn();

    const services: HostServices = createMockHostServices({
      agents: {
        invoke: vi.fn(),
        list: mockList,
        create: mockCreate,
      },
    } as unknown as HostServices);

    const agents = await ensureAgentsExist(
      services,
      '/project/path',
      'company-123',
    );

    // Should not create any new agents
    expect(mockCreate).not.toHaveBeenCalled();
    expect(agents['ceo'].agentId).toBe('gsd-ceo');
  });

  it('should create missing agents only', async () => {
    const existingAgents: AgentDefinition[] = [
      {
        agentId: 'gsd-ceo',
        role: 'ceo',
        name: 'GSD CEO',
        companyId: 'company-123',
      },
    ];

    const mockList = vi.fn().mockResolvedValue({
      ok: true,
      value: existingAgents,
    });
    const mockCreate = vi
      .fn()
      .mockImplementation(
        (params: { name: string; adapterConfig: { cwd: string } }) =>
          Promise.resolve({
            ok: true,
            value: {
              agentId: `gsd-${params.name.toLowerCase().replace('gsd ', '')}`,
              role: params.name.toLowerCase().replace('gsd ', '') as AgentRole,
              name: params.name,
              companyId: 'company-123',
            } as AgentDefinition,
          }),
      );

    const services: HostServices = createMockHostServices({
      agents: {
        invoke: vi.fn(),
        list: mockList,
        create: mockCreate,
      },
    } as unknown as HostServices);

    const agents = await ensureAgentsExist(
      services,
      '/project/path',
      'company-123',
    );

    // Should create 4 agents (discusser, designer, planner, executor)
    expect(mockCreate).toHaveBeenCalledTimes(4);
    expect(agents['ceo'].agentId).toBe('gsd-ceo'); // existing
  });

  it('should use stable agent naming: gsd-{role}', async () => {
    const mockList = vi.fn().mockResolvedValue({
      ok: true,
      value: [] as AgentDefinition[],
    });

    const createdAgents: Array<{ name: string }> = [];
    const mockCreate = vi
      .fn()
      .mockImplementation((params: { name: string }) => {
        createdAgents.push({ name: params.name });
        return Promise.resolve({
          ok: true,
          value: {
            agentId: `gsd-${params.name.toLowerCase().replace('gsd ', '')}`,
            role: params.name.toLowerCase().replace('gsd ', '') as AgentRole,
            name: params.name,
          } as AgentDefinition,
        });
      });

    const services: HostServices = createMockHostServices({
      agents: {
        invoke: vi.fn(),
        list: mockList,
        create: mockCreate,
      },
    } as unknown as HostServices);

    await ensureAgentsExist(services, '/project/path', 'company-123');

    const names = createdAgents.map((a) => a.name);
    expect(names).toContain('GSD CEO');
    expect(names).toContain('GSD Discusser');
    expect(names).toContain('GSD Designer');
    expect(names).toContain('GSD Planner');
    expect(names).toContain('GSD Executor');
  });

  it('should set correct adapterConfig with cwd and instructionsFilePath', async () => {
    const mockList = vi.fn().mockResolvedValue({
      ok: true,
      value: [] as AgentDefinition[],
    });

    const createCalls: Array<{
      adapterConfig: { cwd: string; instructionsFilePath: string };
    }> = [];
    const mockCreate = vi
      .fn()
      .mockImplementation(
        (params: {
          adapterConfig: { cwd: string; instructionsFilePath: string };
          name: string;
        }) => {
          createCalls.push({ adapterConfig: params.adapterConfig });
          return Promise.resolve({
            ok: true,
            value: {
              agentId: `gsd-${params.name.toLowerCase().replace('gsd ', '')}`,
              role: params.name.toLowerCase().replace('gsd ', '') as AgentRole,
              name: params.name,
            } as AgentDefinition,
          });
        },
      );

    const services: HostServices = createMockHostServices({
      agents: {
        invoke: vi.fn(),
        list: mockList,
        create: mockCreate,
      },
    } as unknown as HostServices);

    await ensureAgentsExist(services, '/my/project', 'company-123');

    // All agents should have correct cwd
    for (const call of createCalls) {
      expect(call.adapterConfig.cwd).toBe('/my/project');
      expect(call.adapterConfig.instructionsFilePath).toContain(
        '.open-gsd-clip/agents/',
      );
      expect(call.adapterConfig.instructionsFilePath).toMatch(/\.(md|txt)$/);
    }
  });
});
