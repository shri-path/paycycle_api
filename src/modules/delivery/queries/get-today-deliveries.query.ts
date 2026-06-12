import { RoleContext } from '@/infrastructure/middlewares/rbac/role-context';
import { IDeliveryRepository } from '../delivery.repository.port';
import { DeliveryReader } from '../delivery.reader';
import { DeliveryAccess, appToday, countByStatus, isoToDate } from '../delivery.shared';
import { TodayResultDto } from '../delivery.types';

/** Query: today's deliveries summarized by supply list, with conflicts. */
export class GetTodayDeliveriesQuery {
  private readonly access: DeliveryAccess;

  constructor(
    private readonly repository: IDeliveryRepository,
    private readonly reader: DeliveryReader
  ) {
    this.access = new DeliveryAccess(repository, reader);
  }

  async execute(
    ctx: RoleContext,
    params: { date?: string; listId?: bigint }
  ): Promise<TodayResultDto> {
    const date = params.date ? isoToDate(params.date) : appToday();
    let listIds = await this.access.scopedListIds(ctx, params.listId);

    const lists = await this.reader.getSupplyLists(ctx.vendorId, listIds);
    listIds = lists.map((l) => l.id);

    const summary = {
      totalDeliveries: 0,
      delivered: 0,
      onLeave: 0,
      pending: 0,
      autoMarked: 0,
      revenue: 0,
      conflicts: 0,
    };
    const byList: TodayResultDto['byList'] = [];
    const allConflicts: TodayResultDto['conflicts'] = [];

    for (const list of lists) {
      const records = await this.repository.listByListAndDate(ctx.vendorId, list.id, date, {});
      const counts = countByStatus(records);
      const revenue = records.reduce((s, r) => s + Number(r.finalAmount.toString()), 0);

      summary.totalDeliveries += records.length;
      summary.delivered += counts.delivered;
      summary.onLeave += counts.onLeave;
      summary.pending += counts.pending;
      summary.autoMarked += counts.autoMarked;
      summary.revenue += revenue;

      const overrides = await this.repository.findOverridesFor(records.map((r) => r.id));
      const conflicts = this.access.collectConflicts(records, overrides);
      summary.conflicts += conflicts.length;

      if (conflicts.length > 0) {
        const subIds = conflicts.map((c) => c.subId);
        const subCustomers = await this.reader.getSubscriptionCustomers(subIds);
        for (const c of conflicts) {
          const info = subCustomers.get(c.subId.toString());
          allConflicts.push({
            deliveryId: c.deliveryId.toString(),
            customerName: info?.name ?? null,
            listName: list.name,
            reason: c.reason,
          });
        }
      }

      byList.push({
        listId: list.id.toString(),
        listName: list.name,
        startTime: list.startTime,
        staff: list.staff.map((s) => ({ staffId: s.staffId.toString(), name: s.name })),
        totalCustomers: records.length,
        delivered: counts.delivered,
        onLeave: counts.onLeave,
        pending: counts.pending,
        ...(ctx.role === 'owner' ? { revenue: revenue.toFixed(2) } : {}),
      });
    }

    return {
      date: date.toISOString().slice(0, 10),
      summary: { ...summary, revenue: summary.revenue.toFixed(2) },
      byList,
      conflicts: allConflicts,
    };
  }
}
