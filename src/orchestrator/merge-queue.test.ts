/**
 * Tests for MergeQueue.
 *
 * Verifies ordered merge queueing: phases merge in roadmap order
 * regardless of completion order, with skip-on-failure for failed phases.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../shared/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { MergeQueue } from './merge-queue.js';

describe('MergeQueue', () => {
  let onMerge: ReturnType<typeof vi.fn>;
  let mergeOrder: number[];

  beforeEach(() => {
    vi.clearAllMocks();
    onMerge = vi.fn().mockResolvedValue(undefined);
    mergeOrder = [];
  });

  describe('in-order enqueue', () => {
    it('merges phases immediately when enqueued in order', async () => {
      mergeOrder = [1, 2, 3];
      const queue = new MergeQueue(mergeOrder, onMerge);

      await queue.enqueue(1);
      await queue.enqueue(2);
      await queue.enqueue(3);

      expect(onMerge).toHaveBeenCalledTimes(3);
      expect(onMerge.mock.calls.map((c: unknown[]) => c[0])).toEqual([1, 2, 3]);
    });
  });

  describe('out-of-order completion', () => {
    it('enqueue(3) then enqueue(1) then enqueue(2) merges in order [1, 2, 3]', async () => {
      mergeOrder = [1, 2, 3];
      const queue = new MergeQueue(mergeOrder, onMerge);

      await queue.enqueue(3);
      expect(onMerge).not.toHaveBeenCalled();

      await queue.enqueue(1);
      expect(onMerge).toHaveBeenCalledTimes(1);
      expect(onMerge).toHaveBeenCalledWith(1);

      await queue.enqueue(2);
      expect(onMerge).toHaveBeenCalledTimes(3);
      expect(onMerge.mock.calls.map((c: unknown[]) => c[0])).toEqual([1, 2, 3]);
    });
  });

  describe('skip-on-failure', () => {
    it('markFailed(2) skips phase 2 -- merges [1, 3]', async () => {
      mergeOrder = [1, 2, 3];
      const queue = new MergeQueue(mergeOrder, onMerge);

      await queue.markFailed(2);
      expect(onMerge).not.toHaveBeenCalled();

      await queue.enqueue(1);
      // Phase 1 merges, then phase 2 is skipped, phase 3 not yet ready
      expect(onMerge).toHaveBeenCalledTimes(1);
      expect(onMerge).toHaveBeenCalledWith(1);

      await queue.enqueue(3);
      expect(onMerge).toHaveBeenCalledTimes(2);
      expect(onMerge.mock.calls.map((c: unknown[]) => c[0])).toEqual([1, 3]);
    });
  });

  describe('isComplete', () => {
    it('returns false until all phases merged or skipped', async () => {
      mergeOrder = [1, 2];
      const queue = new MergeQueue(mergeOrder, onMerge);

      expect(queue.isComplete()).toBe(false);

      await queue.enqueue(1);
      expect(queue.isComplete()).toBe(false);

      await queue.enqueue(2);
      expect(queue.isComplete()).toBe(true);
    });

    it('returns true after all phases are merged', async () => {
      mergeOrder = [1, 2, 3];
      const queue = new MergeQueue(mergeOrder, onMerge);

      await queue.enqueue(1);
      await queue.enqueue(2);
      await queue.enqueue(3);

      expect(queue.isComplete()).toBe(true);
    });
  });

  describe('empty mergeOrder', () => {
    it('isComplete returns true immediately', () => {
      const queue = new MergeQueue([], onMerge);
      expect(queue.isComplete()).toBe(true);
    });
  });

  describe('single phase', () => {
    it('enqueue works correctly and isComplete becomes true', async () => {
      mergeOrder = [5];
      const queue = new MergeQueue(mergeOrder, onMerge);

      expect(queue.isComplete()).toBe(false);

      await queue.enqueue(5);

      expect(onMerge).toHaveBeenCalledTimes(1);
      expect(onMerge).toHaveBeenCalledWith(5);
      expect(queue.isComplete()).toBe(true);
    });
  });

  describe('markFailed edge cases', () => {
    it('markFailed for phase not in mergeOrder is a no-op', async () => {
      mergeOrder = [1, 2];
      const queue = new MergeQueue(mergeOrder, onMerge);

      await expect(queue.markFailed(99)).resolves.toBeUndefined();
      expect(onMerge).not.toHaveBeenCalled();
    });

    it('markFailed all phases makes isComplete true', async () => {
      mergeOrder = [1, 2, 3];
      const queue = new MergeQueue(mergeOrder, onMerge);

      await queue.markFailed(1);
      await queue.markFailed(2);
      await queue.markFailed(3);

      expect(queue.isComplete()).toBe(true);
      expect(onMerge).not.toHaveBeenCalled();
    });
  });
});
