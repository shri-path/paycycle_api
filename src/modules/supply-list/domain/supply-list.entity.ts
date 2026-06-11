import { ArgumentInvalidException } from '@/common/errors/app-error';
import {
  CreateSupplyListProps,
  ReconstituteSupplyListData,
  ScheduleRuleProps,
  StaffAssignmentProps,
  SupplyFrequency,
  SupplyListProps,
  UpdateSupplyListPatch,
} from './supply-list.types';
import { SupplyUnit } from './value-objects/supply-unit.value-object';
import { SupplyFrequencyVO } from './value-objects/supply-frequency.value-object';
import { Quantity } from './value-objects/quantity.value-object';
import { RateMoney } from './value-objects/rate-money.value-object';
import { TimeOfDay } from './value-objects/time-of-day.value-object';
import { SupplyListCreatedEvent } from './events/supply-list-created.domain-event';
import { SupplyListUpdatedEvent } from './events/supply-list-updated.domain-event';
import { SupplyListArchivedEvent } from './events/supply-list-archived.domain-event';
import { StaffAssignedToListEvent } from './events/staff-assigned-to-list.domain-event';
import { StaffUnassignedFromListEvent } from './events/staff-unassigned-from-list.domain-event';
import { PrimaryStaffChangedEvent } from './events/primary-staff-changed.domain-event';

const MAX_NAME_LENGTH = 100;
const MAX_SUPPLY_TYPE_LENGTH = 50;

type DomainEvent =
  | SupplyListCreatedEvent
  | SupplyListUpdatedEvent
  | SupplyListArchivedEvent
  | StaffAssignedToListEvent
  | StaffUnassignedFromListEvent
  | PrimaryStaffChangedEvent;

/**
 * Aggregate root for a supply list. Owns its staff assignments and schedule
 * rules; both are mutated only through this root.
 */
export class SupplyListEntity {
  private readonly _id: bigint;
  private readonly _createdAt: Date;
  private _updatedAt: Date;
  private _props: SupplyListProps;
  private _domainEvents: DomainEvent[] = [];

  private constructor(id: bigint, createdAt: Date, updatedAt: Date, props: SupplyListProps) {
    this._id = id;
    this._createdAt = createdAt;
    this._updatedAt = updatedAt;
    this._props = props;
  }

  get id(): bigint {
    return this._id;
  }

  get vendorId(): bigint {
    return this._props.vendorId;
  }

  get isActive(): boolean {
    return this._props.isActive;
  }

  get name(): string {
    return this._props.name;
  }

  get defaultQuantity(): number | null {
    return this._props.defaultQuantity;
  }

  get ratePerUnit(): number | null {
    return this._props.ratePerUnit;
  }

  getProps(): Readonly<SupplyListProps & { id: bigint; createdAt: Date; updatedAt: Date }> {
    return Object.freeze({
      id: this._id,
      createdAt: this._createdAt,
      updatedAt: this._updatedAt,
      ...this._props,
      staff: this._props.staff.map((s) => ({ ...s })),
      schedule: this._props.schedule.map((s) => ({ ...s })),
    });
  }

  getDomainEvents(): DomainEvent[] {
    return [...this._domainEvents];
  }

  clearDomainEvents(): void {
    this._domainEvents = [];
  }

  /** Identity-based equality: two lists are equal iff they share the same id. */
  equals(other?: SupplyListEntity): boolean {
    if (!other) return false;
    return this._id === other._id;
  }

  private addDomainEvent(event: DomainEvent): void {
    this._domainEvents.push(event);
  }

  private get primaryAssignment(): StaffAssignmentProps | undefined {
    return this._props.staff.find((s) => s.isPrimary);
  }

  // === Factories ===

