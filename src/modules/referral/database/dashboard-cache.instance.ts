/**
 * Shared, process-wide dashboard cache instance.
 *
 * A single instance is shared across every read (GetDashboardQuery) and every
 * invalidation site (redeem / earn commands, signup facade, reward + clawback
 * crons) so that a write through any path drops the same cached entry the reader
 * would otherwise serve.
 *
 * Lives in its own module to avoid an import cycle between the composition root
 * (referral.routes.ts), the facade, and the cron registration.
 */
import { DashboardResult } from '../queries/get-dashboard/get-dashboard.query';
import { IDashboardCachePort } from '../ports/dashboard-cache.port';
import { InMemoryDashboardCacheAdapter } from './dashboard-cache.adapter';

export const dashboardCache: IDashboardCachePort<DashboardResult> =
  new InMemoryDashboardCacheAdapter<DashboardResult>();
