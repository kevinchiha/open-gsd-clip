/**
 * Health monitor for stale agent detection and hard timeouts.
 *
 * Tracks active agents and periodically checks for:
 * 1. Stale agents: no activity recorded for staleThresholdMs
 * 2. Hard timeouts: total elapsed time exceeds hardTimeoutMs
 *
 * When either condition is detected, the agent is untracked
 * (to prevent double-firing) and the onStale callback is invoked.
 *
 * Call destroy() to clean up all timers and prevent process hangs.
 */

import { createChildLogger } from '../shared/logger.js';
import type { HealthConfig } from './types.js';
import { DEFAULT_HEALTH_CONFIG } from './types.js';

const logger = createChildLogger('health-monitor');

interface TrackedAgent {
  issueId: string;
  runId: string;
  startedAt: number;
  lastActivityAt: number;
}

export class HealthMonitor {
  private readonly config: HealthConfig;
  private readonly onStale: (issueId: string, reason: string) => void;
  private readonly tracked = new Map<string, TrackedAgent>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    config: HealthConfig = DEFAULT_HEALTH_CONFIG,
    onStale: (issueId: string, reason: string) => void,
  ) {
    this.config = config;
    this.onStale = onStale;
  }

  /**
   * Start tracking an agent. Sets initial timestamps to now.
   */
  trackAgent(issueId: string, runId: string): void {
    const now = Date.now();
    this.tracked.set(issueId, {
      issueId,
      runId,
      startedAt: now,
      lastActivityAt: now,
    });
    logger.info({ issueId, runId }, 'Tracking agent health');
    this.ensureChecking();
  }

  /**
   * Record activity for a tracked agent. Resets the stale timer.
   */
  recordActivity(issueId: string): void {
    const agent = this.tracked.get(issueId);
    if (agent) {
      agent.lastActivityAt = Date.now();
    }
  }

  /**
   * Stop tracking an agent. Stops the check timer if no agents remain.
   */
  untrackAgent(issueId: string): void {
    this.tracked.delete(issueId);
    logger.info({ issueId }, 'Untracked agent');
    if (this.tracked.size === 0) {
      this.stopChecking();
    }
  }

  /**
   * Clean up all tracked agents and timers.
   * Must be called to prevent process hangs from dangling intervals.
   */
  destroy(): void {
    this.tracked.clear();
    this.stopChecking();
    logger.info('Health monitor destroyed');
  }

  /**
   * Returns the number of currently tracked agents (for testing).
   */
  getTrackedCount(): number {
    return this.tracked.size;
  }

  /**
   * Start the periodic check interval if not already running.
   */
  private ensureChecking(): void {
    if (this.timer === null) {
      this.timer = setInterval(() => {
        this.check();
      }, this.config.checkIntervalMs);
    }
  }

  /**
   * Stop the periodic check interval.
   */
  private stopChecking(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Check all tracked agents for stale or hard timeout conditions.
   * Agents are untracked BEFORE calling onStale to prevent double-firing.
   */
  private check(): void {
    const now = Date.now();

    // Collect agents to notify (untrack first, then notify)
    const staleAgents: Array<{ issueId: string; reason: string }> = [];

    for (const [issueId, agent] of this.tracked) {
      const totalElapsed = now - agent.startedAt;
      const sinceLastActivity = now - agent.lastActivityAt;

      // Hard timeout takes priority
      if (totalElapsed >= this.config.hardTimeoutMs) {
        staleAgents.push({
          issueId,
          reason: `hard timeout: agent running for ${Math.round(totalElapsed / 1_000)}s (limit: ${Math.round(this.config.hardTimeoutMs / 1_000)}s)`,
        });
      } else if (sinceLastActivity >= this.config.staleThresholdMs) {
        staleAgents.push({
          issueId,
          reason: `stale: no activity for ${Math.round(sinceLastActivity / 1_000)}s (threshold: ${Math.round(this.config.staleThresholdMs / 1_000)}s)`,
        });
      }
    }

    // Untrack and notify (untrack first to prevent double-fire)
    for (const { issueId, reason } of staleAgents) {
      this.tracked.delete(issueId);
      logger.warn({ issueId, reason }, 'Agent health check failed');
      this.onStale(issueId, reason);
    }

    // Stop checking if no agents remain
    if (this.tracked.size === 0) {
      this.stopChecking();
    }
  }
}
