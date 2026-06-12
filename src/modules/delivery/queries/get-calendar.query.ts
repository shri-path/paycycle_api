import { ForbiddenError } from '@/common/errors/app-error';
import { RoleContext } from '@/infrastructure/middlewares/rbac/role-context';
import { IDeliveryRepository } from '../delivery.repository.port';
import { DeliveryReader } from '../delivery.reader';
import { DeliveryAccess, countByStatus, dayStatus } from '../delivery.shared';
import { CalendarResultDto } from '../delivery.types';

/** Query: month calendar of delivery status by day (owner). */
export class GetCalendarQuery {
  private readonly access: DeliveryAccess;

  constructor(
    private readonly repository: IDeliveryRepository,
    private readonly reader: DeliveryReader
  ) {
    this.access = new DeliveryAccess(repository, reader);
  }

  async execute(
    ctx: RoleContext,
    params: { month: string; listId?: bigint }
  ): Promise<CalendarResultDto> {
    // Defense-in-depth: the calendar exposes financial data (revenue by day) and
    // is owner-only. Enforce the guard here too, not just in route middleware.
    if (ctx.role !== 'owner') {
      throw new ForbiddenError('Calendar view is restricted to vendor owners');
    }

    const [year, month] = params.month.split('-').map(Number);
    const from = new Date(Date.UTC(year!, month! - 1, 1));
    const to = new Date(Date.UTC(year!, month, 0));

    const listIds = params.listId ? [params.listId] : undefined;
    const lists = await this.reader.getSupplyLists(ctx.vendorId, listIds);
    const scopedListIds = lists.map((l) => l.id);

    const days: CalendarResultDto['days'] = {};
    let totalDeliveries = 0;
    let totalLeaves = 0;
    let revenue = 0;

    const cursor = new Date(from);
    while (cursor.getTime() <= to.getTime()) {
      const dayDate = new Date(cursor);
      let delivered = 0;
      let leaves = 0;
      let pending = 0;
      let dayRevenue = 0;
      let dayConflicts = 0;
      let count = 0;

      for (const listId of scopedListIds) {
        const records = await this.repository.listByListAndDate(ctx.vendorId, listId, dayDate, {});
        const counts = countByStatus(records);
        delivered += counts.delivered;
        leaves += counts.onLeave;
        pending += counts.pending;
        count += records.length;
        dayRevenue += records.reduce((s, r) => s + Number(r.finalAmount.toString()), 0);
        const overrides = await this.repository.findOverridesFor(records.map((r) => r.id));
        dayConflicts += this.access.collectConflicts(records, overrides).length;
      }

      if (count > 0) {
        totalDeliveries += delivered;
        totalLeaves += leaves;
        revenue += dayRevenue;
        days[dayDate.toISOString().slice(0, 10)] = {
          status: dayStatus(dayConflicts, pending, leaves),
          delivered,
          leaves,
          revenue: dayRevenue.toFixed(2),
        };
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return {
      month: params.month,
      summary: { totalDeliveries, totalLeaves, revenue: revenue.toFixed(2) },
      days,
    };
  }
}
