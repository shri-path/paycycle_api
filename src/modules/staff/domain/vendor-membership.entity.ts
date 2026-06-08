import { VendorUserStatus } from '@prisma/client';
import { ArgumentInvalidException, ForbiddenError } from '@/common/errors/app-error';
import {
  VendorMembershipProps,
  CreateInvitedMembershipProps,
  CreateOwnerMembershipProps,
  ReconstituteMembershipData,
  PermissionGrant,
  isOwnerRole,
} from './vendor-membership.types';
import { MembershipStatus } from './value-objects/membership-status.value-object';
import { PermissionKey, PermissionKeyVO } from './value-objects/permission-key.value-object';
import { StaffJoinedEvent } from './events/staff-joined.domain-event';
import { StaffDisabledEvent } from './events/staff-disabled.domain-event';
import { StaffEnabledEvent } from './events/staff-enabled.domain-event';
import { StaffRemovedEvent } from './events/staff-removed.domain-event';
import { StaffPermissionsChangedEvent } from './events/staff-permissions-changed.domain-event';

const MAX_AREA_LABEL_LENGTH = 200;

type DomainEvent =
  | StaffJoinedEvent
  | StaffDisabledEvent
  | StaffEnabledEvent
  | StaffRemovedEvent
  | StaffPermissionsChangedEvent;

/**
 * Aggregate root for a user's membership in one vendor.
 * Owns its StaffPermission grants within the aggregate boundary.
 */
export class VendorMembershipEntity {
  private readonly _id: bigint;
  private readonly _createdAt: Date;
  private _updatedAt: Date;
  private _props: VendorMembershipProps;
  private _domainEvents: DomainEvent[] = [];

  private constructor(id: bigint, createdAt: Date, updatedAt: Date, props: VendorMembershipProps) {
    this._id = id;
    this._createdAt = createdAt;
    this._updatedAt = updatedAt;
    this._props = props;
  }

  get id(): bigint {
    return this._id;
  }

  get status(): VendorUserStatus {
    return this._props.status;
  }

  get isOwner(): boolean {
    return isOwnerRole(this._props.roleName);
  }

  get vendorId(): bigint {
    return this._props.vendorId;
  }

  get userId(): bigint {
    return this._props.userId;
  }

  getProps(): Readonly<VendorMembershipProps & { id: bigint; createdAt: Date; updatedAt: Date }> {
    return Object.freeze({
      id: this._id,
      createdAt: this._createdAt,
      updatedAt: this._updatedAt,
      ...this._props,
      permissions: [...this._props.permissions],
    });
  }

  /** Granted permission keys only (whitelist). Owners report all keys. */
  grantedPermissions(): PermissionKey[] {
    if (this.isOwner) {
      return PermissionKeyVO.all();
    }
    return this._props.permissions.filter((p) => p.granted).map((p) => p.key);
  }

  equals(other?: VendorMembershipEntity): boolean {
    if (!other) return false;
    return this._id === other._id;
  }

  getDomainEvents(): DomainEvent[] {
    return [...this._domainEvents];
  }

  clearDomainEvents(): void {
    this._domainEvents = [];
  }

  private addDomainEvent(event: DomainEvent): void {
    this._domainEvents.push(event);
  }

  // === Factories ===

  static createInvited(props: CreateInvitedMembershipProps): VendorMembershipEntity {
    const entity = new VendorMembershipEntity(0n, new Date(), new Date(), {
      vendorId: props.vendorId,
      userId: props.userId,
      roleId: props.roleId,
      roleName: props.roleName,
      status: VendorUserStatus.INVITED,
      phone: props.phone,
      areaRouteLabel: props.areaRouteLabel,
      permissions: normalizeGrants(props.permissions),
      invitedAt: new Date(),
      joinedAt: null,
      disabledAt: null,
      removedAt: null,
      deletedAt: null,
    });
    entity.validate();
    return entity;
  }

  static createOwner(props: CreateOwnerMembershipProps): VendorMembershipEntity {
    const entity = new VendorMembershipEntity(0n, new Date(), new Date(), {
      vendorId: props.vendorId,
      userId: props.userId,
      roleId: props.roleId,
      roleName: props.roleName,
      status: VendorUserStatus.ACTIVE,
      phone: props.phone,
      areaRouteLabel: null,
      permissions: [],
      invitedAt: null,
      joinedAt: new Date(),
      disabledAt: null,
      removedAt: null,
      deletedAt: null,
    });
    entity.validate();
    return entity;
  }

  static reconstitute(data: ReconstituteMembershipData): VendorMembershipEntity {
    const entity = new VendorMembershipEntity(data.id, data.createdAt, data.updatedAt, {
      ...data.props,
      permissions: normalizeGrants(data.props.permissions),
    });
    entity.validate();
    return entity;
  }

  // === State transitions ===

