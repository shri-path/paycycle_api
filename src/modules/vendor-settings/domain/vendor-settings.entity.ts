/**
 * VendorSettingsEntity — aggregate root.
 * Framework-free: no Prisma, Express, or Pino imports.
 */
import { TimeOfDay } from './value-objects/time-of-day.vo';
import { CreditLimit } from './value-objects/credit-limit.vo';
import { CreditPeriod } from './value-objects/credit-period.vo';
import {
  InvalidTimeOfDayError,
  InvalidNotificationPreferencesError,
  InvalidCreditLimitError,
  InvalidCreditPeriodError,
} from './vendor-settings.errors';
import { VendorSettingsUpdatedEvent } from './events/vendor-settings-updated.domain-event';
import { NotificationPreferencesUpdatedEvent } from './events/notification-preferences-updated.domain-event';
import {
  VendorSettingsProps,
  VendorSettingsCreateProps,
  VendorSettingsPatch,
} from './vendor-settings.types';
import { DomainEventMetadata } from '@/modules/auth/domain/events/domain-event.base';

type AnySettingsEvent = VendorSettingsUpdatedEvent | NotificationPreferencesUpdatedEvent;

export class VendorSettingsEntity {
  private _events: AnySettingsEvent[] = [];

  private constructor(
    private _id: bigint,
    private readonly _createdAt: Date,
    private _updatedAt: Date,
    private _props: VendorSettingsProps
  ) {}

  // ── Getters ───────────────────────────────────────────────────────────────

  get id(): bigint {
    return this._id;
  }
  get createdAt(): Date {
    return this._createdAt;
  }
  get updatedAt(): Date {
    return this._updatedAt;
  }
  get vendorId(): bigint {
    return this._props.vendorId;
  }
  get autoMarkEnabled(): boolean {
    return this._props.autoMarkEnabled;
  }
  get autoSendBillsEnabled(): boolean {
    return this._props.autoSendBillsEnabled;
  }
  get autoSendBillsTime(): string {
    return this._props.autoSendBillsTime;
  }
  get notificationPreferences(): Record<string, unknown> {
    return this._props.notificationPreferences;
  }
  get defaultCreditLimit(): string | null {
    return this._props.defaultCreditLimit;
  }
  get defaultCreditPeriodDays(): number | null {
    return this._props.defaultCreditPeriodDays;
  }
  get bulkOperationConcurrencyLimit(): number {
    return this._props.bulkOperationConcurrencyLimit;
  }

  getProps(): Readonly<VendorSettingsProps & { id: bigint; createdAt: Date; updatedAt: Date }> {
    return Object.freeze({
      ...this._props,
      id: this._id,
      createdAt: this._createdAt,
      updatedAt: this._updatedAt,
    });
  }

  pullEvents(): AnySettingsEvent[] {
    const events = [...this._events];
    this._events = [];
    return events;
  }

  // ── Invariants ────────────────────────────────────────────────────────────

