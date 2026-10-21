import { registerInterval } from './scheduler';

const MAX_KEYS = 20_000;
const counters = new Set<SlidingCounter>();
let started = false;

/** Sliding-window event counter with bounded memory. */
export class SlidingCounter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly maxWindowMs: number = 10 * 60_000) {
    counters.add(this);
  }

  /** Records a hit and returns how many hits happened within `windowMs`. */
  hit(key: string, windowMs: number, now: number = Date.now()): number {
    let list = this.hits.get(key);
    if (!list) {
      if (this.hits.size >= MAX_KEYS) {
        const oldest = this.hits.keys().next();
        if (!oldest.done) this.hits.delete(oldest.value);
      }
      list = [];
      this.hits.set(key, list);
    }
    list.push(now);
    const cutoff = now - windowMs;
    let drop = 0;
    while (drop < list.length && list[drop] < cutoff) drop++;
    if (drop > 0) list.splice(0, drop);
    return list.length;
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  prune(now: number = Date.now()): void {
    const cutoff = now - this.maxWindowMs;
    for (const [key, list] of this.hits) {
      if (list.length === 0 || list[list.length - 1] < cutoff) this.hits.delete(key);
    }
  }
}

export function startCounterSweeper(): void {
  if (started) return;
  started = true;
  registerInterval('counter-sweeper', 60_000, () => {
    for (const counter of counters) counter.prune();
  });
}
