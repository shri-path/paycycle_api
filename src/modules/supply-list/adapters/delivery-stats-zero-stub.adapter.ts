import { DeliveryStatsPort } from '../ports/delivery-stats.port';
import { MonthStatsDto, TodayStatsDto } from '../supply-list.types';

/**
 * Zero-returning stub for delivery stats (OQ-2). Keeps the response contract
 * stable until US-006 swaps in the real adapter at the composition root.
 */
export class DeliveryStatsZeroStubAdapter implements DeliveryStatsPort {
  getTodayStats(_supplyListId: bigint, date: Date): Promise<TodayStatsDto> {
    return Promise.resolve({
      date: date.toISOString().slice(0, 10),
      delivered: 0,
      onLeave: 0,
      pending: 0,
      totalQuantity: 0,
    });
  }

  getMonthStats(_supplyListId: bigint, month: Date): Promise<MonthStatsDto> {
    return Promise.resolve({
      month: month.toISOString().slice(0, 7),
      daysCompleted: 0,
      totalQuantity: 0,
      revenue: 0,
    });
  }
}
