import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GsdToolsNotFoundError } from './errors.js';
import { discoverGsdToolsPath } from './discovery.js';

// Mock fs, os, and the logger to control discovery behavior
vi.mock('node:fs');
vi.mock('../shared/logger.js', () => ({
  createChildLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('discoverGsdToolsPath', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns GSD_TOOLS_PATH env var value when set and file exists', () => {
    const customPath = '/custom/path/gsd-tools.cjs';
    process.env.GSD_TOOLS_PATH = customPath;
    vi.mocked(fs.existsSync).mockImplementation((p) => p === customPath);

    const result = discoverGsdToolsPath();
    expect(result).toBe(customPath);
  });

  it('falls back to default path when env var not set', () => {
    delete process.env.GSD_TOOLS_PATH;
    const defaultPath = path.join(os.homedir(), '.claude', 'get-shit-done', 'bin', 'gsd-tools.cjs');
    vi.mocked(fs.existsSync).mockImplementation((p) => p === defaultPath);

    const result = discoverGsdToolsPath();
    expect(result).toBe(defaultPath);
  });

  it('falls back to default path when env var set but file missing', () => {
    process.env.GSD_TOOLS_PATH = '/nonexistent/gsd-tools.cjs';
    const defaultPath = path.join(os.homedir(), '.claude', 'get-shit-done', 'bin', 'gsd-tools.cjs');
    vi.mocked(fs.existsSync).mockImplementation((p) => p === defaultPath);

    const result = discoverGsdToolsPath();
    expect(result).toBe(defaultPath);
  });

  it('throws GsdToolsNotFoundError when nothing found', () => {
    delete process.env.GSD_TOOLS_PATH;
    vi.mocked(fs.existsSync).mockReturnValue(false);

    expect(() => discoverGsdToolsPath()).toThrow(GsdToolsNotFoundError);
  });

  it('error includes all searched paths', () => {
    delete process.env.GSD_TOOLS_PATH;
    vi.mocked(fs.existsSync).mockReturnValue(false);

    try {
      discoverGsdToolsPath();
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(GsdToolsNotFoundError);
      const notFoundError = error as GsdToolsNotFoundError;
      // Should have at least 2 paths: default path + package resolve attempt
      expect(notFoundError.searchedPaths.length).toBeGreaterThanOrEqual(2);
      // Default path should be included
      const defaultPath = path.join(
        os.homedir(),
        '.claude',
        'get-shit-done',
        'bin',
        'gsd-tools.cjs',
      );
      expect(notFoundError.searchedPaths).toContain(defaultPath);
      // Message should include "not found"
      expect(notFoundError.message).toContain('not found');
    }
  });

  it('error hierarchy is correct', () => {
    delete process.env.GSD_TOOLS_PATH;
    vi.mocked(fs.existsSync).mockReturnValue(false);

    try {
      discoverGsdToolsPath();
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(GsdToolsNotFoundError);
      expect(error).toBeInstanceOf(Error);
      const e = error as GsdToolsNotFoundError;
      expect(e.command).toBe('tool-discovery');
      expect(e.name).toBe('GsdToolsNotFoundError');
    }
  });
});
