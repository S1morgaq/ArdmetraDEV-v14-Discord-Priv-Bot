import { registerInterval } from './scheduler';

interface Entry<V> {
  value: V;
  expiresAt: number;
}

export interface CacheOptions {
  ttlMs: number;
  max: number;
}

const allCaches = new Set<TtlCache<unknown, unknown>>();
let sweeperStarted = false;

/** Size-bounded cache with per-entry TTL. Expired entries are pruned by a shared sweeper. */
export class TtlCache<K, V> {
  private readonly store = new Map<K, Entry<V>>();

  constructor(private readonly options: CacheOptions) {
    allCaches.add(this as unknown as TtlCache<unknown, unknown>);
  }

  get(key: K): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  set(key: K, value: V, ttlMs: number = this.options.ttlMs): void {
    if (!this.store.has(key) && this.store.size >= this.options.max) {
      const oldest = this.store.keys().next();
      if (!oldest.done) this.store.delete(oldest.value);
    }
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  delete(key: K): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  deleteWhere(predicate: (key: K) => boolean): void {
    for (const key of this.store.keys()) if (predicate(key)) this.store.delete(key);
  }

  get size(): number {
    return this.store.size;
  }

  prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) if (entry.expiresAt <= now) this.store.delete(key);
  }
}

/** Starts the single shared sweeper that prunes every TtlCache. Safe to call repeatedly. */
export function startCacheSweeper(): void {
  if (sweeperStarted) return;
  sweeperStarted = true;
  registerInterval('cache-sweeper', 30_000, () => {
    for (const cache of allCaches) cache.prune();
  });
}
