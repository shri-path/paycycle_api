import { RoleContext } from '@/infrastructure/middlewares/rbac/role-context';
import { IAuditRepository, AuditLogRow, AuditLogWhere } from '../audit.repository.port';
import { AuditReader } from '../audit.reader';
import { actionLabel, roleLabel } from '../audit.shared';
import { AuditLogView, AuditLogFilters, ListAuditLogsResultDto } from '../audit.types';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/**
 * Query: enriched, paginated activity timeline with filter facets.
 * Staff callers are forced to see only their own actions.
 */
export class ListAuditLogsQuery {
  constructor(
    private readonly repository: IAuditRepository,
    private readonly reader: AuditReader
  ) {}

  async execute(ctx: RoleContext, filters: AuditLogFilters): Promise<ListAuditLogsResultDto> {
    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const limit = Math.min(
      filters.limit && filters.limit > 0 ? filters.limit : DEFAULT_LIMIT,
      MAX_LIMIT
    );
    const isOwner = ctx.role === 'owner';

    const where: AuditLogWhere = { vendorId: ctx.vendorId };
    // Staff scoping: ignore any staffId filter and force self-scope.
    if (isOwner) {
      if (filters.staffId !== undefined) where.performedByUserId = filters.staffId;
    } else {
      where.performedByUserId = ctx.userId;
    }
    if (filters.customerId !== undefined) where.customerEntityId = filters.customerId;
    if (filters.actionType !== undefined) where.actionType = filters.actionType;
    if (filters.entityType !== undefined) where.entityType = filters.entityType;
    if (filters.startDate !== undefined) where.createdFrom = filters.startDate;
    if (filters.endDate !== undefined) {
      where.createdToExclusive = new Date(filters.endDate.getTime() + 86_400_000);
    }

    const { rows, total } = await this.repository.findLogs(where, page, limit);

    const auditLogs = await this.enrich(ctx.vendorId, rows, isOwner);

    const [availableStaff, availableActionTypes] = await Promise.all([
      isOwner ? this.repository.distinctStaff(ctx.vendorId) : Promise.resolve([]),
      this.repository.distinctActions(ctx.vendorId),
    ]);

    return {
      auditLogs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      filters: {
        availableStaff: availableStaff.map((s) => ({ id: s.id.toString(), name: s.name })),
        availableActionTypes,
      },
    };
  }

  private async enrich(
    vendorId: bigint,
    rows: AuditLogRow[],
    includeIp: boolean
  ): Promise<AuditLogView[]> {
    const userIds = rows.map((r) => r.performedByUserId).filter((id): id is bigint => id !== null);
    const deliveryIds = rows
      .filter((r) => r.entityType === 'daily_supply' && r.entityId !== null)
      .map((r) => r.entityId as bigint);
    const directCustomerIds = rows
      .filter((r) => r.entityType === 'customer' && r.entityId !== null)
      .map((r) => r.entityId as bigint);

    const [userNames, deliveryRefs] = await Promise.all([
      this.reader.getUserNames(userIds),
      this.reader.getDeliveryRefs(deliveryIds),
    ]);

    // Customer names: direct (entity=customer) + those resolved via deliveries.
    const customerIdsToName = new Set<string>(directCustomerIds.map((id) => id.toString()));
    for (const ref of deliveryRefs.values()) customerIdsToName.add(ref.customerId.toString());
    const customerNames = await this.reader.getCustomerNames(
      vendorId,
      [...customerIdsToName].map((s) => BigInt(s))
    );

    return rows.map((r) => this.toView(r, userNames, deliveryRefs, customerNames, includeIp));
  }

  private toView(
    r: AuditLogRow,
    userNames: Map<string, string | null>,
    deliveryRefs: Map<
      string,
      {
        customerId: bigint;
        customerName: string | null;
        supplyListId: bigint;
        supplyListName: string | null;
      }
    >,
    customerNames: Map<string, string | null>,
    includeIp: boolean
  ): AuditLogView {
    const ref =
      r.entityType === 'daily_supply' && r.entityId !== null
        ? deliveryRefs.get(r.entityId.toString())
        : undefined;

    let customer: AuditLogView['customer'] = null;
    if (ref) {
      customer = { id: ref.customerId.toString(), name: ref.customerName };
    } else if (r.entityType === 'customer' && r.entityId !== null) {
      customer = {
        id: r.entityId.toString(),
        name: customerNames.get(r.entityId.toString()) ?? null,
      };
    }

    const supplyList: AuditLogView['supplyList'] = ref
      ? { id: ref.supplyListId.toString(), name: ref.supplyListName }
      : null;

    const view: AuditLogView = {
      id: r.id.toString(),
      timestamp: r.createdAt.toISOString(),
      actionType: r.action,
      actionLabel: actionLabel(r.action),
      entityType: r.entityType,
      entityId: r.entityId !== null ? r.entityId.toString() : null,
      user: {
        id: r.performedByUserId !== null ? r.performedByUserId.toString() : '',
        name:
          r.performedByUserId !== null
            ? (userNames.get(r.performedByUserId.toString()) ?? null)
            : null,
        role: roleLabel(r.performedByRole),
      },
      customer,
      supplyList,
      details: r.metadata ?? {},
    };
    if (includeIp) view.ipAddress = r.ipAddress;
    return view;
  }
}
