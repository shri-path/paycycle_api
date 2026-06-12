/**
 * GetOwnerDashboardQuery — Query (read-only, no side effects).
 * Fans out to 6 parallel reads then composes the owner dashboard DTO.
 */
import { IDashboardReadRepository } from '../../database/dashboard-read.repository.port';
import { IVendorSettingsRepository } from '../../../vendor-settings/database/vendor-settings.repository.port';
import { FinancialSummaryCalculator } from '../../services/financial-summary.calculator';
import { SupplyForecastCalculator } from '../../services/supply-forecast.calculator';
import { DashboardMapper } from '../../dashboard.mapper';
import { OwnerDashboardDto } from '../../dashboard.types';

export class GetOwnerDashboardQuery {
  constructor(
    private readonly readRepo: IDashboardReadRepository,
    private readonly settingsRepo: IVendorSettingsRepository,
    private readonly financialCalc: FinancialSummaryCalculator,
    private readonly forecastCalc: SupplyForecastCalculator
  ) {}

  async execute(vendorId: bigint, month?: string): Promise<OwnerDashboardDto> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const currentMonth =
      month ?? `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [financial, quickStats, tomorrowForecast, next7DaysForecast, todayLists, settingsRow] =
      await Promise.all([
        this.financialCalc.compute(vendorId, currentMonth),
        this.readRepo.quickStats(vendorId, today),
        this.forecastCalc.compute(vendorId, tomorrow, 1),
        this.forecastCalc.compute(vendorId, tomorrow, 7),
        this.readRepo.todayListProgress(vendorId, today),
        this.settingsRepo.findByVendor(vendorId),
      ]);

    const autoMarkEnabled = settingsRow?.autoMarkEnabled ?? true;

    return DashboardMapper.toOwnerDashboardDto({
      currentMonth,
      financial,
      quickStats,
      autoMarkEnabled,
      tomorrowForecast,
      next7DaysForecast,
      todayLists,
    });
  }
}
