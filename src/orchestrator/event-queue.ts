/**
 * Serial event queue for processing async handlers one at a time.
 *
 * Prevents race conditions from concurrent heartbeat or signal events
 * by ensuring handlers execute serially in enqueue order. If a handler
 * throws, its promise rejects but the queue continues draining.
 */

interface QueueItem {
  handler: () => Promise<void>;
  resolve: () => void;
  reject: (err: unknown) => void;
}

export class SerialEventQueue {
  private processing = false;
  private queue: QueueItem[] = [];

  /**
   * Add an async handler to the queue. Returns a promise that resolves
   * when the handler completes, or rejects if the handler throws.
   */
  async enqueue(handler: () => Promise<void>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.queue.push({ handler, resolve, reject });
      void this.drain();
    });
  }

  /**
   * Process queued items one at a time. If already processing, returns
   * immediately (the active drain loop will pick up new items).
   */
  private async drain(): Promise<void> {
    if (this.processing) {
      return;
    }

    this.processing = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      try {
        await item.handler();
        item.resolve();
      } catch (err: unknown) {
        item.reject(err);
      }
    }

    this.processing = false;
  }
}
