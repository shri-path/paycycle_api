/**
 * GetOutstandingAgingQuery — Query (read-only, no side effects).
 */
import { OutstandingAgingCalculator } from '../../services/outstanding-aging.calculator';
import { DashboardMapper } from '../../dashboard.mapper';
import { OutstandingAgingDto } from '../../dashboard.types';

export interface OutstandingAgingResult {
  data: OutstandingAgingDto;
  totalCount: number;
}

export class GetOutstandingAgingQuery {
  constructor(private readonly agingCalc: OutstandingAgingCalculator) {}

  async execute(
    vendorId: bigint,
    priority?: 'high' | 'medium' | 'low' | 'all',
    page = 1,
    limit = 20
  ): Promise<OutstandingAgingResult> {
    const result = await this.agingCalc.computeFull(vendorId, priority, page, limit);
    return {
      data: DashboardMapper.toOutstandingAgingDto(result),
      totalCount: result.totalPriorityCount,
    };
  }
}
