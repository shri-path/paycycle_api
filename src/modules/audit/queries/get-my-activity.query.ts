import { RoleContext } from '@/infrastructure/middlewares/rbac/role-context';
import { IAuditRepository, AuditLogRow } from '../audit.repository.port';
import { AuditReader } from '../audit.reader';
import { actionLabel, appToday, startOfMonth, startOfWeek } from '../audit.shared';
import { GetMyActivityResultDto, MyActivityItemDto } from '../audit.types';

const MY_ACTIVITY_CAP = 100;

/** Query: the caller's own recent activity + today/week/month counts. */
export class GetMyActivityQuery {
  constructor(
    private readonly repository: IAuditRepository,
    private readonly reader: AuditReader
  ) {}

  async execute(ctx: RoleContext): Promise<GetMyActivityResultDto> {
    const [rows, todayActions, thisWeekActions, thisMonthActions] = await Promise.all([
      this.repository.findMyActivity(ctx.vendorId, ctx.userId, MY_ACTIVITY_CAP),
      this.repository.countMyActionsSince(ctx.vendorId, ctx.userId, appToday()),
      this.repository.countMyActionsSince(ctx.vendorId, ctx.userId, startOfWeek()),
      this.repository.countMyActionsSince(ctx.vendorId, ctx.userId, startOfMonth()),
    ]);

    const activity = await this.enrich(ctx.vendorId, rows);

    return {
      activity,
      summary: { todayActions, thisWeekActions, thisMonthActions },
    };
  }

  private async enrich(vendorId: bigint, rows: AuditLogRow[]): Promise<MyActivityItemDto[]> {
    const deliveryIds = rows
      .filter((r) => r.entityType === 'daily_supply' && r.entityId !== null)
      .map((r) => r.entityId as bigint);
    const directCustomerIds = rows
      .filter((r) => r.entityType === 'customer' && r.entityId !== null)
      .map((r) => r.entityId as bigint);

    const deliveryRefs = await this.reader.getDeliveryRefs(deliveryIds);
    const customerIds = new Set<string>(directCustomerIds.map((id) => id.toString()));
    for (const ref of deliveryRefs.values()) customerIds.add(ref.customerId.toString());
    const customerNames = await this.reader.getCustomerNames(
      vendorId,
      [...customerIds].map((s) => BigInt(s))
    );

    return rows.map((r) => {
      const ref =
        r.entityType === 'daily_supply' && r.entityId !== null
          ? deliveryRefs.get(r.entityId.toString())
          : undefined;

      let customer: MyActivityItemDto['customer'] = null;
      if (ref) {
        customer = { id: ref.customerId.toString(), name: ref.customerName };
      } else if (r.entityType === 'customer' && r.entityId !== null) {
        customer = {
          id: r.entityId.toString(),
          name: customerNames.get(r.entityId.toString()) ?? null,
        };
      }

      return {
        id: r.id.toString(),
        timestamp: r.createdAt.toISOString(),
        actionType: r.action,
        actionLabel: actionLabel(r.action),
        customer,
        supplyList: ref ? { id: ref.supplyListId.toString(), name: ref.supplyListName } : null,
        details: r.metadata ?? {},
      };
    });
  }
}
