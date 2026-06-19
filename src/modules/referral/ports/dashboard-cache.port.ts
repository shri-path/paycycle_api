/**
 * DashboardCachePort — caching abstraction for the referral dashboard DTO.
 *
 * v1 is backed by an in-memory LRU with TTL (see InMemoryDashboardCacheAdapter).
 * The port is intentionally Redis-ready: a Redis adapter can drop in later without
 * touching the query or invalidation call-sites.
 *
 * Keying is strictly per-tenant (per vendorId) — an entry for one vendor must never
 * be served to another.
 */
export interface IDashboardCachePort<TValue> {
  /**
   * Return the cached value for this vendor, or null when absent or expired.
   */
  get(vendorId: bigint): Promise<TValue | null>;

  /**
   * Store the value for this vendor with the configured TTL.
   */
  set(vendorId: bigint, value: TValue): Promise<void>;

  /**
   * Remove the cached entry for this vendor (called on any event that changes
   * dashboard numbers: redeem, reward-earned, clawback).
   */
  invalidate(vendorId: bigint): Promise<void>;

  /**
   * Remove all entries (primarily for tests / administrative reset).
   */
  clear(): Promise<void>;
}
