import crypto from 'crypto';
import { ActorRole, DailySupplyStatus } from '@prisma/client';
import { Logger } from '@/infrastructure/logger/logger';
import { AppError, ForbiddenError, InternalServerError } from '@/common/errors/app-error';
import { AuditPort } from '@/common/audit/audit.port';
import { AuditAction } from '@/common/audit/audit-action.enum';
import { RoleContext } from '@/infrastructure/middlewares/rbac/role-context';
import { PermissionKey } from '@/modules/staff/domain/value-objects/permission-key.value-object';
import {
  ActorRoleVO,
  DailySupplyEntity,
  DailySupplyMapper,
  DateRange,
  deriveConflict,
  DeliveryNotFoundError,
  LeaveEntity,
  LeaveNotFoundError,
  NoActiveSubscriptionError,
  ServiceDate,
} from './delivery.domain';
import { IDeliveryRepository, OverrideRow } from './delivery.repository.port';
import { DeliveryReader } from './delivery.reader';
import {
  CalendarResultDto,
  CreateLeaveResultDto,
  DateDetailResultDto,
  DeliveryDto,
  ExtraChargeResultDto,
  GenerateResultDto,
  ListDeliveriesResultDto,
  ListLeavesResultDto,
  MarkBulkResultDto,
  MarkDeliveryResultDto,
  TodayResultDto,
} from './delivery.types';

const APP_TIMEZONE_OFFSET_MIN = 330; // Asia/Kolkata (UTC+5:30) — OQ-4.

/** Current service date in the app timezone, normalized to a UTC midnight Date. */
export function appToday(now: Date = new Date()): Date {
  const shifted = new Date(now.getTime() + APP_TIMEZONE_OFFSET_MIN * 60_000);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
}

function isoToDate(iso: string): Date {
  return ServiceDate.fromIso(iso).value;
}

interface ActorMeta {
  ip: string | null;
  userAgent: string | null;
}

export class DeliveryService {
  constructor(
    private readonly repository: IDeliveryRepository,
    private readonly reader: DeliveryReader,
    private readonly auditLogger: AuditPort,
    private readonly logger: Logger
  ) {}

  // ============================================================
  // Permission helpers
  // ============================================================

  private async assertListPermission(
    ctx: RoleContext,
    listId: bigint,
    required: PermissionKey
  ): Promise<void> {
    if (ctx.role === 'owner') return;
    const assigned = await this.reader.isAssignedToList(ctx.staffId, listId);
    if (!assigned) {
      // Mask as not-found so list existence is never revealed to unassigned staff.
      throw new DeliveryNotFoundError();
    }
    if (!ctx.permissions.includes(required)) {
      throw new ForbiddenError('You do not have permission to perform this action');
    }
  }

  private actorRole(ctx: RoleContext): ActorRole {
    return ActorRoleVO.fromLabel(ctx.role);
  }

  // ============================================================
  // COMMAND: mark a single delivery
  // ============================================================

  async markDelivery(
    ctx: RoleContext,
    deliveryId: bigint,
    input: { status: 'DELIVERED' | 'LEAVE'; quantity?: number },
    meta: ActorMeta
  ): Promise<MarkDeliveryResultDto> {
    const correlationId = crypto.randomUUID();
    const record = await this.repository.findById(deliveryId, ctx.vendorId);
    if (!record) throw new DeliveryNotFoundError();

    const requiredGrant =
      input.status === 'LEAVE' ? PermissionKey.MARK_LEAVES : PermissionKey.MARK_DELIVERIES;
    await this.assertListPermission(ctx, record.supplyListId, requiredGrant);

    const total = await this.repository.getExtraChargesTotal(deliveryId);
    const entity = DailySupplyMapper.toDomain(record, total);
    const actor = this.actorRole(ctx);

    if (input.status === 'DELIVERED') {
      entity.markDelivered(actor, ctx.userId, input.quantity);
    } else {
      entity.markLeave(actor, ctx.userId);
    }
    const override = entity.consumePendingOverride();
    if (!override) throw new InternalServerError('Mark produced no override');

    try {
      await this.repository.applyMark(entity, override);
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.logger.error({ err: error, correlationId }, 'markDelivery: persist failed');
      throw new InternalServerError('Failed to mark delivery. Please try again.');
    }

    await this.auditLogger.log({
      vendorId: ctx.vendorId,
      performedByUserId: ctx.userId,
      performedByRole: ctx.roleName,
      action: AuditAction.DELIVERY_MARKED,
      entityType: 'daily_supply',
      entityId: deliveryId,
      metadata: { status: input.status },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
      correlationId,
    });

    const dto = await this.buildDeliveryDto(entity, ctx);
    return { delivery: dto, hasConflict: dto.hasConflict };
  }

