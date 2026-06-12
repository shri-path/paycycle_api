import { RoleContext } from '@/infrastructure/middlewares/rbac/role-context';
import { IDeliveryRepository } from '../delivery.repository.port';
import { DeliveryReader } from '../delivery.reader';
import { DeliveryAccess, appToday } from '../delivery.shared';
import { ListLeavesResultDto } from '../delivery.types';

/** Query: today's and upcoming leaves, scoped for staff to their assigned lists. */
export class ListLeavesQuery {
  private readonly access: DeliveryAccess;

  constructor(
    private readonly repository: IDeliveryRepository,
    private readonly reader: DeliveryReader
  ) {
    this.access = new DeliveryAccess(repository, reader);
  }

  async execute(
    ctx: RoleContext,
    params: { status?: 'today' | 'upcoming' }
  ): Promise<ListLeavesResultDto> {
    const today = appToday();
    const from = params.status === 'upcoming' ? new Date(today.getTime() + 86_400_000) : today;
    const to = new Date(today.getTime() + 365 * 86_400_000);

    let subscriptionFilter: bigint[] | undefined;
    if (ctx.role !== 'owner') {
      const assignedListIds = await this.reader.getAssignedListIds(ctx.staffId);
      subscriptionFilter = await this.access.subscriptionIdsForLists(ctx.vendorId, assignedListIds);
    }

    const leaves = await this.repository.listLeaves(ctx.vendorId, {
      from,
      to,
      ...(subscriptionFilter !== undefined ? { supplyListCustomerIds: subscriptionFilter } : {}),
    });

    const subInfo = await this.reader.getSubscriptionCustomers(
      leaves.map((l) => l.supplyListCustomerId)
    );

    const todayList: ListLeavesResultDto['today'] = [];
    const upcoming: ListLeavesResultDto['upcoming'] = [];
    for (const leave of leaves) {
      const info = subInfo.get(leave.supplyListCustomerId.toString());
      const covered =
        leave.startDate.getTime() <= today.getTime() && leave.endDate.getTime() >= today.getTime();
      if (covered && params.status !== 'upcoming') {
        todayList.push({
          id: leave.id.toString(),
          customerName: info?.name ?? null,
          listName: info?.listName ?? '',
          date: today.toISOString().slice(0, 10),
        });
      }
      if (leave.startDate.getTime() > today.getTime()) {
        const days =
          Math.round((leave.endDate.getTime() - leave.startDate.getTime()) / 86_400_000) + 1;
        upcoming.push({
          id: leave.id.toString(),
          customerName: info?.name ?? null,
          listName: info?.listName ?? '',
          startDate: leave.startDate.toISOString().slice(0, 10),
          endDate: leave.endDate.toISOString().slice(0, 10),
          daysCount: days,
        });
      }
    }

    return { today: todayList, upcoming };
  }
}
