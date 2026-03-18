/**
 * Tests for SerialEventQueue.
 *
 * Verifies that async event handlers execute serially (one at a time),
 * in enqueue order, with error isolation between handlers.
 */

import { describe, expect, it } from 'vitest';
import { SerialEventQueue } from './event-queue.js';

describe('SerialEventQueue', () => {
  describe('serial execution', () => {
    it('processes handlers in enqueue order', async () => {
      const queue = new SerialEventQueue();
      const order: number[] = [];

      const delay = (ms: number) =>
        new Promise<void>((r) => setTimeout(r, ms));

      const p1 = queue.enqueue(async () => {
        await delay(30);
        order.push(1);
      });
      const p2 = queue.enqueue(async () => {
        await delay(10);
        order.push(2);
      });
      const p3 = queue.enqueue(async () => {
        await delay(20);
        order.push(3);
      });

      await Promise.all([p1, p2, p3]);

      expect(order).toEqual([1, 2, 3]);
    });
  });

  describe('error isolation', () => {
    it('rejects the failing handler but resolves subsequent handlers', async () => {
      const queue = new SerialEventQueue();

      const p1 = queue.enqueue(async () => {
        throw new Error('boom');
      });
      const p2 = queue.enqueue(async () => {
        // succeeds
      });

      await expect(p1).rejects.toThrow('boom');
      await expect(p2).resolves.toBeUndefined();
    });
  });

  describe('concurrent enqueue', () => {
    it('serializes multiple concurrent enqueue calls', async () => {
      const queue = new SerialEventQueue();
      const order: number[] = [];

      // Fire all without awaiting between them
      const promises = [1, 2, 3, 4, 5].map((n) =>
        queue.enqueue(async () => {
          order.push(n);
        }),
      );

      await Promise.all(promises);

      expect(order).toEqual([1, 2, 3, 4, 5]);
    });
  });

  describe('empty queue', () => {
    it('resolves immediately for a single handler', async () => {
      const queue = new SerialEventQueue();
      let executed = false;

      await queue.enqueue(async () => {
        executed = true;
      });

      expect(executed).toBe(true);
    });
  });
});
