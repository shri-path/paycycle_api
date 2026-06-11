import { InvalidSubscriptionTransitionError } from '../supply-list.errors';

/**
 * Subscription lifecycle status, modeled over `is_active` + `end_date`.
 *
 * ACTIVE  ⇄ PAUSED
 * ACTIVE|PAUSED → ENDED (terminal)
 */
export type SubscriptionStatusValue = 'ACTIVE' | 'PAUSED' | 'ENDED';

const VALID_TRANSITIONS: Record<SubscriptionStatusValue, SubscriptionStatusValue[]> = {
  ACTIVE: ['PAUSED', 'ENDED'],
  PAUSED: ['ACTIVE', 'ENDED'],
  ENDED: [],
};

export class SubscriptionStatus {
  private readonly _value: SubscriptionStatusValue;

  private constructor(value: SubscriptionStatusValue) {
    this._value = value;
  }

  static create(value: SubscriptionStatusValue): SubscriptionStatus {
    return new SubscriptionStatus(value);
  }

  /** Derive the status from the persisted `is_active` + `end_date` columns. */
  static fromPersistence(isActive: boolean, endDate: Date | null): SubscriptionStatus {
    if (endDate !== null) return new SubscriptionStatus('ENDED');
    return new SubscriptionStatus(isActive ? 'ACTIVE' : 'PAUSED');
  }

  get value(): SubscriptionStatusValue {
    return this._value;
  }

  canTransitionTo(next: SubscriptionStatusValue): boolean {
    return VALID_TRANSITIONS[this._value].includes(next);
  }

  assertTransition(next: SubscriptionStatusValue): void {
    // Terminal-state guard must run BEFORE any same-value short-circuit:
    // an ENDED subscription has no outgoing transitions (not even ENDED → ENDED).
    if (this.isTerminal()) {
      const allowed = VALID_TRANSITIONS[this._value];
      throw new InvalidSubscriptionTransitionError(
        `Cannot transition subscription from ${this._value} to ${next}. ` +
          `Allowed: ${allowed.join(', ') || 'none (terminal)'}`
      );
    }
    if (this._value === next) return;
    if (!this.canTransitionTo(next)) {
      const allowed = VALID_TRANSITIONS[this._value];
      throw new InvalidSubscriptionTransitionError(
        `Cannot transition subscription from ${this._value} to ${next}. ` +
          `Allowed: ${allowed.join(', ') || 'none (terminal)'}`
      );
    }
  }

  isTerminal(): boolean {
    return VALID_TRANSITIONS[this._value].length === 0;
  }

  equals(other?: SubscriptionStatus): boolean {
    if (!other) return false;
    return this._value === other._value;
  }
}
