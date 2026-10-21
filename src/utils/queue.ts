import { logger } from './logger';

interface Lane {
  tail: Promise<void>;
  pending: number;
}

/**
 * Serialises async work per key (usually a guild id) with a minimum gap between tasks.
 * This is what keeps protection actions from flooding the Discord REST API during an attack:
 * work beyond `maxPending` is dropped (and logged) instead of piling up in memory.
 */
export class KeyedQueue {
  private readonly lanes = new Map<string, Lane>();

  constructor(
    private readonly name: string,
    private readonly gapMs: number,
    private readonly maxPending: number,
  ) {}

  /** Returns false when the task was dropped because the lane is full. */
  enqueue(key: string, task: () => Promise<unknown>): boolean {
    let lane = this.lanes.get(key);
    if (!lane) {
      lane = { tail: Promise.resolve(), pending: 0 };
      this.lanes.set(key, lane);
    }
    if (lane.pending >= this.maxPending) {
      logger.warn(`[QUEUE:${this.name}] Lane ${key} is full (${this.maxPending}); dropping task.`);
      return false;
    }
    lane.pending++;
    const current = lane;
    current.tail = current.tail
      .then(task)
      .catch((error: unknown) => {
        logger.error(`[QUEUE:${this.name}] Task failed: ${error instanceof Error ? error.message : String(error)}`);
      })
      .then(() => new Promise<void>((resolve) => setTimeout(resolve, this.gapMs)))
      .then(() => {
        current.pending--;
        if (current.pending === 0) this.lanes.delete(key);
      });
    return true;
  }
}
