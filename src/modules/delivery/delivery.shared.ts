import { ActorRole, DailySupplyStatus } from '@prisma/client';
import { ForbiddenError } from '@/common/errors/app-error';
import { RoleContext } from '@/infrastructure/middlewares/rbac/role-context';
import { PermissionKey } from '@/modules/staff/domain/value-objects/permission-key.value-object';
import {
  ActorRoleVO,
  DailySupplyEntity,
  DailySupplyMapper,
  DeliveryNotFoundError,
  deriveConflict,
  ServiceDate,
} from './delivery.domain';
import { IDeliveryRepository, OverrideRow } from './delivery.repository.port';
import { DeliveryReader } from './delivery.reader';
import { DeliveryDto } from './delivery.types';

const APP_TIMEZONE_OFFSET_MIN = 330; // Asia/Kolkata (UTC+5:30) — OQ-4.

/** Request metadata captured for audit entries. */
export interface ActorMeta {
  ip: string | null;
  userAgent: string | null;
}

/** Current service date in the app timezone, normalized to a UTC midnight Date. */
export function appToday(now: Date = new Date()): Date {
  const shifted = new Date(now.getTime() + APP_TIMEZONE_OFFSET_MIN * 60_000);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
}

/** The service date for "yesterday" in the app timezone. */
export function appYesterday(now: Date = new Date()): Date {
  const today = appToday(now);
  return new Date(today.getTime() - 86_400_000);
}

export function isoToDate(iso: string): Date {
  return ServiceDate.fromIso(iso).value;
}

// Placeholder constant: per-row charge total is folded server-side during reads
// where finalAmount already includes charges, so list reads pass 0 to the mapper
// (finalAmount is read straight from the record).
export const overridesTotalNull = 0;

export function countByStatus(
  records: Array<{ status: DailySupplyStatus; isAutoMarked?: boolean }>
): {
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

export function latestActorRole(overrides: OverrideRow[], dailySupplyId: bigint): ActorRole | null {
  const rows = overrides
    .filter((o) => o.dailySupplyId === dailySupplyId && ActorRoleVO.isVendorSide(o.actorRole))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return rows[0]?.actorRole ?? null;
}

export function dayStatus(
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

/**
 * Shared cross-cutting access helpers used by every delivery command/query:
 * permission masking, actor-role resolution, list scoping, conflict collection,
 * and single-delivery DTO assembly.
 */
export class DeliveryAccess {
  constructor(
    private readonly repository: IDeliveryRepository,
    private readonly reader: DeliveryReader
  ) {}

  async assertListPermission(
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

  actorRole(ctx: RoleContext): ActorRole {
    return ActorRoleVO.fromLabel(ctx.role);
  }

  async scopedListIds(ctx: RoleContext, listId?: bigint): Promise<bigint[] | undefined> {
    if (ctx.role === 'owner') {
      return listId ? [listId] : undefined;
    }
    const assigned = await this.reader.getAssignedListIds(ctx.staffId);
    if (listId) {
      return assigned.includes(listId) ? [listId] : [];
    }
    return assigned;
  }

  async subscriptionIdsForLists(vendorId: bigint, listIds: bigint[]): Promise<bigint[]> {
    if (listIds.length === 0) return [];
    return this.reader.resolveSubscriptionsForLists(vendorId, listIds);
  }

  collectConflicts(
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

  async buildDeliveryDto(entity: DailySupplyEntity, ctx: RoleContext): Promise<DeliveryDto> {
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
