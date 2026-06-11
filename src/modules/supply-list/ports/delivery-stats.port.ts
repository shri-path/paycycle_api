import { MonthStatsDto, TodayStatsDto } from '../supply-list.types';

/**
 * Read port over the Delivery Tracking context (US-006). Stubbed (zeros) in
 * US-005 so the response contract is stable; the real adapter ships in US-006.
 */
export interface DeliveryStatsPort {
  getTodayStats(supplyListId: bigint, date: Date): Promise<TodayStatsDto>;
  getMonthStats(supplyListId: bigint, month: Date): Promise<MonthStatsDto>;
}
