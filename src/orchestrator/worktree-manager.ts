/**
 * Git worktree lifecycle management for parallel phase execution.
 *
 * Wraps git CLI commands via execa to create, merge, remove, and prune
 * worktrees. Each parallel phase gets its own worktree with a unique
 * branch (gsd/phase-{N}) for isolation.
 */

import { execa } from 'execa';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createChildLogger } from '../shared/logger.js';

const log = createChildLogger('worktree-manager');

/**
 * Information about an active worktree for a phase.
 */
export interface WorktreeInfo {
  phaseNumber: number;
  branchName: string;
  worktreePath: string;
}

/**
 * Manages git worktree lifecycle for parallel phase execution.
 *
 * - Creates worktrees with unique branches per phase
 * - Merges phase branches back into main with --no-ff
 * - Removes worktrees and cleans up branches
 * - Prunes stale worktrees from interrupted runs
 */
export class WorktreeManager {
  private readonly projectPath: string;
  private readonly worktreeBase: string;
  private readonly activeWorktrees = new Map<number, WorktreeInfo>();

  constructor(projectPath: string) {
    this.projectPath = projectPath;
    // Place worktrees alongside the project to avoid nesting
    this.worktreeBase = path.join(
      path.dirname(projectPath),
      '.gsd-worktrees',
    );
  }

  /**
   * Create a worktree for a phase, branching from current HEAD.
   * Handles pre-existing branches by cleaning them up first.
   */
  async createWorktree(phaseNumber: number): Promise<WorktreeInfo> {
    const branchName = `gsd/phase-${phaseNumber}`;
    const worktreePath = path.join(this.worktreeBase, `phase-${phaseNumber}`);

    // Check for existing branch (stale from interrupted run)
    const { stdout } = await execa(
      'git',
      ['branch', '--list', branchName],
      { cwd: this.projectPath },
    );

    if (stdout.trim()) {
      log.info({ phaseNumber, branchName }, 'Stale branch found, cleaning up');
      // Remove stale worktree and branch
      await execa(
        'git',
        ['worktree', 'remove', worktreePath, '--force'],
        { cwd: this.projectPath },
      ).catch(() => {
        // Worktree may not exist even though branch does
      });
      await execa(
        'git',
        ['branch', '-D', branchName],
        { cwd: this.projectPath },
      ).catch(() => {
        // Branch deletion may fail if locked
      });
    }

    // Ensure base directory exists
    await fs.mkdir(this.worktreeBase, { recursive: true });

    // Create worktree with new branch from HEAD
    await execa(
      'git',
      ['worktree', 'add', '-b', branchName, worktreePath],
      { cwd: this.projectPath },
    );

    const info: WorktreeInfo = { phaseNumber, branchName, worktreePath };
    this.activeWorktrees.set(phaseNumber, info);

    log.info({ phaseNumber, branchName, worktreePath }, 'Worktree created');
    return info;
  }

  /**
   * Merge a phase branch into main in the main worktree.
   * Throws if no worktree exists for the given phase.
   */
  async mergePhase(phaseNumber: number): Promise<void> {
    const info = this.activeWorktrees.get(phaseNumber);
    if (!info) {
      throw new Error(`No worktree for phase ${phaseNumber}`);
    }

    await execa(
      'git',
      ['merge', '--no-ff', '-m', `Merge phase ${phaseNumber}`, info.branchName],
      { cwd: this.projectPath },
    );

    log.info({ phaseNumber, branchName: info.branchName }, 'Phase merged');
  }

  /**
   * Remove a worktree and delete its branch.
   * No-op if the phase is not tracked (no throw).
   */
  async removeWorktree(phaseNumber: number): Promise<void> {
    const info = this.activeWorktrees.get(phaseNumber);
    if (!info) return;

    try {
      await execa(
        'git',
        ['worktree', 'remove', info.worktreePath, '--force'],
        { cwd: this.projectPath },
      );
    } catch {
      // Worktree may already be removed
    }

    try {
      await execa(
        'git',
        ['branch', '-d', info.branchName],
        { cwd: this.projectPath },
      );
    } catch {
      // Branch may already be deleted
    }

    this.activeWorktrees.delete(phaseNumber);
    log.info({ phaseNumber }, 'Worktree removed');
  }

  /**
   * Get the working directory for a phase.
   * Returns the worktree path if the phase has an active worktree,
   * otherwise returns the main project path.
   */
  getWorkingDirectory(phaseNumber: number): string {
    const info = this.activeWorktrees.get(phaseNumber);
    return info?.worktreePath ?? this.projectPath;
  }

  /**
   * Prune stale worktrees and delete leftover gsd/phase-* branches.
   * Should be called on startup to clean up from interrupted runs.
   */
  async pruneStaleWorktrees(): Promise<void> {
    await execa('git', ['worktree', 'prune'], { cwd: this.projectPath });
    log.info('Pruned stale worktrees');

    // Clean up leftover gsd/phase-* branches not in active worktrees
    const { stdout } = await execa(
      'git',
      ['branch', '--list', 'gsd/phase-*'],
      { cwd: this.projectPath },
    );

    const staleBranches = stdout
      .split('\n')
      .map((b) => b.trim())
      .filter(Boolean);

    for (const branch of staleBranches) {
      await execa(
        'git',
        ['branch', '-D', branch],
        { cwd: this.projectPath },
      ).catch(() => {
        // Ignore -- branch might be in use by an active worktree
      });
    }
  }

  /**
   * Remove all active worktrees. Catches and logs individual failures
   * to ensure best-effort cleanup.
   */
  async cleanupAll(): Promise<void> {
    const phases = [...this.activeWorktrees.keys()];
    for (const phaseNumber of phases) {
      await this.removeWorktree(phaseNumber).catch((err: unknown) => {
        log.warn({ phaseNumber, err }, 'Failed to cleanup worktree');
      });
    }
  }

  /**
   * Returns true if more than one worktree is active (parallel execution).
   */
  hasParallelPhases(): boolean {
    return this.activeWorktrees.size > 1;
  }
}