  activate(correlationId: string): void {
    this.transition(VendorUserStatus.ACTIVE);
    this._props.joinedAt = this._props.joinedAt ?? new Date();
    this.addDomainEvent(
      new StaffJoinedEvent(this._id, this._props.vendorId, this._props.userId, correlationId)
    );
  }

  disable(disabledByUserId: bigint, correlationId: string): void {
    this.assertNotOwner('Cannot disable the owner membership');
    this.transition(VendorUserStatus.DISABLED);
    this._props.disabledAt = new Date();
    this.addDomainEvent(
      new StaffDisabledEvent(
        this._id,
        this._props.vendorId,
        this._props.userId,
        disabledByUserId,
        correlationId
      )
    );
  }

  enable(correlationId: string): void {
    this.assertNotOwner('Cannot enable the owner membership');
    this.transition(VendorUserStatus.ACTIVE);
    this._props.disabledAt = null;
    this.addDomainEvent(
      new StaffEnabledEvent(this._id, this._props.vendorId, this._props.userId, correlationId)
    );
  }

  remove(removedByUserId: bigint, correlationId: string): void {
    this.assertNotOwner('Cannot remove the owner membership');
    this.transition(VendorUserStatus.REMOVED);
    const now = new Date();
    this._props.removedAt = now;
    this._props.deletedAt = now;
    this.addDomainEvent(
      new StaffRemovedEvent(
        this._id,
        this._props.vendorId,
        this._props.userId,
        removedByUserId,
        correlationId
      )
    );
  }

  /**
   * Reactivate a previously REMOVED membership for re-invite (OQ-8).
   * Moves back to INVITED and clears removal markers.
   */
  reinvite(permissions: PermissionGrant[], areaRouteLabel: string | null): void {
    this.assertNotOwner('Cannot re-invite the owner membership');
    this._props.status = VendorUserStatus.INVITED;
    this._props.removedAt = null;
    this._props.deletedAt = null;
    this._props.joinedAt = null;
    this._props.disabledAt = null;
    this._props.invitedAt = new Date();
    this._props.areaRouteLabel = areaRouteLabel;
    this._props.permissions = normalizeGrants(permissions);
    this._updatedAt = new Date();
    this.validate();
  }

  updateArea(label: string | null): void {
    if (label !== null && label.length > MAX_AREA_LABEL_LENGTH) {
      throw new ArgumentInvalidException(
        `areaRouteLabel must be at most ${MAX_AREA_LABEL_LENGTH} characters`
      );
    }
    this._props.areaRouteLabel = label;
    this._updatedAt = new Date();
  }

  setPermissions(grants: PermissionGrant[], correlationId: string): void {
    if (this.isOwner) {
      // Owner is all-allow; grants are ignored (invariant 5).
      return;
    }
    const before = this.grantedPermissions();
    this._props.permissions = normalizeGrants(grants);
    this._updatedAt = new Date();
    const after = this.grantedPermissions();
    this.addDomainEvent(
      new StaffPermissionsChangedEvent(
        this._id,
        this._props.vendorId,
        this._props.userId,
        before,
        after,
        correlationId
      )
    );
  }

  private transition(next: VendorUserStatus): void {
    MembershipStatus.create(this._props.status).assertTransition(next);
    this._props.status = next;
    this._updatedAt = new Date();
  }

  private assertNotOwner(message: string): void {
    if (this.isOwner) {
      throw new ForbiddenError(message);
    }
  }

  // === Invariants ===

  private validate(): void {
    if (!Object.values(VendorUserStatus).includes(this._props.status)) {
      throw new ArgumentInvalidException(`Invalid membership status: ${this._props.status}`);
    }

    // Owner membership must be ACTIVE (never DISABLED/REMOVED via staff flows).
    if (this.isOwner && this._props.status !== VendorUserStatus.ACTIVE) {
      throw new ArgumentInvalidException('Owner membership must be ACTIVE');
    }

    for (const grant of this._props.permissions) {
      if (!PermissionKeyVO.isValid(grant.key)) {
        throw new ArgumentInvalidException(`Invalid permission key: ${String(grant.key)}`);
      }
    }

    if (
      this._props.areaRouteLabel !== null &&
      this._props.areaRouteLabel.length > MAX_AREA_LABEL_LENGTH
    ) {
      throw new ArgumentInvalidException(
        `areaRouteLabel must be at most ${MAX_AREA_LABEL_LENGTH} characters`
      );
    }
  }
}

/**
 * Dedupe grants by key (last wins) and drop any with invalid keys early.
 */
function normalizeGrants(grants: PermissionGrant[]): PermissionGrant[] {
  const map = new Map<PermissionKey, boolean>();
  for (const g of grants) {
    map.set(PermissionKeyVO.from(g.key), g.granted);
  }
  return Array.from(map.entries()).map(([key, granted]) => ({ key, granted }));
}
