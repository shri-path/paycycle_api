/**
 * InMemoryDashboardCacheAdapter — in-memory LRU + TTL implementation of
 * IDashboardCachePort for v1.
 *
 * - 5-minute TTL per entry (configurable).
 * - Bounded size with LRU eviction (recently read/written keys are kept).
 * - Per-tenant keying by vendorId.
 *
 * Multi-instance note: this cache is per-process. In a multi-instance deployment
 * each instance keeps its own copy, so a vendor may see stale data for up to the
 * TTL after an invalidation served by another instance. This is accepted for v1;
 * the Redis adapter (same port) is the multi-instance path.
 *
 * Cache stampede note: on first read after an invalidation/expiry, concurrent
 * requests may each recompute the dashboard (no single-flight in v1). This is
 * acceptable for an in-memory cache; single-flight is deferred.
 */
/*
 * The methods are intentionally `async` with no `await`: they implement the
 * async IDashboardCachePort contract (Redis-ready) where a future adapter WILL
 * await I/O. Keeping the in-memory impl async preserves a single call-site shape.
 */
/* eslint-disable @typescript-eslint/require-await */
import { IDashboardCachePort } from '../ports/dashboard-cache.port';

interface CacheEntry<TValue> {
  value: TValue;
  expiresAt: number;
}

export const DEFAULT_DASHBOARD_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const DEFAULT_DASHBOARD_MAX_ENTRIES = 1000;

export class InMemoryDashboardCacheAdapter<TValue> implements IDashboardCachePort<TValue> {
  private readonly store = new Map<string, CacheEntry<TValue>>();

  constructor(
    private readonly ttlMs: number = DEFAULT_DASHBOARD_TTL_MS,
    private readonly maxEntries: number = DEFAULT_DASHBOARD_MAX_ENTRIES,
    private readonly now: () => number = () => Date.now()
  ) {}

  private key(vendorId: bigint): string {
    return vendorId.toString();
  }

  async get(vendorId: bigint): Promise<TValue | null> {
    const key = this.key(vendorId);
    const entry = this.store.get(key);
    if (!entry) return null;

    if (entry.expiresAt <= this.now()) {
      // Expired — evict and miss.
      this.store.delete(key);
      return null;
    }

    // LRU touch: re-insert to mark as most-recently-used.
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  async set(vendorId: bigint, value: TValue): Promise<void> {
    const key = this.key(vendorId);
    // Refresh recency on write.
    this.store.delete(key);
    this.store.set(key, { value, expiresAt: this.now() + this.ttlMs });

    // Evict least-recently-used until within bounds.
    while (this.store.size > this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey === undefined) break;
      this.store.delete(oldestKey);
    }
  }

  async invalidate(vendorId: bigint): Promise<void> {
    this.store.delete(this.key(vendorId));
  }

  async clear(): Promise<void> {
    this.store.clear();
  }
}