  static create(props: CreateSupplyListProps): SupplyListEntity {
    const schedule = SupplyListEntity.buildSchedule(props.frequency, props.scheduleDays);
    const staff: StaffAssignmentProps[] = props.staffIds.map((vendorUserId) => ({
      vendorUserId,
      isPrimary: props.primaryStaffId !== null && vendorUserId === props.primaryStaffId,
      assignedByUserId: props.createdByUserId,
      assignedAt: new Date(),
    }));

    const entity = new SupplyListEntity(0n, new Date(), new Date(), {
      vendorId: props.vendorId,
      name: props.name.trim(),
      supplyType: props.supplyType?.trim() ?? null,
      unit: SupplyUnit.create(props.unit).value,
      defaultQuantity:
        props.defaultQuantity === null ? null : Quantity.create(props.defaultQuantity).value,
      ratePerUnit: props.ratePerUnit === null ? null : RateMoney.create(props.ratePerUnit).amount,
      startTime: props.startTime === null ? null : TimeOfDay.create(props.startTime).unpack(),
      frequency: props.frequency,
      isActive: true,
      deletedAt: null,
      staff,
      schedule,
    });
    entity.validate();

    entity.addDomainEvent(
      new SupplyListCreatedEvent(
        entity._id,
        entity._props.vendorId,
        entity._props.name,
        props.createdByUserId,
        props.correlationId
      )
    );
    for (const a of staff) {
      entity.addDomainEvent(
        new StaffAssignedToListEvent(
          entity._id,
          entity._props.vendorId,
          a.vendorUserId,
          a.isPrimary,
          props.correlationId
        )
      );
    }
    if (props.primaryStaffId !== null) {
      entity.addDomainEvent(
        new PrimaryStaffChangedEvent(
          entity._id,
          entity._props.vendorId,
          null,
          props.primaryStaffId,
          props.correlationId
        )
      );
    }
    return entity;
  }

  static reconstitute(data: ReconstituteSupplyListData): SupplyListEntity {
    const entity = new SupplyListEntity(data.id, data.createdAt, data.updatedAt, {
      ...data.props,
      staff: data.props.staff.map((s) => ({ ...s })),
      schedule: data.props.schedule.map((s) => ({ ...s })),
    });
    entity.validate();
    return entity;
  }

  // === Behaviors ===

  updateDetails(patch: UpdateSupplyListPatch, correlationId: string): void {
    const changed: string[] = [];

    if (patch.name !== undefined) {
      this._props.name = patch.name.trim();
      changed.push('name');
    }
    if (patch.supplyType !== undefined) {
      this._props.supplyType = patch.supplyType?.trim() ?? null;
      changed.push('supplyType');
    }
    if (patch.unit !== undefined) {
      this._props.unit = SupplyUnit.create(patch.unit).value;
      changed.push('unit');
    }
    if (patch.defaultQuantity !== undefined) {
      this._props.defaultQuantity =
        patch.defaultQuantity === null ? null : Quantity.create(patch.defaultQuantity).value;
      changed.push('defaultQuantity');
    }
    if (patch.ratePerUnit !== undefined) {
      this._props.ratePerUnit =
        patch.ratePerUnit === null ? null : RateMoney.create(patch.ratePerUnit).amount;
      changed.push('ratePerUnit');
    }
    if (patch.startTime !== undefined) {
      this._props.startTime =
        patch.startTime === null ? null : TimeOfDay.create(patch.startTime).unpack();
      changed.push('startTime');
    }
    // Frequency and schedule move together so the per-frequency invariant holds.
    if (patch.frequency !== undefined || patch.scheduleDays !== undefined) {
      const frequency = patch.frequency ?? this._props.frequency;
      const days =
        patch.scheduleDays ??
        this._props.schedule
          .map((r) => (frequency === SupplyFrequency.MONTHLY ? r.dayOfMonth : r.dayOfWeek))
          .filter((d): d is number => d !== null);
      this._props.schedule = SupplyListEntity.buildSchedule(frequency, days);
      this._props.frequency = frequency;
      changed.push('frequency');
    }

    this._updatedAt = new Date();
    this.validate();

    if (changed.length > 0) {
      this.addDomainEvent(
        new SupplyListUpdatedEvent(this._id, this._props.vendorId, changed, correlationId)
      );
    }
  }

  archive(correlationId: string): void {
    this._props.isActive = false;
    this._props.deletedAt = new Date();
    this._updatedAt = new Date();
    this.addDomainEvent(new SupplyListArchivedEvent(this._id, this._props.vendorId, correlationId));
  }

  assignStaff(
    vendorUserId: bigint,
    isPrimary: boolean,
    assignedByUserId: bigint | null,
    correlationId: string
  ): void {
    if (this._props.staff.some((s) => s.vendorUserId === vendorUserId)) {
      // Surfaced as ConflictError at the DB unique constraint by the adapter,
      // but guard here too for in-memory callers.
      throw new ArgumentInvalidException('Staff member is already assigned to this list');
    }
    const oldPrimary = this.primaryAssignment?.vendorUserId ?? null;
    if (isPrimary) {
      for (const s of this._props.staff) s.isPrimary = false;
    }
    this._props.staff.push({
      vendorUserId,
      isPrimary,
      assignedByUserId,
      assignedAt: new Date(),
    });
    this._updatedAt = new Date();
    this.validate();

    this.addDomainEvent(
      new StaffAssignedToListEvent(
        this._id,
        this._props.vendorId,
        vendorUserId,
        isPrimary,
        correlationId
      )
    );
    if (isPrimary && oldPrimary !== vendorUserId) {
      this.addDomainEvent(
        new PrimaryStaffChangedEvent(
          this._id,
          this._props.vendorId,
          oldPrimary,
          vendorUserId,
          correlationId
        )
      );
    }
  }

