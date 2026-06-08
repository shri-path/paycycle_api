import { VendorUserStatus } from '@prisma/client';
import { InvalidStatusTransitionError } from '../staff.errors';

/**
 * State machine for a vendor membership lifecycle.
 *
 * INVITED  --activate--> ACTIVE
 * ACTIVE   --disable-->  DISABLED
 * DISABLED --enable-->   ACTIVE
 * ACTIVE/DISABLED --remove--> REMOVED (terminal)
 */
const VALID_TRANSITIONS: Record<VendorUserStatus, VendorUserStatus[]> = {
  [VendorUserStatus.INVITED]: [VendorUserStatus.ACTIVE, VendorUserStatus.REMOVED],
  [VendorUserStatus.ACTIVE]: [VendorUserStatus.DISABLED, VendorUserStatus.REMOVED],
  [VendorUserStatus.DISABLED]: [VendorUserStatus.ACTIVE, VendorUserStatus.REMOVED],
  [VendorUserStatus.REMOVED]: [],
};

export class MembershipStatus {
  private readonly _value: VendorUserStatus;

  private constructor(value: VendorUserStatus) {
    this._value = value;
  }

  static create(value: VendorUserStatus): MembershipStatus {
    return new MembershipStatus(value);
  }

  get value(): VendorUserStatus {
    return this._value;
  }

  canTransitionTo(next: VendorUserStatus): boolean {
    return VALID_TRANSITIONS[this._value].includes(next);
  }

  /**
   * Throws InvalidStatusTransitionError (422) when the transition is illegal.
   */
  assertTransition(next: VendorUserStatus): void {
    if (!this.canTransitionTo(next)) {
      const allowed = VALID_TRANSITIONS[this._value];
      throw new InvalidStatusTransitionError(
        `Cannot transition membership from ${this._value} to ${next}. ` +
          `Allowed: ${allowed.join(', ') || 'none (terminal)'}`
      );
    }
  }

  isTerminal(): boolean {
    return VALID_TRANSITIONS[this._value].length === 0;
  }

  equals(other: MembershipStatus): boolean {
    return this._value === other._value;
  }
}
