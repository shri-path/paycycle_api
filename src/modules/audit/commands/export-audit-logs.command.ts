import { ForbiddenError } from '@/common/errors/app-error';
import { RoleContext } from '@/infrastructure/middlewares/rbac/role-context';
import { IAuditRepository, AuditLogRow, AuditLogWhere } from '../audit.repository.port';
import { AuditReader } from '../audit.reader';
import { actionLabel, buildAuditCsv, roleLabel } from '../audit.shared';
import { AuditLogView, ExportResult } from '../audit.types';

const EXPORT_CAP = 10_000;

interface ExportFilters {
  staffId?: bigint;
  actionType?: string;
  startDate?: Date;
  endDate?: Date;
}

/**
 * Command (owner only): build a CSV of filtered audit logs (≤ 10k rows).
 * Returns the filename + CSV string; the controller streams it as a download.
 */
export class ExportAuditLogsCommand {
  constructor(
    private readonly repository: IAuditRepository,
    private readonly reader: AuditReader
  ) {}

  async execute(ctx: RoleContext, filters: ExportFilters): Promise<ExportResult> {
    if (ctx.role !== 'owner') {
      throw new ForbiddenError('This action requires owner privileges');
    }

    const where: AuditLogWhere = { vendorId: ctx.vendorId };
    if (filters.staffId !== undefined) where.performedByUserId = filters.staffId;
    if (filters.actionType !== undefined) where.actionType = filters.actionType;
    if (filters.startDate !== undefined) where.createdFrom = filters.startDate;
    if (filters.endDate !== undefined) {
      where.createdToExclusive = new Date(filters.endDate.getTime() + 86_400_000);
    }

    const rows = await this.repository.findForExport(where, EXPORT_CAP);
    const views = await this.enrich(ctx.vendorId, rows);
    const csv = buildAuditCsv(views);

    return {
      filename: `audit-logs-${ctx.vendorId.toString()}-${Date.now()}.csv`,
      csv,
    };
  }

  private async enrich(vendorId: bigint, rows: AuditLogRow[]): Promise<AuditLogView[]> {
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
      let customer: AuditLogView['customer'] = null;
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
        supplyList: ref ? { id: ref.supplyListId.toString(), name: ref.supplyListName } : null,
        details: r.metadata ?? {},
      };
    });
  }
}
