/**
 * Tests for WorktreeManager.
 *
 * Verifies git worktree lifecycle: create, merge, remove, prune, cleanup.
 * Uses vi.mock to mock execa and fs at the module level.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('execa', () => ({
  execa: vi.fn().mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 }),
}));

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../shared/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { execa } from 'execa';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { WorktreeManager } from './worktree-manager.js';

// Use Mock type to avoid execa's complex ResultPromise types in test assertions
const mockedExeca = execa as unknown as Mock;
const mockedMkdir = vi.mocked(fs.mkdir);

const PROJECT_PATH = '/home/user/my-project';
const WORKTREE_BASE = path.join(path.dirname(PROJECT_PATH), '.gsd-worktrees');

/** Helper to find a call by git subcommand in mock.calls */
function findCall(
  calls: unknown[][],
  ...subcommands: string[]
): unknown[] | undefined {
  return calls.find(
    (call) =>
      call[0] === 'git' &&
      subcommands.every((sc) => (call[1] as string[]).includes(sc)),
  );
}

describe('WorktreeManager', () => {
  let manager: WorktreeManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedExeca.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
    manager = new WorktreeManager(PROJECT_PATH);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createWorktree', () => {
    it('creates worktreeBase directory with recursive:true', async () => {
      mockedExeca.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

      await manager.createWorktree(3);

      expect(mockedMkdir).toHaveBeenCalledWith(WORKTREE_BASE, {
        recursive: true,
      });
    });

    it('calls git worktree add -b with correct args and cwd', async () => {
      mockedExeca.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

      await manager.createWorktree(3);

      const call = findCall(mockedExeca.mock.calls, 'worktree', 'add');
      expect(call).toBeDefined();
      expect(call![1]).toEqual([
        'worktree',
        'add',
        '-b',
        'gsd/phase-3',
        path.join(WORKTREE_BASE, 'phase-3'),
      ]);
      expect(call![2]).toEqual(expect.objectContaining({ cwd: PROJECT_PATH }));
    });

    it('checks for existing branch via git branch --list before creating', async () => {
      mockedExeca.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

      await manager.createWorktree(5);

      const call = findCall(mockedExeca.mock.calls, 'branch', '--list');
      expect(call).toBeDefined();
      expect(call![1]).toEqual(['branch', '--list', 'gsd/phase-5']);
    });

    it('cleans up stale branch/worktree if branch already exists', async () => {
      let callIndex = 0;
      mockedExeca.mockImplementation(async () => {
        callIndex++;
        if (callIndex === 1) {
          // git branch --list returns branch name (exists)
          return { stdout: '  gsd/phase-2', stderr: '', exitCode: 0 };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      });

      await manager.createWorktree(2);

      const worktreeRemoveCall = findCall(
        mockedExeca.mock.calls,
        'worktree',
        'remove',
      );
      const branchDeleteCall = findCall(
        mockedExeca.mock.calls,
        'branch',
        '-D',
      );
      expect(worktreeRemoveCall).toBeDefined();
      expect(branchDeleteCall).toBeDefined();
    });

    it('returns WorktreeInfo with correct fields', async () => {
      mockedExeca.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

      const info = await manager.createWorktree(7);

      expect(info).toEqual({
        phaseNumber: 7,
        branchName: 'gsd/phase-7',
        worktreePath: path.join(WORKTREE_BASE, 'phase-7'),
      });
    });
  });

  describe('mergePhase', () => {
    it('calls git merge --no-ff with correct args and cwd=projectPath', async () => {
      mockedExeca.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

      await manager.createWorktree(1);
      vi.clearAllMocks();
      mockedExeca.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

      await manager.mergePhase(1);

      expect(mockedExeca).toHaveBeenCalledWith(
        'git',
        ['merge', '--no-ff', '-m', 'Merge phase 1', 'gsd/phase-1'],
        expect.objectContaining({ cwd: PROJECT_PATH }),
      );
    });

    it('throws Error if phaseNumber not in activeWorktrees', async () => {
      await expect(manager.mergePhase(99)).rejects.toThrow(
        'No worktree for phase 99',
      );
    });
  });

  describe('removeWorktree', () => {
    it('calls git worktree remove then git branch -d', async () => {
      mockedExeca.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

      await manager.createWorktree(4);
      vi.clearAllMocks();
      mockedExeca.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

      await manager.removeWorktree(4);

      const worktreeRemove = findCall(
        mockedExeca.mock.calls,
        'worktree',
        'remove',
      );
      const branchDelete = findCall(mockedExeca.mock.calls, 'branch', '-d');

      expect(worktreeRemove).toBeDefined();
      expect(worktreeRemove![1]).toContain('--force');
      expect(branchDelete).toBeDefined();
      expect(branchDelete![1]).toEqual(['branch', '-d', 'gsd/phase-4']);
    });

    it('is a no-op (no throw) for unknown phaseNumber', async () => {
      await expect(manager.removeWorktree(999)).resolves.toBeUndefined();
      expect(mockedExeca).not.toHaveBeenCalled();
    });
  });

  describe('getWorkingDirectory', () => {
    it('returns worktree path for tracked phase', async () => {
      mockedExeca.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

      await manager.createWorktree(2);

      expect(manager.getWorkingDirectory(2)).toBe(
        path.join(WORKTREE_BASE, 'phase-2'),
      );
    });

    it('returns projectPath for untracked phase', () => {
      expect(manager.getWorkingDirectory(99)).toBe(PROJECT_PATH);
    });
  });

  describe('pruneStaleWorktrees', () => {
    it('calls git worktree prune', async () => {
      mockedExeca.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

      await manager.pruneStaleWorktrees();

      const pruneCall = findCall(
        mockedExeca.mock.calls,
        'worktree',
        'prune',
      );
      expect(pruneCall).toBeDefined();
      expect(pruneCall![2]).toEqual(
        expect.objectContaining({ cwd: PROJECT_PATH }),
      );
    });

    it('lists and deletes leftover gsd/phase-* branches', async () => {
      let callCount = 0;
      mockedExeca.mockImplementation(async () => {
        callCount++;
        if (callCount === 2) {
          // git branch --list gsd/phase-* returns stale branches
          return {
            stdout: '  gsd/phase-1\n  gsd/phase-3\n',
            stderr: '',
            exitCode: 0,
          };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      });

      await manager.pruneStaleWorktrees();

      const branchDeleteCalls = mockedExeca.mock.calls.filter(
        (call: unknown[]) =>
          call[0] === 'git' &&
          (call[1] as string[]).includes('branch') &&
          (call[1] as string[]).includes('-D'),
      );
      expect(branchDeleteCalls.length).toBe(2);
    });
  });

  describe('cleanupAll', () => {
    it('removes all active worktrees', async () => {
      mockedExeca.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

      await manager.createWorktree(1);
      await manager.createWorktree(2);
      vi.clearAllMocks();
      mockedExeca.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

      await manager.cleanupAll();

      // Should have called git worktree remove for both phases
      const worktreeRemoveCalls = mockedExeca.mock.calls.filter(
        (call: unknown[]) =>
          call[0] === 'git' &&
          (call[1] as string[]).includes('worktree') &&
          (call[1] as string[]).includes('remove'),
      );
      expect(worktreeRemoveCalls.length).toBe(2);
    });

    it('catches and logs individual failures without throwing', async () => {
      mockedExeca.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

      await manager.createWorktree(1);
      vi.clearAllMocks();

      // Make removal fail
      mockedExeca.mockRejectedValue(new Error('removal failed'));

      // Should not throw
      await expect(manager.cleanupAll()).resolves.toBeUndefined();
    });
  });

  describe('hasParallelPhases', () => {
    it('returns false when no active worktrees', () => {
      expect(manager.hasParallelPhases()).toBe(false);
    });

    it('returns false when only one active worktree', async () => {
      mockedExeca.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

      await manager.createWorktree(1);

      expect(manager.hasParallelPhases()).toBe(false);
    });

    it('returns true when more than one active worktree', async () => {
      mockedExeca.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });

      await manager.createWorktree(1);
      await manager.createWorktree(2);

      expect(manager.hasParallelPhases()).toBe(true);
    });
  });
});
