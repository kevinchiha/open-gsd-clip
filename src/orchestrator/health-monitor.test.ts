/**
 * Tests for the health monitor stale agent detection.
 *
 * Uses fake timers for deterministic time control.
 * Verifies stale detection thresholds, hard timeouts,
 * agent tracking lifecycle, and cleanup behavior.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HealthMonitor } from './health-monitor.js';
import type { HealthConfig } from './types.js';

// Mock logger to prevent pino output in tests
vi.mock('../shared/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const TEST_CONFIG: HealthConfig = {
  staleThresholdMs: 5_000, // 5 seconds (fast for tests)
  hardTimeoutMs: 15_000, // 15 seconds
  checkIntervalMs: 1_000, // 1 second
};

describe('HealthMonitor', () => {
  let onStale: ReturnType<typeof vi.fn>;
  let monitor: HealthMonitor;

  beforeEach(() => {
    vi.useFakeTimers();
    onStale = vi.fn();
    monitor = new HealthMonitor(TEST_CONFIG, onStale);
  });

  afterEach(() => {
    monitor.destroy();
    vi.useRealTimers();
  });

  describe('trackAgent', () => {
    it('adds agent to tracking', () => {
      monitor.trackAgent('issue-1', 'run-1');
      expect(monitor.getTrackedCount()).toBe(1);
    });

    it('tracks multiple agents', () => {
      monitor.trackAgent('issue-1', 'run-1');
      monitor.trackAgent('issue-2', 'run-2');
      monitor.trackAgent('issue-3', 'run-3');
      expect(monitor.getTrackedCount()).toBe(3);
    });
  });

  describe('recordActivity', () => {
    it('updates timestamp and prevents stale detection', () => {
      monitor.trackAgent('issue-1', 'run-1');

      // Advance 4 seconds (under threshold), record activity
      vi.advanceTimersByTime(4_000);
      monitor.recordActivity('issue-1');

      // Advance another 4 seconds (total 8s, but only 4s since last activity)
      vi.advanceTimersByTime(4_000);

      // Should not be stale since last activity was 4s ago (< 5s threshold)
      expect(onStale).not.toHaveBeenCalled();
    });
  });

  describe('stale detection', () => {
    it('fires callback when agent exceeds stale threshold', () => {
      monitor.trackAgent('issue-1', 'run-1');

      // Advance past stale threshold (5s) + one check interval
      vi.advanceTimersByTime(6_000);

      expect(onStale).toHaveBeenCalledTimes(1);
      expect(onStale).toHaveBeenCalledWith('issue-1', expect.stringContaining('stale'));
    });

    it('does not fire before stale threshold', () => {
      monitor.trackAgent('issue-1', 'run-1');

      // Advance to just before threshold
      vi.advanceTimersByTime(4_500);

      expect(onStale).not.toHaveBeenCalled();
    });
  });

  describe('hard timeout', () => {
    it('fires callback when total elapsed exceeds hard timeout', () => {
      monitor.trackAgent('issue-1', 'run-1');

      // Keep recording activity to prevent stale detection
      for (let t = 0; t < 14; t++) {
        vi.advanceTimersByTime(1_000);
        monitor.recordActivity('issue-1');
      }

      // Now advance past hard timeout (15s total from start)
      vi.advanceTimersByTime(2_000);

      expect(onStale).toHaveBeenCalledTimes(1);
      expect(onStale).toHaveBeenCalledWith('issue-1', expect.stringContaining('timeout'));
    });
  });

  describe('untrackAgent', () => {
    it('removes agent from tracking', () => {
      monitor.trackAgent('issue-1', 'run-1');
      monitor.trackAgent('issue-2', 'run-2');
      expect(monitor.getTrackedCount()).toBe(2);

      monitor.untrackAgent('issue-1');
      expect(monitor.getTrackedCount()).toBe(1);
    });

    it('stops timer when no agents are tracked', () => {
      monitor.trackAgent('issue-1', 'run-1');
      monitor.untrackAgent('issue-1');

      // Advance well past thresholds -- should not fire since no agents tracked
      vi.advanceTimersByTime(30_000);
      expect(onStale).not.toHaveBeenCalled();
    });
  });

  describe('destroy', () => {
    it('clears all tracked agents and timers', () => {
      monitor.trackAgent('issue-1', 'run-1');
      monitor.trackAgent('issue-2', 'run-2');
      monitor.trackAgent('issue-3', 'run-3');

      monitor.destroy();

      expect(monitor.getTrackedCount()).toBe(0);

      // Advance well past thresholds -- should not fire after destroy
      vi.advanceTimersByTime(30_000);
      expect(onStale).not.toHaveBeenCalled();
    });
  });

  describe('no double-fire', () => {
    it('does not fire for same agent after stale already triggered', () => {
      monitor.trackAgent('issue-1', 'run-1');

      // Advance past stale threshold
      vi.advanceTimersByTime(6_000);
      expect(onStale).toHaveBeenCalledTimes(1);

      // Advance more -- should not fire again for same agent
      vi.advanceTimersByTime(30_000);
      expect(onStale).toHaveBeenCalledTimes(1);
    });
  });
});