  // ============================================================
  // COMMAND: bulk-mark a list+date
  // ============================================================

  async markBulk(
    ctx: RoleContext,
    input: { supplyListId: bigint; date: Date; excludeDeliveryIds: bigint[] },
    meta: ActorMeta
  ): Promise<MarkBulkResultDto> {
    const correlationId = crypto.randomUUID();
    await this.assertListPermission(ctx, input.supplyListId, PermissionKey.MARK_DELIVERIES);

    const ids = await this.repository.findMarkableIds(
      ctx.vendorId,
      input.supplyListId,
      input.date,
      input.excludeDeliveryIds
    );
    const actor = this.actorRole(ctx);

    let updated = 0;
    try {
      await this.repository.transaction(async (tx) => {
        for (const id of ids) {
          const record = await this.repository.findById(id, ctx.vendorId, tx);
          if (!record) continue;
          const total = await this.repository.getExtraChargesTotal(id, tx);
          const entity = DailySupplyMapper.toDomain(record, total);
          entity.markDelivered(actor, ctx.userId);
          const override = entity.consumePendingOverride();
          if (override) {
            await this.repository.applyMark(entity, override, tx);
            updated += 1;
          }
        }
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.logger.error({ err: error, correlationId }, 'markBulk: persist failed');
      throw new InternalServerError('Failed to bulk-mark deliveries. Please try again.');
    }

    await this.auditLogger.log({
      vendorId: ctx.vendorId,
      performedByUserId: ctx.userId,
      performedByRole: ctx.roleName,
      action: AuditAction.DELIVERIES_BULK_MARKED,
      entityType: 'supply_list',
      entityId: input.supplyListId,
      metadata: { updated, date: input.date.toISOString().slice(0, 10) },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
      correlationId,
    });

    return { updated, skipped: input.excludeDeliveryIds.length };
  }

  // ============================================================
  // COMMAND: add an extra charge
  // ============================================================

  async addExtraCharge(
    ctx: RoleContext,
    input: { dailySupplyId: bigint; amount: number; comment: string },
    meta: ActorMeta
  ): Promise<ExtraChargeResultDto> {
    const correlationId = crypto.randomUUID();
    const record = await this.repository.findById(input.dailySupplyId, ctx.vendorId);
    if (!record) throw new DeliveryNotFoundError();

    await this.assertListPermission(ctx, record.supplyListId, PermissionKey.ADD_EXTRA_CHARGES);

    const total = await this.repository.getExtraChargesTotal(input.dailySupplyId);
    const entity = DailySupplyMapper.toDomain(record, total);
    entity.addExtraCharge(input.amount); // throws ChargeOnNonDeliverableError on LEAVE/CANCELLED
    const newFinal = entity.getProps().finalAmount;
    const actor = this.actorRole(ctx);

    let charge: { id: bigint; createdAt: Date };
    try {
      charge = await this.repository.insertExtraCharge({
        dailySupplyId: input.dailySupplyId,
        amount: Math.round(input.amount * 100) / 100,
        comment: input.comment,
        addedByUserId: ctx.userId,
        addedByRole: actor,
        newFinalAmount: newFinal,
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.logger.error({ err: error, correlationId }, 'addExtraCharge: persist failed');
      throw new InternalServerError('Failed to add extra charge. Please try again.');
    }

    await this.auditLogger.log({
      vendorId: ctx.vendorId,
      performedByUserId: ctx.userId,
      performedByRole: ctx.roleName,
      action: AuditAction.EXTRA_CHARGE_ADDED,
      entityType: 'supply_extra_charge',
      entityId: charge.id,
      metadata: { dailySupplyId: input.dailySupplyId.toString(), amount: input.amount },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
      correlationId,
    });

    return {
      id: charge.id.toString(),
      dailySupplyId: input.dailySupplyId.toString(),
      amount: Math.round(input.amount * 100) / 100,
      comment: input.comment,
      addedBy: { userId: ctx.userId.toString(), name: null, role: ctx.role },
      createdAt: charge.createdAt.toISOString(),
    };
  }

  // ============================================================
  // COMMAND: create a leave across one or more lists
  // ============================================================

  async createLeave(
    ctx: RoleContext,
    input: {
      customerId: bigint;
      supplyListIds: bigint[];
      startDate: Date;
      endDate: Date;
      reason: string | null;
    },
    meta: ActorMeta
  ): Promise<CreateLeaveResultDto> {
    const correlationId = crypto.randomUUID();
    for (const listId of input.supplyListIds) {
      await this.assertListPermission(ctx, listId, PermissionKey.MARK_LEAVES);
    }

    const subscriptions = await this.reader.resolveSubscriptions(
      ctx.vendorId,
      input.customerId,
      input.supplyListIds
    );
    if (subscriptions.length === 0) throw new NoActiveSubscriptionError();

    const range = DateRange.create(input.startDate, input.endDate);
    const leaveType =
      ctx.role === 'owner' || ctx.role === 'staff' ? 'VENDOR_MARKED' : 'CUSTOMER_REQUESTED';
    const actor = this.actorRole(ctx);

    let affected = 0;
    const leaves: CreateLeaveResultDto['leaves'] = [];

    try {
      await this.repository.transaction(async (tx) => {
        for (const sub of subscriptions) {
          const leave = LeaveEntity.create({
            supplyListCustomerId: sub.subscriptionId,
            startDate: input.startDate,
            endDate: input.endDate,
            leaveType,
            reason: input.reason,
            createdByUserId: ctx.userId,
          });
          const created = await this.repository.insertLeave(leave, tx);
          leaves.push({
            id: created.id.toString(),
            customerId: input.customerId.toString(),
            supplyListId: sub.supplyListId.toString(),
            startDate: range.startDate.toIso(),
            endDate: range.endDate.toIso(),
            leaveType,
          });

          const supplies = await this.repository.findBySubscriptionInRange(
            sub.subscriptionId,
            range.startDate.value,
            range.endDate.value,
            tx
          );
          for (const record of supplies) {
            if (record.status === 'LEAVE' || record.status === 'CANCELLED') continue;
            const total = await this.repository.getExtraChargesTotal(record.id, tx);
            const entity = DailySupplyMapper.toDomain(record, total);
            entity.markLeave(actor, ctx.userId);
            const override = entity.consumePendingOverride();
            if (override) {
              await this.repository.applyMark(entity, override, tx);
              affected += 1;
            }
          }
        }
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.logger.error({ err: error, correlationId }, 'createLeave: persist failed');
      throw new InternalServerError('Failed to record leave. Please try again.');
    }

    await this.auditLogger.log({
      vendorId: ctx.vendorId,
      performedByUserId: ctx.userId,
      performedByRole: ctx.roleName,
      action: AuditAction.LEAVE_MARKED,
      entityType: 'leave',
      entityId: input.customerId,
      metadata: { created: leaves.length, affectedDeliveries: affected },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
      correlationId,
    });

    return { created: leaves.length, leaves, affectedDeliveries: affected };
  }

  // ============================================================
  // COMMAND: cancel a future leave
  // ============================================================

  async cancelLeave(
    ctx: RoleContext,
    leaveId: bigint,
    meta: ActorMeta
  ): Promise<{ revertedDeliveries: number }> {
    const correlationId = crypto.randomUUID();
    const leave = await this.repository.findLeaveById(leaveId);
    if (!leave) throw new LeaveNotFoundError();

    // Tenant + permission: resolve the subscription's list and check the grant.
    const customers = await this.reader.getSubscriptionCustomerIds([leave.supplyListCustomerId]);
    if (customers.size === 0) throw new LeaveNotFoundError();

    const supplies = await this.repository.findBySubscriptionInRange(
      leave.supplyListCustomerId,
      leave.startDate,
      leave.endDate
    );
    // Permission: the leave's list — derive from any covered supply, else allow owner.
    const listId = supplies[0]?.supplyListId;
    if (listId !== undefined) {
      await this.assertListPermission(ctx, listId, PermissionKey.MARK_LEAVES);
    } else if (ctx.role !== 'owner') {
      throw new ForbiddenError('You do not have permission to cancel this leave');
    }

    const today = appToday();
    if (leave.endDate.getTime() < today.getTime()) {
      throw new LeaveNotFoundError('Only future leaves can be cancelled');
    }

    let reverted = 0;
    const actor = this.actorRole(ctx);
    try {
      await this.repository.transaction(async (tx) => {
        await this.repository.deleteLeave(leaveId, tx);
        for (const record of supplies) {
          if (record.status !== 'LEAVE') continue;
          if (record.serviceDate.getTime() < today.getTime()) continue;
          const covered = await this.repository.countCoveringLeaves(
            leave.supplyListCustomerId,
            record.serviceDate,
            leaveId,
            tx
          );
          if (covered > 0) continue;
          const total = await this.repository.getExtraChargesTotal(record.id, tx);
          const entity = DailySupplyMapper.toDomain(record, total);
          entity.revertToPending(actor, ctx.userId);
          const override = entity.consumePendingOverride();
          if (override) {
            await this.repository.applyMark(entity, override, tx);
            reverted += 1;
          }
        }
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.logger.error({ err: error, correlationId }, 'cancelLeave: persist failed');
      throw new InternalServerError('Failed to cancel leave. Please try again.');
    }

    await this.auditLogger.log({
      vendorId: ctx.vendorId,
      performedByUserId: ctx.userId,
      performedByRole: ctx.roleName,
      action: AuditAction.LEAVE_CANCELLED,
      entityType: 'leave',
      entityId: leaveId,
      metadata: { revertedDeliveries: reverted },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
      correlationId,
    });

    return { revertedDeliveries: reverted };
  }

  // ============================================================
  // COMMAND: generate daily supplies for the caller's vendor
  // ============================================================

  async generate(ctx: RoleContext, date: Date, meta: ActorMeta): Promise<GenerateResultDto> {
    const correlationId = crypto.randomUUID();
    const result = await this.generateForVendor(ctx.vendorId, date, correlationId);

    await this.auditLogger.log({
      vendorId: ctx.vendorId,
      performedByUserId: ctx.userId,
      performedByRole: ctx.roleName,
      action: AuditAction.DELIVERIES_GENERATED,
      entityType: 'vendor',
      entityId: ctx.vendorId,
      metadata: { generated: result.generated, date: result.date },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
      correlationId,
    });

    return result;
  }

  /** Idempotent per-vendor fan-out. Reused by the cron. */
  async generateForVendor(
    vendorId: bigint,
    date: Date,
    correlationId: string
  ): Promise<GenerateResultDto> {
    const serviceDate = ServiceDate.create(date).value;
    const subscriptions = await this.reader.getActiveSubscriptionsForGeneration(
      vendorId,
      serviceDate
    );

    const rows = [];
    let skipped = 0;
    for (const sub of subscriptions) {
      if (!shouldGenerateForDate(sub.frequency, sub.frequencyDays, serviceDate)) {
        skipped += 1;
        continue;
      }
      const onLeave = await this.repository.hasLeaveCovering(sub.subscriptionId, serviceDate);
      const entity = DailySupplyEntity.create({
        vendorId: sub.vendorId,
        supplyListCustomerId: sub.subscriptionId,
        supplyListId: sub.supplyListId,
        serviceDate,
        quantity: sub.quantity,
        unit: sub.unit,
        ratePerUnit: sub.ratePerUnit,
        onLeave,
      });
      const props = entity.getProps();
      rows.push({
        vendorId: props.vendorId,
        supplyListCustomerId: props.supplyListCustomerId,
        supplyListId: props.supplyListId,
        serviceDate: props.serviceDate,
        status: props.status as DailySupplyStatus,
        quantity: props.quantity,
        unit: props.unit,
        ratePerUnit: props.ratePerUnit,
        baseAmount: props.baseAmount,
        finalAmount: props.finalAmount,
      });
    }

    const generated = await this.repository.insertGenerated(rows);
    const totalSkipped = skipped + (rows.length - generated);
    this.logger.info(
      { vendorId: vendorId.toString(), generated, skipped: totalSkipped, correlationId },
      'generateForVendor: generation run complete'
    );
    return { generated, skipped: totalSkipped, date: serviceDate.toISOString().slice(0, 10) };
  }

  // ============================================================
  // QUERY: today summary across lists
  // ============================================================

  async getToday(
    ctx: RoleContext,
    params: { date?: string; listId?: bigint }
  ): Promise<TodayResultDto> {
    const date = params.date ? isoToDate(params.date) : appToday();
    let listIds = await this.scopedListIds(ctx, params.listId);

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
      const conflicts = this.collectConflicts(records, overrides);
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

  // ============================================================
  // QUERY: per-customer deliveries for a list/date
  // ============================================================

  async getListDeliveries(
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
      const total = overridesTotalNull;
      const entity = DailySupplyMapper.toDomain(record, total);
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

  // ============================================================
  // QUERY: leaves (today + upcoming)
  // ============================================================

  async getLeaves(
    ctx: RoleContext,
    params: { status?: 'today' | 'upcoming' }
  ): Promise<ListLeavesResultDto> {
    const today = appToday();
    const from = params.status === 'upcoming' ? new Date(today.getTime() + 86_400_000) : today;
    const to = new Date(today.getTime() + 365 * 86_400_000);

    let subscriptionFilter: bigint[] | undefined;
    if (ctx.role !== 'owner') {
      const assignedListIds = await this.reader.getAssignedListIds(ctx.staffId);
      subscriptionFilter = await this.subscriptionIdsForLists(ctx.vendorId, assignedListIds);
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

  // ============================================================
  // QUERY: calendar (owner)
  // ============================================================

  async getCalendar(
    ctx: RoleContext,
    params: { month: string; listId?: bigint }
  ): Promise<CalendarResultDto> {
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
        dayConflicts += this.collectConflicts(records, overrides).length;
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

  // ============================================================
  // QUERY: day detail (owner)
  // ============================================================

  async getDateDetail(ctx: RoleContext, dateIso: string): Promise<DateDetailResultDto> {
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

  // ============================================================
  // Internal helpers
  // ============================================================

  private async scopedListIds(ctx: RoleContext, listId?: bigint): Promise<bigint[] | undefined> {
    if (ctx.role === 'owner') {
      return listId ? [listId] : undefined;
    }
    const assigned = await this.reader.getAssignedListIds(ctx.staffId);
    if (listId) {
      return assigned.includes(listId) ? [listId] : [];
    }
    return assigned;
  }

  private async subscriptionIdsForLists(vendorId: bigint, listIds: bigint[]): Promise<bigint[]> {
    if (listIds.length === 0) return [];
    const subs = await this.reader.resolveSubscriptionsForLists(vendorId, listIds);
    return subs;
  }

  private collectConflicts(
    records: Array<{ id: bigint; supplyListCustomerId: bigint }>,
    overrides: OverrideRow[]
  ): Array<{ deliveryId: bigint; subId: bigint; reason: string }> {
    const out: Array<{ deliveryId: bigint; subId: bigint; reason: string }> = [];
    for (const record of records) {
      const conflict = deriveConflict(
        overrides
          .filter((o) => o.dailySupplyId === record.id)
          .map((o) => ({ actorRole: o.actorRole, newStatus: o.newStatus, createdAt: o.createdAt }))
      );
      if (conflict.hasConflict && conflict.reason) {
        out.push({
          deliveryId: record.id,
          subId: record.supplyListCustomerId,
          reason: conflict.reason,
        });
      }
    }
    return out;
  }

  private async buildDeliveryDto(
    entity: DailySupplyEntity,
    ctx: RoleContext
  ): Promise<DeliveryDto> {
    const props = entity.getProps();
    const subCustomerIds = await this.reader.getSubscriptionCustomerIds([
      props.supplyListCustomerId,
    ]);
    const customerId = subCustomerIds.get(props.supplyListCustomerId.toString()) ?? 0n;
    const [customers, otherLists, overrides, markers] = await Promise.all([
      this.reader.getCustomerDisplay(ctx.vendorId, [customerId]),
      this.reader.getOtherListNames(ctx.vendorId, [customerId], props.supplyListId),
      this.repository.findOverridesFor([props.id]),
      props.markedByUserId !== null
        ? this.reader.getMarkerNames([props.markedByUserId])
        : Promise.resolve(new Map<string, string | null>()),
    ]);

    const conflict = deriveConflict(
      overrides.map((o) => ({
        actorRole: o.actorRole,
        newStatus: o.newStatus,
        createdAt: o.createdAt,
      }))
    );
    const marker =
      props.markedByUserId !== null
        ? {
            userId: props.markedByUserId,
            name: markers.get(props.markedByUserId.toString()) ?? null,
            role: latestActorRole(overrides, props.id),
          }
        : null;

    return DailySupplyMapper.toResponse(entity, {
      customer: customers.get(customerId.toString()) ?? {
        id: customerId,
        name: null,
        address: null,
        phoneNumber: null,
      },
      marker,
      conflict,
      otherLists: otherLists.get(customerId.toString()) ?? [],
      includeFinancials: ctx.role === 'owner',
    });
  }
}

// ============================================================
// Pure helpers
// ============================================================

// Placeholder constant: per-row charge total is folded server-side during reads
// where finalAmount already includes charges, so list reads pass 0 to the mapper
// (finalAmount is read straight from the record).
const overridesTotalNull = 0;

function countByStatus(records: Array<{ status: DailySupplyStatus; isAutoMarked?: boolean }>): {
  delivered: number;
  onLeave: number;
  pending: number;
  autoMarked: number;
} {
  let delivered = 0;
  let onLeave = 0;
  let pending = 0;
  let autoMarked = 0;
  for (const r of records) {
    switch (r.status) {
      case 'DELIVERED':
        delivered += 1;
        break;
      case 'LEAVE':
        onLeave += 1;
        break;
      case 'PENDING':
        pending += 1;
        break;
      case 'AUTO_MARKED':
        autoMarked += 1;
        delivered += 1;
        break;
      default:
        break;
    }
  }
  return { delivered, onLeave, pending, autoMarked };
}

function latestActorRole(overrides: OverrideRow[], dailySupplyId: bigint): ActorRole | null {
  const rows = overrides
    .filter((o) => o.dailySupplyId === dailySupplyId && ActorRoleVO.isVendorSide(o.actorRole))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return rows[0]?.actorRole ?? null;
}

function dayStatus(
  conflicts: number,
  pending: number,
  leaves: number
): 'completed' | 'has_leaves' | 'pending' | 'has_conflicts' {
  if (conflicts > 0) return 'has_conflicts';
  if (pending > 0) return 'pending';
  if (leaves > 0) return 'has_leaves';
  return 'completed';
}

/** Whether a subscription should produce a row on a date given its schedule. */
export function shouldGenerateForDate(
  frequency: string,
  frequencyDays: number[],
  date: Date
): boolean {
  if (frequency === 'DAILY') return true;
  if (frequency === 'WEEKLY') {
    // Map JS Sunday=0..Saturday=6 to 1..7 (Mon=1..Sun=7).
    const jsDay = date.getUTCDay();
    const isoDay = jsDay === 0 ? 7 : jsDay;
    return frequencyDays.includes(isoDay);
  }
  if (frequency === 'MONTHLY') {
    return frequencyDays.includes(date.getUTCDate());
  }
  return false;
}
