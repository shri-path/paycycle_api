import { DailySupplyStatus } from '@prisma/client';
import { RoleContext } from '@/infrastructure/middlewares/rbac/role-context';
import { DailySupplyMapper, DeliveryNotFoundError, deriveConflict } from '../delivery.domain';
import { IDeliveryRepository } from '../delivery.repository.port';
import { DeliveryReader } from '../delivery.reader';
import {
  appToday,
  countByStatus,
  isoToDate,
  latestActorRole,
  overridesTotalNull,
} from '../delivery.shared';
import { DeliveryDto, ListDeliveriesResultDto } from '../delivery.types';

/** Query: per-customer deliveries for a list on a date, with progress. */
export class ListDeliveriesQuery {
  constructor(
    private readonly repository: IDeliveryRepository,
    private readonly reader: DeliveryReader
  ) {}

  async execute(
    ctx: RoleContext,
    listId: bigint,
    params: { date?: string; status?: DailySupplyStatus; search?: string }
  ): Promise<ListDeliveriesResultDto> {
    const list = await this.reader.getSupplyList(ctx.vendorId, listId);
    if (!list) throw new DeliveryNotFoundError('Supply list not found');
    if (ctx.role !== 'owner') {
      const assigned = await this.reader.isAssignedToList(ctx.staffId, listId);
      if (!assigned) throw new DeliveryNotFoundError('Supply list not found');
    }

    const date = params.date ? isoToDate(params.date) : appToday();
    const records = await this.repository.listByListAndDate(ctx.vendorId, listId, date, {
      ...(params.status ? { status: params.status } : {}),
      ...(params.search ? { search: params.search } : {}),
    });

    const deliveries: DeliveryDto[] = [];
    const overrides = await this.repository.findOverridesFor(records.map((r) => r.id));
    const subIds = records.map((r) => r.supplyListCustomerId);
    const subCustomerIds = await this.reader.getSubscriptionCustomerIds(subIds);
    const customerIds = [...new Set([...subCustomerIds.values()])];
    const [customers, otherLists, markers] = await Promise.all([
      this.reader.getCustomerDisplay(ctx.vendorId, customerIds),
      this.reader.getOtherListNames(ctx.vendorId, customerIds, listId),
      this.reader.getMarkerNames(
        records.map((r) => r.markedByUserId).filter((id): id is bigint => id !== null)
      ),
    ]);

    for (const record of records) {
      const entity = DailySupplyMapper.toDomain(record, overridesTotalNull);
      const customerId = subCustomerIds.get(record.supplyListCustomerId.toString());
      const customer = customerId ? customers.get(customerId.toString()) : undefined;
      const conflict = deriveConflict(
        overrides
          .filter((o) => o.dailySupplyId === record.id)
          .map((o) => ({ actorRole: o.actorRole, newStatus: o.newStatus, createdAt: o.createdAt }))
      );
      const marker =
        record.markedByUserId !== null
          ? {
              userId: record.markedByUserId,
              name: markers.get(record.markedByUserId.toString()) ?? null,
              role: latestActorRole(overrides, record.id),
            }
          : null;

      deliveries.push(
        DailySupplyMapper.toResponse(entity, {
          customer: customer ?? {
            id: customerId ?? 0n,
            name: null,
            address: null,
            phoneNumber: null,
          },
          marker,
          conflict,
          otherLists: customerId ? (otherLists.get(customerId.toString()) ?? []) : [],
          includeFinancials: ctx.role === 'owner',
        })
      );
    }

    const progress = countByStatus(records);
    return {
      listId: list.id.toString(),
      listName: list.name,
      date: date.toISOString().slice(0, 10),
      progress: {
        total: records.length,
        delivered: progress.delivered,
        onLeave: progress.onLeave,
        pending: progress.pending,
      },
      deliveries,
    };
  }
}
