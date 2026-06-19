/**
 * Unit tests — InMemoryDashboardCacheAdapter.
 * Covers: get/set, TTL expiry, per-tenant isolation, invalidation, LRU eviction.
 */
import { InMemoryDashboardCacheAdapter } from '../../database/dashboard-cache.adapter';

interface Dto {
  label: string;
}

describe('InMemoryDashboardCacheAdapter', () => {
  const v1 = BigInt(1);
  const v2 = BigInt(2);

  it('returns null on a cold miss', async () => {
    const cache = new InMemoryDashboardCacheAdapter<Dto>();
    expect(await cache.get(v1)).toBeNull();
  });

  it('returns the stored value on a hit', async () => {
    const cache = new InMemoryDashboardCacheAdapter<Dto>();
    await cache.set(v1, { label: 'a' });
    expect(await cache.get(v1)).toEqual({ label: 'a' });
  });

  it('expires entries after the TTL', async () => {
    let now = 1000;
    const cache = new InMemoryDashboardCacheAdapter<Dto>(5 * 60 * 1000, 1000, () => now);
    await cache.set(v1, { label: 'a' });

    now += 5 * 60 * 1000 - 1; // just before TTL
    expect(await cache.get(v1)).toEqual({ label: 'a' });

    now += 1; // exactly at TTL boundary → expired
    expect(await cache.get(v1)).toBeNull();
  });

  it('is strictly per-tenant — never serves one vendor to another', async () => {
    const cache = new InMemoryDashboardCacheAdapter<Dto>();
    await cache.set(v1, { label: 'vendor-1' });
    await cache.set(v2, { label: 'vendor-2' });

    expect(await cache.get(v1)).toEqual({ label: 'vendor-1' });
    expect(await cache.get(v2)).toEqual({ label: 'vendor-2' });
  });

  it('invalidate removes only the targeted vendor', async () => {
    const cache = new InMemoryDashboardCacheAdapter<Dto>();
    await cache.set(v1, { label: 'a' });
    await cache.set(v2, { label: 'b' });

    await cache.invalidate(v1);

    expect(await cache.get(v1)).toBeNull();
    expect(await cache.get(v2)).toEqual({ label: 'b' });
  });

  it('clear empties the whole cache', async () => {
    const cache = new InMemoryDashboardCacheAdapter<Dto>();
    await cache.set(v1, { label: 'a' });
    await cache.set(v2, { label: 'b' });

    await cache.clear();

    expect(await cache.get(v1)).toBeNull();
    expect(await cache.get(v2)).toBeNull();
  });

  it('evicts the least-recently-used entry when over capacity', async () => {
    const cache = new InMemoryDashboardCacheAdapter<Dto>(60_000, 2);
    await cache.set(BigInt(1), { label: '1' });
    await cache.set(BigInt(2), { label: '2' });

    // Touch vendor 1 so vendor 2 becomes least-recently-used.
    await cache.get(BigInt(1));

    // Insert a third entry → exceeds maxEntries(2) → evict LRU (vendor 2).
    await cache.set(BigInt(3), { label: '3' });

    expect(await cache.get(BigInt(1))).toEqual({ label: '1' });
    expect(await cache.get(BigInt(2))).toBeNull();
    expect(await cache.get(BigInt(3))).toEqual({ label: '3' });
  });

  it('refreshes TTL on overwrite', async () => {
    let now = 0;
    const cache = new InMemoryDashboardCacheAdapter<Dto>(100, 1000, () => now);
    await cache.set(v1, { label: 'first' });

    now = 60;
    await cache.set(v1, { label: 'second' }); // resets expiry to now+100 = 160

    now = 120; // past the original 100 expiry, before the refreshed 160
    expect(await cache.get(v1)).toEqual({ label: 'second' });
  });
});
