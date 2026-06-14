/**
 * ReminderConfigEntity — aggregate root for per-vendor reminder settings.
 * No framework imports.
 */
import { ArgumentInvalidException } from '@/common/errors/app-error';
import { ReminderConfigProps, UpdateReminderConfigPatch } from './credit.types';

const ALLOWED_PLACEHOLDERS = [
  '{customer_name}',
  '{month}',
  '{amount}',
  '{upi_id}',
  '{phone}',
  '{vendor_name}',
];

const PLACEHOLDER_RE = /\{[^}]+\}/g;

export class ReminderConfigEntity {
  private readonly _id: bigint;
  private readonly _createdAt: Date;
  private _updatedAt: Date;
  private _props: ReminderConfigProps;

  private constructor(id: bigint, createdAt: Date, updatedAt: Date, props: ReminderConfigProps) {
    this._id = id;
    this._createdAt = createdAt;
    this._updatedAt = updatedAt;
    this._props = props;
  }

  get id(): bigint {
    return this._id;
  }
  get createdAt(): Date {
    return this._createdAt;
  }
  get updatedAt(): Date {
    return this._updatedAt;
  }

  getProps(): Readonly<ReminderConfigProps & { id: bigint; createdAt: Date; updatedAt: Date }> {
    return Object.freeze({
      id: this._id,
      createdAt: this._createdAt,
      updatedAt: this._updatedAt,
      ...this._props,
    });
  }

  equals(other?: ReminderConfigEntity): boolean {
    if (!other) return false;
    return this._id === other._id;
  }

  static create(vendorId: bigint): ReminderConfigEntity {
    const entity = new ReminderConfigEntity(0n, new Date(), new Date(), {
      vendorId,
      autoRemindersEnabled: false,
      schedule3Days: true,
      schedule15Days: true,
      schedule30Days: true,
      reminderTemplate: null,
      excludedCustomerIds: [],
    });
    entity.validate();
    return entity;
  }

  static reconstitute(data: {
    id: bigint;
    createdAt: Date;
    updatedAt: Date;
    props: ReminderConfigProps;
  }): ReminderConfigEntity {
    const entity = new ReminderConfigEntity(data.id, data.createdAt, data.updatedAt, data.props);
    entity.validate();
    return entity;
  }

  update(patch: UpdateReminderConfigPatch): void {
    const updated = { ...this._props };

    if (patch.autoRemindersEnabled !== undefined) {
      updated.autoRemindersEnabled = patch.autoRemindersEnabled;
    }
    if (patch.schedule3Days !== undefined) updated.schedule3Days = patch.schedule3Days;
    if (patch.schedule15Days !== undefined) updated.schedule15Days = patch.schedule15Days;
    if (patch.schedule30Days !== undefined) updated.schedule30Days = patch.schedule30Days;
    if (patch.reminderTemplate !== undefined) updated.reminderTemplate = patch.reminderTemplate;
    if (patch.excludedCustomerIds !== undefined) {
      // Deduplicate, keep only positive integers
      updated.excludedCustomerIds = [...new Set(patch.excludedCustomerIds.filter((id) => id > 0))];
    }

    this._props = updated;
    this._updatedAt = new Date();
    this.validate();
  }

  private validate(): void {
    // Invariant: if autoRemindersEnabled, at least one schedule must be on
    if (
      this._props.autoRemindersEnabled &&
      !this._props.schedule3Days &&
      !this._props.schedule15Days &&
      !this._props.schedule30Days
    ) {
      throw new ArgumentInvalidException(
        'At least one schedule (3, 15, or 30 days) must be enabled when auto reminders are on'
      );
    }

    // Invariant: template placeholders must be from the allowed set
    if (this._props.reminderTemplate) {
      const found = this._props.reminderTemplate.match(PLACEHOLDER_RE) ?? [];
      const invalid = found.filter((p) => !ALLOWED_PLACEHOLDERS.includes(p));
      if (invalid.length > 0) {
        throw new ArgumentInvalidException(
          `Unknown template placeholder(s): ${invalid.join(', ')}. ` +
            `Allowed: ${ALLOWED_PLACEHOLDERS.join(', ')}`
        );
      }
    }

    // Invariant: excludedCustomerIds must be positive integers
    for (const id of this._props.excludedCustomerIds) {
      if (!Number.isInteger(id) || id <= 0) {
        throw new ArgumentInvalidException(
          `excludedCustomerIds must contain positive integers, got ${id}`
        );
      }
    }
  }
}