  private validate(): void {
    // 1. autoSendBillsTime must be a valid TimeOfDay
    try {
      TimeOfDay.create(this._props.autoSendBillsTime);
    } catch {
      throw new InvalidTimeOfDayError(this._props.autoSendBillsTime);
    }

    // 2. notificationPreferences must be a plain object (not array or primitive)
    const prefs = this._props.notificationPreferences;
    if (prefs === null || typeof prefs !== 'object' || Array.isArray(prefs)) {
      throw new InvalidNotificationPreferencesError();
    }

    // 3. defaultCreditLimit must be valid when set
    if (this._props.defaultCreditLimit !== null) {
      CreditLimit.create(this._props.defaultCreditLimit);
    }

    // 4. defaultCreditPeriodDays must be in 1..365 when set
    if (
      this._props.defaultCreditPeriodDays !== null &&
      this._props.defaultCreditPeriodDays !== undefined
    ) {
      CreditPeriod.create(this._props.defaultCreditPeriodDays);
    }

    // 5. bulkOperationConcurrencyLimit must be integer 1..500
    const limit = this._props.bulkOperationConcurrencyLimit;
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new Error(`bulkOperationConcurrencyLimit must be an integer between 1 and 500.`);
    }
  }

  // ── Factory: create new settings with defaults ────────────────────────────

  static create(props: VendorSettingsCreateProps, now?: Date): VendorSettingsEntity {
    const ts = now ?? new Date();
    const entity = new VendorSettingsEntity(0n, ts, ts, {
      vendorId: props.vendorId,
      autoMarkEnabled: props.autoMarkEnabled ?? true,
      autoSendBillsEnabled: props.autoSendBillsEnabled ?? false,
      autoSendBillsTime: props.autoSendBillsTime ?? '20:00',
      notificationPreferences: props.notificationPreferences ?? {},
      defaultCreditLimit: props.defaultCreditLimit ?? null,
      defaultCreditPeriodDays: props.defaultCreditPeriodDays ?? null,
      bulkOperationConcurrencyLimit: props.bulkOperationConcurrencyLimit ?? 50,
    });
    entity.validate();
    return entity;
  }

  // ── Factory: reconstitute from persistence ───────────────────────────────

  static fromPersistence(row: {
    id: bigint;
    vendorId: bigint;
    autoMarkEnabled: boolean;
    autoSendBillsEnabled: boolean;
    autoSendBillsTime: string;
    notificationPreferences: Record<string, unknown>;
    defaultCreditLimit?: string | null;
    defaultCreditPeriodDays?: number | null;
    bulkOperationConcurrencyLimit?: number;
    createdAt: Date;
    updatedAt: Date;
  }): VendorSettingsEntity {
    const entity = new VendorSettingsEntity(row.id, row.createdAt, row.updatedAt, {
      vendorId: row.vendorId,
      autoMarkEnabled: row.autoMarkEnabled,
      autoSendBillsEnabled: row.autoSendBillsEnabled,
      autoSendBillsTime: row.autoSendBillsTime,
      notificationPreferences: row.notificationPreferences,
      defaultCreditLimit: row.defaultCreditLimit ?? null,
      defaultCreditPeriodDays: row.defaultCreditPeriodDays ?? null,
      bulkOperationConcurrencyLimit: row.bulkOperationConcurrencyLimit ?? 50,
    });
    entity.validate();
    return entity;
  }

  /** Assign a persisted ID after insert. */
  assignId(id: bigint): void {
    this._id = id;
  }

  // ── Behaviour: update ────────────────────────────────────────────────────

  update(patch: VendorSettingsPatch, metadata?: DomainEventMetadata): void {
    const changed: string[] = [];

    if (
      patch.autoMarkEnabled !== undefined &&
      patch.autoMarkEnabled !== this._props.autoMarkEnabled
    ) {
      this._props = { ...this._props, autoMarkEnabled: patch.autoMarkEnabled };
      changed.push('autoMarkEnabled');
    }
    if (
      patch.autoSendBillsEnabled !== undefined &&
      patch.autoSendBillsEnabled !== this._props.autoSendBillsEnabled
    ) {
      this._props = { ...this._props, autoSendBillsEnabled: patch.autoSendBillsEnabled };
      changed.push('autoSendBillsEnabled');
    }
    if (
      patch.autoSendBillsTime !== undefined &&
      patch.autoSendBillsTime !== this._props.autoSendBillsTime
    ) {
      this._props = { ...this._props, autoSendBillsTime: patch.autoSendBillsTime };
      changed.push('autoSendBillsTime');
    }
    if (patch.notificationPreferences !== undefined) {
      this._props = { ...this._props, notificationPreferences: patch.notificationPreferences };
      changed.push('notificationPreferences');
    }
    if ('defaultCreditLimit' in patch) {
      const newVal = patch.defaultCreditLimit ?? null;
      if (newVal !== this._props.defaultCreditLimit) {
        this._props = { ...this._props, defaultCreditLimit: newVal };
        changed.push('defaultCreditLimit');
      }
    }
    if ('defaultCreditPeriodDays' in patch) {
      const newVal = patch.defaultCreditPeriodDays ?? null;
      if (newVal !== this._props.defaultCreditPeriodDays) {
        this._props = { ...this._props, defaultCreditPeriodDays: newVal };
        changed.push('defaultCreditPeriodDays');
      }
    }
    if (
      patch.bulkOperationConcurrencyLimit !== undefined &&
      patch.bulkOperationConcurrencyLimit !== this._props.bulkOperationConcurrencyLimit
    ) {
      this._props = {
        ...this._props,
        bulkOperationConcurrencyLimit: patch.bulkOperationConcurrencyLimit,
      };
      changed.push('bulkOperationConcurrencyLimit');
    }

    try {
      this.validate();
    } catch (err) {
      if (err instanceof InvalidCreditLimitError || err instanceof InvalidCreditPeriodError) {
        throw err;
      }
      throw err;
    }

    this._updatedAt = new Date();

    const meta: DomainEventMetadata = metadata ?? { correlationId: 'system' };
    this._events.push(
      new VendorSettingsUpdatedEvent(
        {
          aggregateId: this._id,
          vendorId: this._props.vendorId,
          changed,
          autoMarkEnabled: this._props.autoMarkEnabled,
          autoSendBillsEnabled: this._props.autoSendBillsEnabled,
          autoSendBillsTime: this._props.autoSendBillsTime,
        },
        meta
      )
    );
  }

  // ── Behaviour: updateNotificationPreferences ──────────────────────────────

  updateNotificationPreferences(
    prefs: Record<string, unknown>,
    metadata?: DomainEventMetadata
  ): void {
    if (prefs === null || typeof prefs !== 'object' || Array.isArray(prefs)) {
      throw new InvalidNotificationPreferencesError();
    }

    const oldKeys = Object.keys(this._props.notificationPreferences);
    const newKeys = Object.keys(prefs);
    const changedKeys = [...new Set([...oldKeys, ...newKeys])];

    this._props = { ...this._props, notificationPreferences: prefs };
    this._updatedAt = new Date();

    const meta: DomainEventMetadata = metadata ?? { correlationId: 'system' };
    this._events.push(
      new NotificationPreferencesUpdatedEvent(
        {
          aggregateId: this._id,
          vendorId: this._props.vendorId,
          changedKeys,
        },
        meta
      )
    );
  }
}
