import { StaffInvitationStatus } from '@prisma/client';
import { ArgumentInvalidException } from '@/common/errors/app-error';
import {
  StaffInvitationProps,
  CreateInvitationProps,
  ReconstituteInvitationData,
  INVITATION_TTL_MS,
} from './staff-invitation.types';
import { InviteToken } from './value-objects/invite-token.value-object';
import { ExpiredInviteError, InvalidInviteError } from './staff.errors';

/**
 * Aggregate root for a time-boxed, single-use staff invite token.
 * Persists only the sha256 token hash — never the raw token.
 */
export class StaffInvitationEntity {
  private readonly _id: bigint;
  private readonly _createdAt: Date;
  private _updatedAt: Date;
  private _props: StaffInvitationProps;

  private constructor(id: bigint, createdAt: Date, updatedAt: Date, props: StaffInvitationProps) {
    this._id = id;
    this._createdAt = createdAt;
    this._updatedAt = updatedAt;
    this._props = props;
  }

  get id(): bigint {
    return this._id;
  }

  get status(): StaffInvitationStatus {
    return this._props.status;
  }

  get vendorUserId(): bigint {
    return this._props.vendorUserId;
  }

  get vendorId(): bigint {
    return this._props.vendorId;
  }

  get expiresAt(): Date {
    return this._props.expiresAt;
  }

  getProps(): Readonly<StaffInvitationProps & { id: bigint; createdAt: Date; updatedAt: Date }> {
    return Object.freeze({
      id: this._id,
      createdAt: this._createdAt,
      updatedAt: this._updatedAt,
      ...this._props,
    });
  }

  // === Factories ===

  /**
   * Create a PENDING invitation with a 7-day expiry. The hash of the supplied
   * raw token is stored; the raw token is returned out-of-band by the service.
   */
  static create(props: CreateInvitationProps, rawToken: string): StaffInvitationEntity {
    const now = new Date();
    const entity = new StaffInvitationEntity(0n, now, now, {
      vendorId: props.vendorId,
      vendorUserId: props.vendorUserId,
      invitedByUserId: props.invitedByUserId,
      phone: props.phone,
      tokenHash: InviteToken.hash(rawToken),
      status: StaffInvitationStatus.PENDING,
      expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
      acceptedAt: null,
      revokedAt: null,
    });
    entity.validate();
    return entity;
  }

  static reconstitute(data: ReconstituteInvitationData): StaffInvitationEntity {
    const entity = new StaffInvitationEntity(data.id, data.createdAt, data.updatedAt, data.props);
    entity.validate();
    return entity;
  }

  // === Behaviour ===

  isUsable(now: Date = new Date()): boolean {
    return this._props.status === StaffInvitationStatus.PENDING && now < this._props.expiresAt;
  }

  /**
   * Accept the invitation. Throws InvalidInviteError if not PENDING,
   * ExpiredInviteError if past expiry.
   */
  accept(now: Date = new Date()): void {
    if (this._props.status !== StaffInvitationStatus.PENDING) {
      throw new InvalidInviteError('Invitation is no longer valid');
    }
    if (now >= this._props.expiresAt) {
      throw new ExpiredInviteError('Invitation has expired');
    }
    this._props.status = StaffInvitationStatus.ACCEPTED;
    this._props.acceptedAt = now;
    this._updatedAt = now;
  }

  revoke(): void {
    if (this._props.status === StaffInvitationStatus.PENDING) {
      this._props.status = StaffInvitationStatus.REVOKED;
      this._props.revokedAt = new Date();
      this._updatedAt = new Date();
    }
  }

  // === Invariants ===

  private validate(): void {
    if (this._props.expiresAt <= this._createdAt) {
      throw new ArgumentInvalidException('Invitation expiresAt must be after createdAt');
    }
    if (!InviteToken.isValidHash(this._props.tokenHash)) {
      throw new ArgumentInvalidException(
        'Invitation tokenHash must be a 64-char sha256 hex digest'
      );
    }
    if (!this._props.phone || this._props.phone.trim().length === 0) {
      throw new ArgumentInvalidException('Invitation phone must not be empty');
    }
    if (!Object.values(StaffInvitationStatus).includes(this._props.status)) {
      throw new ArgumentInvalidException(`Invalid invitation status: ${this._props.status}`);
    }
  }
}
