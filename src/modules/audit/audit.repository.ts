import { Prisma } from '@prisma/client';
import { prisma } from '@/infrastructure/database/prisma.client';
import {
  AuditLogRow,
  AuditLogWhere,
  ConflictRow,
  IAuditRepository,
  StaffActionRow,
} from './audit.repository.port';

const AUDIT_SELECT = {
  id: true,
  createdAt: true,
  action: true,
  entityType: true,
  entityId: true,
  performedByUserId: true,
  performedByRole: true,
  metadata: true,
  ipAddress: true,
} satisfies Prisma.AuditLogSelect;

type AuditSelectRow = Prisma.AuditLogGetPayload<{ select: typeof AUDIT_SELECT }>;

function toRow(r: AuditSelectRow): AuditLogRow {
  return {
    id: r.id,
    createdAt: r.createdAt,
    action: r.action,
    entityType: r.entityType,
    entityId: r.entityId,
    performedByUserId: r.performedByUserId,
    performedByRole: r.performedByRole,
    metadata: (r.metadata as Record<string, unknown> | null) ?? null,
    ipAddress: r.ipAddress,
  };
}

function buildWhere(where: AuditLogWhere): Prisma.AuditLogWhereInput {
  const w: Prisma.AuditLogWhereInput = { vendorId: where.vendorId };
  if (where.performedByUserId !== undefined) w.performedByUserId = where.performedByUserId;
  if (where.customerEntityId !== undefined) {
    // Customer scoping pins entityType=customer; an explicit entityType filter is
    // ignored in this case so the two filters cannot produce a contradictory query.
    w.entityType = 'customer';
    w.entityId = where.customerEntityId;
  } else if (where.entityType !== undefined) {
    w.entityType = where.entityType;
  }
  if (where.actionType !== undefined) w.action = where.actionType;
  if (where.createdFrom !== undefined || where.createdToExclusive !== undefined) {
    w.createdAt = {
      ...(where.createdFrom !== undefined ? { gte: where.createdFrom } : {}),
      ...(where.createdToExclusive !== undefined ? { lt: where.createdToExclusive } : {}),
    };
  }
  return w;
}

/** Prisma read adapter over audit_logs (immutable; no write methods). */
export class AuditRepository implements IAuditRepository {
  async findLogs(
    where: AuditLogWhere,
    page: number,
    limit: number
  ): Promise<{ rows: AuditLogRow[]; total: number }> {
    const w = buildWhere(where);
    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({
        where: w,
        select: AUDIT_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.auditLog.count({ where: w }),
    ]);
    return { rows: rows.map(toRow), total };
  }

  async findForExport(where: AuditLogWhere, cap: number): Promise<AuditLogRow[]> {
    const rows = await prisma.auditLog.findMany({
      where: buildWhere(where),
      select: AUDIT_SELECT,
      orderBy: { createdAt: 'desc' },
      take: cap,
    });
    return rows.map(toRow);
  }

  async distinctStaff(vendorId: bigint): Promise<Array<{ id: bigint; name: string | null }>> {
    const rows = await prisma.auditLog.findMany({
      where: {
        vendorId,
        performedByRole: { not: 'vendor_owner' },
        performedByUserId: { not: null },
      },
      select: { performedByUserId: true },
      distinct: ['performedByUserId'],
    });
    const ids = rows.map((r) => r.performedByUserId).filter((id): id is bigint => id !== null);
    if (ids.length === 0) return [];
    const users = await prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    return users.map((u) => ({ id: u.id, name: u.name }));
  }

  async distinctActions(vendorId: bigint): Promise<string[]> {
    const rows = await prisma.auditLog.findMany({
      where: { vendorId },
      select: { action: true },
      distinct: ['action'],
      orderBy: { action: 'asc' },
    });
    return rows.map((r) => r.action);
  }

  async findStaffActions(
    vendorId: bigint,
    filters: { staffId?: bigint; createdFrom?: Date; createdToExclusive?: Date }
  ): Promise<StaffActionRow[]> {
    const where: Prisma.AuditLogWhereInput = {
      vendorId,
      performedByRole: { not: 'vendor_owner' },
      performedByUserId: filters.staffId !== undefined ? filters.staffId : { not: null },
    };
    if (filters.createdFrom !== undefined || filters.createdToExclusive !== undefined) {
      where.createdAt = {
        ...(filters.createdFrom !== undefined ? { gte: filters.createdFrom } : {}),
        ...(filters.createdToExclusive !== undefined ? { lt: filters.createdToExclusive } : {}),
      };
    }
    const rows = await prisma.auditLog.findMany({
      where,
      select: { performedByUserId: true, action: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows;
  }

  async findConflicts(vendorId: bigint, cap: number): Promise<ConflictRow[]> {
    // Latest vendor/customer override per delivery whose newStatus differs from the
    // staff-marked status. Pull recent overrides + their deliveries, then derive.
    const overrides = await prisma.supplyOverride.findMany({
      where: {
        actorRole: { in: ['VENDOR_OWNER', 'CUSTOMER'] },
        newStatus: { not: null },
        dailySupply: { vendorId, markedByUserId: { not: null } },
      },
      select: {
        dailySupplyId: true,
        actorRole: true,
        newStatus: true,
        createdAt: true,
        dailySupply: {
          select: {
            id: true,
            serviceDate: true,
            status: true,
            supplyListId: true,
            supplyListCustomerId: true,
            markedByUserId: true,
            markedAt: true,
            subscription: { select: { customerId: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: cap * 4, // headroom: collapse to latest-per-delivery below
    });

    const latestPerDelivery = new Map<string, (typeof overrides)[number]>();
    for (const o of overrides) {
      const key = o.dailySupplyId.toString();
      if (!latestPerDelivery.has(key)) latestPerDelivery.set(key, o); // first seen = latest (desc)
    }

    const conflicts: ConflictRow[] = [];
    for (const o of latestPerDelivery.values()) {
      const ds = o.dailySupply;
      if (o.newStatus === null || o.actorRole === null) continue;
      // Conflict only when the override status differs from the staff-marked status.
      if (o.newStatus === ds.status) continue;
      conflicts.push({
        dailySupplyId: ds.id,
        serviceDate: ds.serviceDate,
        supplyListId: ds.supplyListId,
        supplyListCustomerId: ds.supplyListCustomerId,
        customerId: ds.subscription.customerId,
        status: ds.status,
        markedByUserId: ds.markedByUserId,
        markedAt: ds.markedAt,
        overrideStatus: o.newStatus,
        overrideRole: o.actorRole,
        overrideAt: o.createdAt,
      });
      if (conflicts.length >= cap) break;
    }
    return conflicts;
  }

  async findMyActivity(vendorId: bigint, userId: bigint, cap: number): Promise<AuditLogRow[]> {
    const rows = await prisma.auditLog.findMany({
      where: { vendorId, performedByUserId: userId },
      select: AUDIT_SELECT,
      orderBy: { createdAt: 'desc' },
      take: cap,
    });
    return rows.map(toRow);
  }

  async countMyActionsSince(vendorId: bigint, userId: bigint, since: Date): Promise<number> {
    return prisma.auditLog.count({
      where: { vendorId, performedByUserId: userId, createdAt: { gte: since } },
    });
  }
}
