import { ListAssignmentPort } from '@/modules/staff/ports/list-assignment.port';
import { PermissionKey } from '@/modules/staff/domain/value-objects/permission-key.value-object';
import { RoleContext } from './role-context';

/**
 * Server-side permission evaluation (story: never trust the frontend).
 *
 * Owners are always-allow. For staff, a capability requires BOTH the granted
 * permission key AND (for list-scoped actions) an assignment to the relevant
 * list/customer — resolved via ListAssignmentPort. The port is fail-closed
 * until US-005 (OQ-1), so staff list-scoped checks return false for now.
 */
export class PermissionService {
  constructor(private readonly listAssignmentPort: ListAssignmentPort) {}

  private isOwner(ctx: RoleContext): boolean {
    return ctx.role === 'owner';
  }

  private hasGrant(ctx: RoleContext, key: PermissionKey): boolean {
    return ctx.permissions.includes(key);
  }

  // === Vendor-scoped capability checks (no specific list) ===

  hasCapability(ctx: RoleContext, key: PermissionKey): boolean {
    return this.isOwner(ctx) || this.hasGrant(ctx, key);
  }

  // === List-scoped capability checks ===

  async canViewSupplyList(ctx: RoleContext, listId: bigint): Promise<boolean> {
    if (this.isOwner(ctx)) return true;
    return this.listAssignmentPort.isAssignedToList(ctx.staffId, listId);
  }

  canEditSupplyList(ctx: RoleContext, _listId: bigint): Promise<boolean> {
    // List editing is owner-exclusive.
    return Promise.resolve(this.isOwner(ctx));
  }

  async canMarkDelivery(ctx: RoleContext, listId: bigint): Promise<boolean> {
    if (this.isOwner(ctx)) return true;
    if (!this.hasGrant(ctx, PermissionKey.MARK_DELIVERIES)) return false;
    return this.listAssignmentPort.isAssignedToList(ctx.staffId, listId);
  }

  async canMarkLeave(ctx: RoleContext, customerId: bigint): Promise<boolean> {
    if (this.isOwner(ctx)) return true;
    if (!this.hasGrant(ctx, PermissionKey.MARK_LEAVES)) return false;
    return this.listAssignmentPort.isCustomerInAssignedList(ctx.staffId, customerId);
  }

  async canAddExtraCharge(ctx: RoleContext, customerId: bigint): Promise<boolean> {
    if (this.isOwner(ctx)) return true;
    if (!this.hasGrant(ctx, PermissionKey.ADD_EXTRA_CHARGES)) return false;
    return this.listAssignmentPort.isCustomerInAssignedList(ctx.staffId, customerId);
  }

  canMarkPayment(ctx: RoleContext, _customerId: bigint): Promise<boolean> {
    // Marking payments is owner-exclusive.
    return Promise.resolve(this.isOwner(ctx));
  }
}
