/**
 * GetSupplyForecastQuery — Query (read-only, no side effects).
 */
import { SupplyForecastCalculator } from '../../services/supply-forecast.calculator';
import { DashboardMapper } from '../../dashboard.mapper';
import { SupplyForecastDto } from '../../dashboard.types';

export class GetSupplyForecastQuery {
  constructor(private readonly forecastCalc: SupplyForecastCalculator) {}

  async execute(
    vendorId: bigint,
    forecastDate: Date,
    days: number,
    supplyType?: string
  ): Promise<SupplyForecastDto> {
    const result = await this.forecastCalc.compute(vendorId, forecastDate, days, supplyType);
    return DashboardMapper.toSupplyForecastDto(result);
  }
}
