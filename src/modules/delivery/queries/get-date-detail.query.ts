import { RoleContext } from '@/infrastructure/middlewares/rbac/role-context';
import { IDeliveryRepository } from '../delivery.repository.port';
import { DeliveryReader } from '../delivery.reader';
import { countByStatus, isoToDate } from '../delivery.shared';
import { DateDetailResultDto } from '../delivery.types';

/** Query: day detail breakdown by list, charges, leaves (owner). */
export class GetDateDetailQuery {
  constructor(
    private readonly repository: IDeliveryRepository,
    private readonly reader: DeliveryReader
  ) {}

  async execute(ctx: RoleContext, dateIso: string): Promise<DateDetailResultDto> {
    const date = isoToDate(dateIso);
    const lists = await this.reader.getSupplyLists(ctx.vendorId);

    const byList: DateDetailResultDto['byList'] = [];
    let totalDeliveries = 0;
    let totalLeaves = 0;
    let revenue = 0;

    for (const list of lists) {
      const records = await this.repository.listByListAndDate(ctx.vendorId, list.id, date, {});
      if (records.length === 0) continue;
      const counts = countByStatus(records);
      const listRevenue = records.reduce((s, r) => s + Number(r.finalAmount.toString()), 0);
      totalDeliveries += counts.delivered;
      totalLeaves += counts.onLeave;
      revenue += listRevenue;
      byList.push({
        listId: list.id.toString(),
        listName: list.name,
        startTime: list.startTime,
        staffName: list.staff[0]?.name ?? null,
        delivered: counts.delivered,
        leaves: counts.onLeave,
        revenue: listRevenue.toFixed(2),
      });
    }

    return {
      date: dateIso,
      summary: { totalDeliveries, leaves: totalLeaves, revenue: revenue.toFixed(2) },
      byList,
      extraCharges: [],
      leaves: [],
    };
  }
}
