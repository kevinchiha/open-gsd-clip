import { describe, expect, it, vi } from 'vitest';
import { GsdBridgeError, GsdParseError, GsdTimeoutError, GsdToolsNotFoundError } from './errors.js';
import { executeGsdCommand } from './executor.js';

// Mock execa
vi.mock('execa', () => ({
  execa: vi.fn(),
}));

// Mock logger
vi.mock('../shared/logger.js', () => ({
  createChildLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Import mocked execa after mock setup
const { execa } = await import('execa');
const mockedExeca = vi.mocked(execa);

describe('executeGsdCommand', () => {
  it('successful command returns parsed JSON', async () => {
    const expected = { phases: [{ number: '1', name: 'Setup' }], phase_count: 1 };
    mockedExeca.mockResolvedValueOnce({
      stdout: JSON.stringify(expected),
      stderr: '',
      exitCode: 0,
    } as Awaited<ReturnType<typeof execa>>);

    const result = await executeGsdCommand('/path/to/gsd-tools.cjs', 'roadmap', ['analyze'], '/tmp');
    expect(result).toEqual(expected);
  });

  it('timeout produces GsdTimeoutError', async () => {
    const error = Object.assign(new Error('timed out'), {
      timedOut: true,
      code: undefined,
      killed: true,
    });
    mockedExeca.mockRejectedValueOnce(error);

    try {
      await executeGsdCommand('/path/to/gsd-tools.cjs', 'roadmap', ['analyze'], '/tmp', 5000);
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(GsdTimeoutError);
      expect((e as GsdTimeoutError).timeoutMs).toBe(5000);
      expect((e as GsdTimeoutError).command).toBe('roadmap analyze');
    }
  });

  it('ENOENT produces GsdToolsNotFoundError', async () => {
    const error = Object.assign(new Error('ENOENT'), {
      timedOut: false,
      code: 'ENOENT',
    });
    mockedExeca.mockRejectedValueOnce(error);

    await expect(
      executeGsdCommand('/missing/gsd-tools.cjs', 'roadmap', ['analyze'], '/tmp'),
    ).rejects.toThrow(GsdToolsNotFoundError);
  });

  it('non-JSON stdout produces GsdParseError', async () => {
    mockedExeca.mockResolvedValueOnce({
      stdout: 'This is not JSON at all',
      stderr: '',
      exitCode: 0,
    } as Awaited<ReturnType<typeof execa>>);

    await expect(
      executeGsdCommand('/path/to/gsd-tools.cjs', 'state', ['json'], '/tmp'),
    ).rejects.toThrow(GsdParseError);

    try {
      mockedExeca.mockResolvedValueOnce({
        stdout: 'not json',
        stderr: '',
        exitCode: 0,
      } as Awaited<ReturnType<typeof execa>>);
      await executeGsdCommand('/path/to/gsd-tools.cjs', 'state', ['json'], '/tmp');
    } catch (e) {
      expect(e).toBeInstanceOf(GsdParseError);
      expect((e as GsdParseError).rawOutput).toBe('not json');
    }
  });

  it('other errors produce GsdBridgeError', async () => {
    const error = Object.assign(new Error('permission denied'), {
      timedOut: false,
      code: 'EACCES',
    });
    mockedExeca.mockRejectedValueOnce(error);

    await expect(
      executeGsdCommand('/path/to/gsd-tools.cjs', 'roadmap', ['analyze'], '/tmp'),
    ).rejects.toThrow(GsdBridgeError);
  });

  it('passes correct arguments to execa', async () => {
    mockedExeca.mockResolvedValueOnce({
      stdout: '{}',
      stderr: '',
      exitCode: 0,
    } as Awaited<ReturnType<typeof execa>>);

    await executeGsdCommand('/path/to/gsd-tools.cjs', 'roadmap', ['get-phase', '1'], '/my/project', 10_000);

    expect(mockedExeca).toHaveBeenCalledWith(
      'node',
      ['/path/to/gsd-tools.cjs', 'roadmap', 'get-phase', '1'],
      { cwd: '/my/project', timeout: 10_000 },
    );
  });
});
