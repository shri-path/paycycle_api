/**
 * VendorSettingsEntity — aggregate root.
 * Framework-free: no Prisma, Express, or Pino imports.
 */
import { TimeOfDay } from './value-objects/time-of-day.vo';
import {
  InvalidTimeOfDayError,
  InvalidNotificationPreferencesError,
} from './vendor-settings.errors';
import { VendorSettingsUpdatedEvent } from './events/vendor-settings-updated.domain-event';
import {
  VendorSettingsProps,
  VendorSettingsCreateProps,
  VendorSettingsPatch,
} from './vendor-settings.types';
import { DomainEventMetadata } from '@/modules/auth/domain/events/domain-event.base';

export class VendorSettingsEntity {
  private _events: VendorSettingsUpdatedEvent[] = [];

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

  getProps(): Readonly<VendorSettingsProps & { id: bigint; createdAt: Date; updatedAt: Date }> {
    return Object.freeze({
      ...this._props,
      id: this._id,
      createdAt: this._createdAt,
      updatedAt: this._updatedAt,
    });
  }

  pullEvents(): VendorSettingsUpdatedEvent[] {
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
    createdAt: Date;
    updatedAt: Date;
  }): VendorSettingsEntity {
    const entity = new VendorSettingsEntity(row.id, row.createdAt, row.updatedAt, {
      vendorId: row.vendorId,
      autoMarkEnabled: row.autoMarkEnabled,
      autoSendBillsEnabled: row.autoSendBillsEnabled,
      autoSendBillsTime: row.autoSendBillsTime,
      notificationPreferences: row.notificationPreferences,
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

    this.validate();

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
}