  unassignStaff(vendorUserId: bigint, correlationId: string): void {
    const index = this._props.staff.findIndex((s) => s.vendorUserId === vendorUserId);
    if (index === -1) {
      throw new ArgumentInvalidException('Staff member is not assigned to this list');
    }
    const wasPrimary = this._props.staff[index]!.isPrimary;
    this._props.staff.splice(index, 1);
    this._updatedAt = new Date();
    this.validate();

    this.addDomainEvent(
      new StaffUnassignedFromListEvent(this._id, this._props.vendorId, vendorUserId, correlationId)
    );
    if (wasPrimary) {
      // Story: leave no primary on removal.
      this.addDomainEvent(
        new PrimaryStaffChangedEvent(
          this._id,
          this._props.vendorId,
          vendorUserId,
          null,
          correlationId
        )
      );
    }
  }

  setPrimary(vendorUserId: bigint, correlationId: string): void {
    const target = this._props.staff.find((s) => s.vendorUserId === vendorUserId);
    if (!target) {
      throw new ArgumentInvalidException('Staff member is not assigned to this list');
    }
    const oldPrimary = this.primaryAssignment?.vendorUserId ?? null;
    if (oldPrimary === vendorUserId) return;
    for (const s of this._props.staff) s.isPrimary = s.vendorUserId === vendorUserId;
    this._updatedAt = new Date();
    this.validate();
    this.addDomainEvent(
      new PrimaryStaffChangedEvent(
        this._id,
        this._props.vendorId,
        oldPrimary,
        vendorUserId,
        correlationId
      )
    );
  }

  // === Helpers ===

  private static buildSchedule(frequency: SupplyFrequency, days: number[]): ScheduleRuleProps[] {
    const rules: ScheduleRuleProps[] =
      frequency === SupplyFrequency.WEEKLY
        ? days.map((d) => ({ dayOfWeek: d, dayOfMonth: null }))
        : frequency === SupplyFrequency.MONTHLY
          ? days.map((d) => ({ dayOfWeek: null, dayOfMonth: d }))
          : [];
    // Validate via the VO (throws on bad combos).
    SupplyFrequencyVO.create(
      frequency,
      rules.map((r) => ({ dayOfWeek: r.dayOfWeek, dayOfMonth: r.dayOfMonth }))
    );
    return rules;
  }

  // === Invariants ===

  private validate(): void {
    if (!this._props.name || this._props.name.length === 0) {
      throw new ArgumentInvalidException('name is required');
    }
    if (this._props.name.length > MAX_NAME_LENGTH) {
      throw new ArgumentInvalidException(`name must be at most ${MAX_NAME_LENGTH} characters`);
    }
    if (this._props.supplyType !== null && this._props.supplyType.length > MAX_SUPPLY_TYPE_LENGTH) {
      throw new ArgumentInvalidException(
        `supplyType must be at most ${MAX_SUPPLY_TYPE_LENGTH} characters`
      );
    }
    if (!SupplyUnit.isValid(this._props.unit)) {
      throw new ArgumentInvalidException(`Invalid unit: ${this._props.unit}`);
    }
    if (this._props.defaultQuantity !== null && this._props.defaultQuantity < 0) {
      throw new ArgumentInvalidException('defaultQuantity must be >= 0');
    }
    if (this._props.ratePerUnit !== null && this._props.ratePerUnit < 0) {
      throw new ArgumentInvalidException('ratePerUnit must be >= 0');
    }

    // Frequency / schedule invariant via the VO.
    SupplyFrequencyVO.create(
      this._props.frequency,
      this._props.schedule.map((r) => ({ dayOfWeek: r.dayOfWeek, dayOfMonth: r.dayOfMonth }))
    );

    // At most one primary.
    const primaries = this._props.staff.filter((s) => s.isPrimary);
    if (primaries.length > 1) {
      throw new ArgumentInvalidException('A list can have at most one primary staff member');
    }

    // Distinct staff.
    const ids = this._props.staff.map((s) => s.vendorUserId.toString());
    if (new Set(ids).size !== ids.length) {
      throw new ArgumentInvalidException('Duplicate staff assignment on the list');
    }
  }
}
