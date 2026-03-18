/**
 * Ordered merge queue for parallel phase execution.
 *
 * Ensures completed parallel phases merge into main in roadmap order
 * regardless of completion order. Failed phases are skipped to prevent
 * deadlock in the merge queue.
 */

import { createChildLogger } from '../shared/logger.js';

const log = createChildLogger('merge-queue');

/**
 * Manages ordered merging of completed phase branches.
 *
 * When a phase completes, it is enqueued. The queue drains in mergeOrder
 * sequence: if phase 3 finishes before phase 1, phase 3 waits until
 * phase 1 has been merged first.
 *
 * Failed phases can be marked as skipped so they don't block subsequent
 * merges in the queue.
 */
export class MergeQueue {
  /** Phases that have completed and are waiting to merge. */
  private readonly completed = new Set<number>();
  /** Phases that failed and should be skipped in merge order. */
  private readonly skipped = new Set<number>();
  /** Index into mergeOrder of the next phase to merge. -1 means all done. */
  private nextIndex: number;
  /** Full ordered list of phases to merge. */
  private readonly mergeOrder: number[];
  /** Callback to perform the actual merge operation. */
  private readonly onMerge: (phaseNumber: number) => Promise<void>;

  constructor(
    mergeOrder: number[],
    onMerge: (phaseNumber: number) => Promise<void>,
  ) {
    this.mergeOrder = mergeOrder;
    this.onMerge = onMerge;
    // Empty mergeOrder means nothing to merge -- already complete
    this.nextIndex = mergeOrder.length > 0 ? 0 : -1;
  }

  /**
   * Mark a phase as completed and attempt to drain the queue.
   */
  async enqueue(phaseNumber: number): Promise<void> {
    this.completed.add(phaseNumber);
    log.info(
      { phaseNumber, nextPhase: this.nextPhase() },
      'Phase enqueued for merge',
    );
    await this.drain();
  }

  /**
   * Mark a phase as failed (skipped) in the merge queue.
   * Triggers drain to unblock later phases waiting behind this one.
   * No-op if phaseNumber is not in the merge order.
   */
  async markFailed(phaseNumber: number): Promise<void> {
    const idx = this.mergeOrder.indexOf(phaseNumber);
    if (idx === -1) return;

    this.skipped.add(phaseNumber);
    log.info({ phaseNumber }, 'Phase marked as failed in merge queue');
    await this.drain();
  }

  /**
   * Check if all phases have been merged or skipped.
   */
  isComplete(): boolean {
    return this.nextIndex === -1;
  }

  /**
   * Drain all phases that can be merged in order.
   *
   * Iterates from the current position in mergeOrder:
   * - Skipped phases: advance past them
   * - Completed phases: call onMerge, advance
   * - Neither: stop (not ready yet)
   */
  private async drain(): Promise<void> {
    while (this.nextIndex >= 0 && this.nextIndex < this.mergeOrder.length) {
      const phase = this.mergeOrder[this.nextIndex];

      if (this.skipped.has(phase)) {
        // Skip failed phase, advance pointer
        this.nextIndex++;
        log.info({ phase }, 'Skipped failed phase in merge order');
        continue;
      }

      if (!this.completed.has(phase)) {
        // Not ready yet -- stop draining
        break;
      }

      // Phase is ready to merge
      await this.onMerge(phase);
      this.completed.delete(phase);
      this.nextIndex++;

      log.info(
        { merged: phase, nextPhase: this.nextPhase() },
        'Phase merged in order',
      );
    }

    // Past end of mergeOrder -- mark as complete
    if (this.nextIndex >= this.mergeOrder.length) {
      this.nextIndex = -1;
    }
  }

  /**
   * Helper to get the next phase number for logging.
   */
  private nextPhase(): number | null {
    if (this.nextIndex < 0 || this.nextIndex >= this.mergeOrder.length) {
      return null;
    }
    return this.mergeOrder[this.nextIndex];
  }
}
