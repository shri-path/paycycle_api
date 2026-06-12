import {
  ArgumentInvalidException,
  ConflictError,
  NotFoundError,
  UnprocessableEntityError,
} from '@/common/errors/app-error';
import {
  ActorRole,
  ActorRoleLabel,
  DailySupplyStatus,
  DeliveryDto,
  LeaveType,
  MarkedByDto,
} from './delivery.types';

// ============================================================
// Domain errors
// ============================================================

/** Delivery / leave not found OR belongs to another tenant (masked). 404. */
export class DeliveryNotFoundError extends NotFoundError {
  constructor(message = 'Delivery not found') {
    super(message);
  }
}

export class LeaveNotFoundError extends NotFoundError {
  constructor(message = 'Leave not found') {
    super(message);
  }
}

/** Illegal state-machine transition (e.g. marking a CANCELLED row). 400. */
export class InvalidDeliveryTransitionError extends UnprocessableEntityError {
  constructor(message = 'Invalid delivery status transition') {
    super(message);
  }
}

/** Extra charge attempted on a LEAVE or CANCELLED supply (OQ-3). 422. */
export class ChargeOnNonDeliverableError extends UnprocessableEntityError {
  constructor(message = 'Cannot add an extra charge to a leave or cancelled supply') {
    super(message);
  }
}

/** Leave requested on an ended/absent subscription. 422. */
export class NoActiveSubscriptionError extends UnprocessableEntityError {
  constructor(message = 'Customer has no active subscription on this list') {
    super(message);
  }
}

/** A daily supply already exists for the (subscription, date). 409. */
export class DuplicateDailySupplyError extends ConflictError {
  constructor(message = 'A daily supply already exists for this subscription and date') {
    super(message);
  }
}

// ============================================================
// Value objects
// ============================================================

/** A calendar date normalized to midnight UTC (no time component). */
export class ServiceDate {
  private readonly _date: Date;

  private constructor(date: Date) {
    this._date = date;
  }

  static create(raw: Date): ServiceDate {
    if (!(raw instanceof Date) || Number.isNaN(raw.getTime())) {
      throw new ArgumentInvalidException('serviceDate must be a valid date');
    }
    const normalized = new Date(
      Date.UTC(raw.getUTCFullYear(), raw.getUTCMonth(), raw.getUTCDate())
    );
    return new ServiceDate(normalized);
  }

  /** Parse a YYYY-MM-DD string into a ServiceDate. */
  static fromIso(iso: string): ServiceDate {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      throw new ArgumentInvalidException('serviceDate must be YYYY-MM-DD');
    }
    const [y, m, d] = iso.split('-').map(Number);
    const date = new Date(Date.UTC(y!, m! - 1, d));
    if (date.getUTCMonth() !== m! - 1) {
      throw new ArgumentInvalidException('serviceDate is not a valid calendar date');
    }
    return new ServiceDate(date);
  }

  get value(): Date {
    return this._date;
  }

  toIso(): string {
    return this._date.toISOString().slice(0, 10);
  }

  equals(other?: ServiceDate): boolean {
    if (!other) return false;
    return this._date.getTime() === other._date.getTime();
  }
}

/** Non-negative decimal quantity (3 dp). Delivery-local copy (modules are encapsulated). */
export class DeliveryQuantity {
  private readonly _value: number;

  private constructor(value: number) {
    this._value = value;
  }

  static create(raw: number): DeliveryQuantity {
    if (!Number.isFinite(raw)) {
      throw new ArgumentInvalidException('Quantity must be a finite number');
    }
    if (raw < 0) {
      throw new ArgumentInvalidException('Quantity must be greater than or equal to 0');
    }
    return new DeliveryQuantity(Math.round(raw * 1000) / 1000);
  }

  get value(): number {
    return this._value;
  }
}

/** Non-negative money rate per unit (2 dp). Delivery-local copy. */
export class RateMoney {
  private readonly _amount: number;

  private constructor(amount: number) {
    this._amount = amount;
  }

  static create(raw: number): RateMoney {
    if (!Number.isFinite(raw)) {
      throw new ArgumentInvalidException('Rate must be a finite number');
    }
    if (raw < 0) {
      throw new ArgumentInvalidException('Rate must be greater than or equal to 0');
    }
    return new RateMoney(Math.round(raw * 100) / 100);
  }

  get amount(): number {
    return this._amount;
  }
}

/** Inclusive date range (start ≤ end). Delivery-local copy. */
export class DateRange {
  private readonly _startDate: ServiceDate;
  private readonly _endDate: ServiceDate;

  private constructor(startDate: ServiceDate, endDate: ServiceDate) {
    this._startDate = startDate;
    this._endDate = endDate;
  }

  static create(startDate: Date, endDate: Date): DateRange {
    const start = ServiceDate.create(startDate);
    const end = ServiceDate.create(endDate);
    if (end.value.getTime() < start.value.getTime()) {
      throw new ArgumentInvalidException('endDate must be on or after startDate');
    }
    return new DateRange(start, end);
  }

  get startDate(): ServiceDate {
    return this._startDate;
  }

  get endDate(): ServiceDate {
    return this._endDate;
  }

  /** True if the given date falls within [start, end] inclusive. */
  contains(date: ServiceDate): boolean {
    const t = date.value.getTime();
    return t >= this._startDate.value.getTime() && t <= this._endDate.value.getTime();
  }
}

/** Maps a request RoleContext label + persona into the persisted actor_role. */
export class ActorRoleVO {
  static fromLabel(label: ActorRoleLabel): ActorRole {
    switch (label) {
      case 'owner':
        return ActorRole.VENDOR_OWNER;
      case 'staff':
        return ActorRole.VENDOR_STAFF;
      case 'customer':
        return ActorRole.CUSTOMER;
      case 'system':
        return ActorRole.SYSTEM;
      default:
        throw new ArgumentInvalidException(`Unknown actor role label: ${String(label)}`);
    }
  }

  static toLabel(role: ActorRole | null): ActorRoleLabel | null {
    switch (role) {
      case ActorRole.VENDOR_OWNER:
        return 'owner';
      case ActorRole.VENDOR_STAFF:
        return 'staff';
      case ActorRole.CUSTOMER:
        return 'customer';
      case ActorRole.SYSTEM:
        return 'system';
      default:
        return null;
    }
  }

  /** True when the actor is the vendor side (owner/staff) vs the customer side. */
  static isVendorSide(role: ActorRole | null): boolean {
    return role === ActorRole.VENDOR_OWNER || role === ActorRole.VENDOR_STAFF;
  }
}

// ============================================================
// State machine
// ============================================================

const TRANSITIONS: Record<DailySupplyStatus, DailySupplyStatus[]> = {
  PENDING: ['DELIVERED', 'LEAVE', 'AUTO_MARKED', 'CANCELLED'],
  DELIVERED: ['LEAVE', 'CANCELLED'],
  LEAVE: ['DELIVERED', 'CANCELLED'],
  AUTO_MARKED: ['DELIVERED', 'LEAVE', 'CANCELLED'],
  CANCELLED: [],
};

export class DeliveryStatusVO {
  static canTransition(from: DailySupplyStatus, to: DailySupplyStatus): boolean {
    return TRANSITIONS[from].includes(to);
  }

  static assertTransition(from: DailySupplyStatus, to: DailySupplyStatus): void {
    // Allow a same-status re-mark only for non-terminal states; CANCELLED is
    // terminal and must always fall through to the TRANSITIONS guard (which is
    // empty for CANCELLED), so a re-cancel throws instead of silently no-op'ing.
    if (from === to && from !== 'CANCELLED') return;
    if (!DeliveryStatusVO.canTransition(from, to)) {
      throw new InvalidDeliveryTransitionError(`Cannot transition delivery from ${from} to ${to}`);
    }
  }
}

// ============================================================
// Entity props & supporting types
// ============================================================

export interface ExtraChargeProps {
  id: bigint;
  amount: number;
  comment: string;
  addedByUserId: bigint | null;
  addedByRole: ActorRole | null;
  createdAt: Date;
}

export interface OverrideProps {
  changedByUserId: bigint | null;
  actorRole: ActorRole | null;
  previousStatus: DailySupplyStatus | null;
  newStatus: DailySupplyStatus | null;
  previousQuantity: number | null;
  newQuantity: number | null;
  comment: string | null;
}

export interface DailySupplyProps {
  vendorId: bigint;
  supplyListCustomerId: bigint;
  supplyListId: bigint;
  serviceDate: Date;
  status: DailySupplyStatus;
  quantity: number;
  unit: string;
  ratePerUnit: number;
  baseAmount: number;
  finalAmount: number;
  isAutoMarked: boolean;
  markedByUserId: bigint | null;
  markedAt: Date | null;
  extraChargesTotal: number;
}

export interface ReconstituteDailySupplyData {
  id: bigint;
  createdAt: Date;
  updatedAt: Date;
  props: DailySupplyProps;
}

/** Conflict signal derived from override history. */
export interface ConflictInfo {
  hasConflict: boolean;
  reason: string | null;
}

export interface CreateDailySupplyProps {
  vendorId: bigint;
  supplyListCustomerId: bigint;
  supplyListId: bigint;
  serviceDate: Date;
  quantity: number;
  unit: string;
  ratePerUnit: number;
  onLeave: boolean;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ============================================================
// DailySupply aggregate root
// ============================================================

export class DailySupplyEntity {
  private readonly _id: bigint;
  private readonly _createdAt: Date;
  private _updatedAt: Date;
  private _props: DailySupplyProps;
  private _pendingOverride: OverrideProps | null = null;

  private constructor(id: bigint, createdAt: Date, updatedAt: Date, props: DailySupplyProps) {
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

  get supplyListId(): bigint {
    return this._props.supplyListId;
  }

  get supplyListCustomerId(): bigint {
    return this._props.supplyListCustomerId;
  }

  get status(): DailySupplyStatus {
    return this._props.status;
  }

  getProps(): Readonly<DailySupplyProps & { id: bigint; createdAt: Date; updatedAt: Date }> {
    return Object.freeze({
      id: this._id,
      createdAt: this._createdAt,
      updatedAt: this._updatedAt,
      ...this._props,
    });
  }

  /** The single override appended by the last mutation (consumed by the repository). */
  consumePendingOverride(): OverrideProps | null {
    const o = this._pendingOverride;
    this._pendingOverride = null;
    return o;
  }

  equals(other?: DailySupplyEntity): boolean {
    if (!other) return false;
    return this._id === other._id;
  }

  // === Factories ===

  static create(props: CreateDailySupplyProps): DailySupplyEntity {
    const quantity = DeliveryQuantity.create(props.quantity).value;
    const rate = RateMoney.create(props.ratePerUnit).amount;
    const baseAmount = round2(quantity * rate);
    const status: DailySupplyStatus = props.onLeave ? 'LEAVE' : 'PENDING';
    const finalAmount = props.onLeave ? 0 : baseAmount;

    const entity = new DailySupplyEntity(0n, new Date(), new Date(), {
      vendorId: props.vendorId,
      supplyListCustomerId: props.supplyListCustomerId,
      supplyListId: props.supplyListId,
      serviceDate: ServiceDate.create(props.serviceDate).value,
      status,
      quantity,
      unit: props.unit,
      ratePerUnit: rate,
      baseAmount,
      finalAmount,
      isAutoMarked: false,
      markedByUserId: null,
      markedAt: null,
      extraChargesTotal: 0,
    });
    entity.validate();
    return entity;
  }

  static reconstitute(data: ReconstituteDailySupplyData): DailySupplyEntity {
    const entity = new DailySupplyEntity(data.id, data.createdAt, data.updatedAt, {
      ...data.props,
    });
    entity.validate();
    return entity;
  }

  // === Behaviors ===

  /** Mark the supply DELIVERED, optionally overriding the quantity. Appends an override. */
  markDelivered(actorRole: ActorRole, actorUserId: bigint | null, quantity?: number): void {
    DeliveryStatusVO.assertTransition(this._props.status, 'DELIVERED');
    const previousStatus = this._props.status;
    const previousQuantity = this._props.quantity;

    if (quantity !== undefined) {
      this._props.quantity = DeliveryQuantity.create(quantity).value;
    }
    this._props.status = 'DELIVERED';
    this._props.baseAmount = round2(this._props.quantity * this._props.ratePerUnit);
    this._props.finalAmount = round2(this._props.baseAmount + this._props.extraChargesTotal);
    this._props.isAutoMarked = false;
    this.stampMarked(actorUserId);
    this.appendOverride({
      actorRole,
      changedByUserId: actorUserId,
      previousStatus,
      newStatus: 'DELIVERED',
      previousQuantity,
      newQuantity: this._props.quantity,
      comment: null,
    });
    this.validate();
  }

  /**
   * System auto-confirm: mark a PENDING supply DELIVERED on behalf of the vendor
   * (overnight / morning-cutoff sweep). Sets isAutoMarked and appends a SYSTEM
   * override. No-op return of false when the row is not PENDING so the sweep can skip.
   */
  autoMarkDelivered(): boolean {
    if (this._props.status !== 'PENDING') return false;
    const previousStatus = this._props.status;
    this._props.status = 'DELIVERED';
    this._props.baseAmount = round2(this._props.quantity * this._props.ratePerUnit);
    this._props.finalAmount = round2(this._props.baseAmount + this._props.extraChargesTotal);
    this._props.isAutoMarked = true;
    this._props.markedByUserId = null;
    this._props.markedAt = new Date();
    this._updatedAt = new Date();
    this.appendOverride({
      actorRole: ActorRole.SYSTEM,
      changedByUserId: null,
      previousStatus,
      newStatus: 'DELIVERED',
      previousQuantity: this._props.quantity,
      newQuantity: this._props.quantity,
      comment: 'Auto-confirmed by system sweep',
    });
    this.validate();
    return true;
  }

  /** Mark the supply LEAVE: amount→0. Appends an override. */
  markLeave(actorRole: ActorRole, actorUserId: bigint | null): void {
    DeliveryStatusVO.assertTransition(this._props.status, 'LEAVE');
    const previousStatus = this._props.status;
    this._props.status = 'LEAVE';
    this._props.finalAmount = 0;
    this._props.isAutoMarked = false;
    this.stampMarked(actorUserId);
    this.appendOverride({
      actorRole,
      changedByUserId: actorUserId,
      previousStatus,
      newStatus: 'LEAVE',
      previousQuantity: this._props.quantity,
      newQuantity: this._props.quantity,
      comment: null,
    });
    this.validate();
  }

  /** Cancel (subscription ended / customer removed). Owner / system only. */
  cancel(actorRole: ActorRole, actorUserId: bigint | null): void {
    DeliveryStatusVO.assertTransition(this._props.status, 'CANCELLED');
    const previousStatus = this._props.status;
    this._props.status = 'CANCELLED';
    this._props.finalAmount = 0;
    this.appendOverride({
      actorRole,
      changedByUserId: actorUserId,
      previousStatus,
      newStatus: 'CANCELLED',
      previousQuantity: this._props.quantity,
      newQuantity: this._props.quantity,
      comment: null,
    });
    this.validate();
  }

  /** Revert a LEAVE row back to PENDING (leave cancellation). */
  revertToPending(actorRole: ActorRole, actorUserId: bigint | null): void {
    if (this._props.status !== 'LEAVE') {
      throw new InvalidDeliveryTransitionError('Only a leave row can be reverted to pending');
    }
    this._props.status = 'PENDING';
    this._props.finalAmount = round2(this._props.baseAmount + this._props.extraChargesTotal);
    this._props.markedByUserId = null;
    this._props.markedAt = null;
    this.appendOverride({
      actorRole,
      changedByUserId: actorUserId,
      previousStatus: 'LEAVE',
      newStatus: 'PENDING',
      previousQuantity: this._props.quantity,
      newQuantity: this._props.quantity,
      comment: 'Leave cancelled',
    });
    this.validate();
  }

  /** Add an extra charge: recompute finalAmount. Blocked on LEAVE/CANCELLED (OQ-3). */
  addExtraCharge(amount: number): void {
    if (this._props.status === 'LEAVE' || this._props.status === 'CANCELLED') {
      throw new ChargeOnNonDeliverableError();
    }
    if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) < 0.01) {
      throw new ArgumentInvalidException('Extra charge amount must be at least 0.01');
    }
    const normalized = round2(amount);
    this._props.extraChargesTotal = round2(this._props.extraChargesTotal + normalized);
    this._props.finalAmount = round2(this._props.baseAmount + this._props.extraChargesTotal);
    this.validate();
  }

  private stampMarked(actorUserId: bigint | null): void {
    this._props.markedByUserId = actorUserId;
    this._props.markedAt = new Date();
    this._updatedAt = new Date();
  }

  private appendOverride(override: OverrideProps): void {
    this._pendingOverride = override;
  }

  // === Invariants ===

  private validate(): void {
    if (this._props.quantity < 0) {
      throw new ArgumentInvalidException('quantity must be >= 0');
    }
    if (this._props.ratePerUnit < 0) {
      throw new ArgumentInvalidException('ratePerUnit must be >= 0');
    }
    if (this._props.baseAmount < 0 || this._props.finalAmount < 0) {
      throw new ArgumentInvalidException('amounts must be >= 0');
    }
    if (this._props.status === 'LEAVE' && this._props.finalAmount !== 0) {
      throw new ArgumentInvalidException('LEAVE supply must have a zero final amount');
    }
  }
}

// ============================================================
// Leave aggregate root
// ============================================================

export interface LeaveProps {
  supplyListCustomerId: bigint;
  range: DateRange;
  leaveType: LeaveType;
  reason: string | null;
  createdByUserId: bigint | null;
}

export interface CreateLeaveProps {
  supplyListCustomerId: bigint;
  startDate: Date;
  endDate: Date;
  leaveType: LeaveType;
  reason: string | null;
  createdByUserId: bigint | null;
}

export class LeaveEntity {
  private readonly _id: bigint;
  private readonly _createdAt: Date;
  private _props: LeaveProps;

  private constructor(id: bigint, createdAt: Date, props: LeaveProps) {
    this._id = id;
    this._createdAt = createdAt;
    this._props = props;
  }

  get id(): bigint {
    return this._id;
  }

  get supplyListCustomerId(): bigint {
    return this._props.supplyListCustomerId;
  }

  get range(): DateRange {
    return this._props.range;
  }

  getProps(): Readonly<LeaveProps & { id: bigint; createdAt: Date }> {
    return Object.freeze({ id: this._id, createdAt: this._createdAt, ...this._props });
  }

  static create(props: CreateLeaveProps): LeaveEntity {
    const range = DateRange.create(props.startDate, props.endDate);
    return new LeaveEntity(0n, new Date(), {
      supplyListCustomerId: props.supplyListCustomerId,
      range,
      leaveType: props.leaveType,
      reason: props.reason,
      createdByUserId: props.createdByUserId,
    });
  }

  static reconstitute(data: { id: bigint; createdAt: Date; props: LeaveProps }): LeaveEntity {
    return new LeaveEntity(data.id, data.createdAt, { ...data.props });
  }
}

// ============================================================
// Mappers
// ============================================================

/** Raw daily supply record shape (subset used by the mapper). */
export interface DailySupplyRecord {
  id: bigint;
  vendorId: bigint;
  supplyListCustomerId: bigint;
  supplyListId: bigint;
  serviceDate: Date;
  status: DailySupplyStatus;
  quantity: { toString(): string };
  unit: string;
  ratePerUnit: { toString(): string };
  baseAmount: { toString(): string };
  finalAmount: { toString(): string };
  isAutoMarked: boolean;
  markedByUserId: bigint | null;
  markedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function toNum(d: { toString(): string }): number {
  return Number(d.toString());
}

/** Customer display info needed to build a delivery response. */
export interface DeliveryCustomerInfo {
  id: bigint;
  name: string | null;
  address: string | null;
  phoneNumber: string | null;
}

export interface MarkerInfo {
  userId: bigint;
  name: string | null;
  role: ActorRole | null;
}

export class DailySupplyMapper {
  static toDomain(record: DailySupplyRecord, extraChargesTotal = 0): DailySupplyEntity {
    return DailySupplyEntity.reconstitute({
      id: record.id,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      props: {
        vendorId: record.vendorId,
        supplyListCustomerId: record.supplyListCustomerId,
        supplyListId: record.supplyListId,
        serviceDate: record.serviceDate,
        status: record.status,
        quantity: toNum(record.quantity),
        unit: record.unit,
        ratePerUnit: toNum(record.ratePerUnit),
        baseAmount: toNum(record.baseAmount),
        finalAmount: toNum(record.finalAmount),
        isAutoMarked: record.isAutoMarked,
        markedByUserId: record.markedByUserId,
        markedAt: record.markedAt,
        extraChargesTotal: round2(extraChargesTotal),
      },
    });
  }

  /**
   * Domain → Response (WHITELIST). Financial fields (ratePerUnit/amount) are only
   * included for owners.
   */
  static toResponse(
    entity: DailySupplyEntity,
    options: {
      customer: DeliveryCustomerInfo;
      marker: MarkerInfo | null;
      conflict: ConflictInfo;
      otherLists: string[];
      includeFinancials: boolean;
    }
  ): DeliveryDto {
    const props = entity.getProps();
    const markedBy: MarkedByDto | null =
      options.marker && props.markedByUserId !== null
        ? {
            userId: options.marker.userId.toString(),
            name: options.marker.name,
            role: ActorRoleVO.toLabel(options.marker.role) ?? 'system',
          }
        : null;

    const base: DeliveryDto = {
      id: props.id.toString(),
      customer: {
        id: options.customer.id.toString(),
        name: options.customer.name,
        address: options.customer.address,
        phoneNumber: options.customer.phoneNumber,
      },
      quantity: props.quantity,
      unit: props.unit,
      status: props.status,
      markedBy,
      markedAt: props.markedAt ? props.markedAt.toISOString() : null,
      hasConflict: options.conflict.hasConflict,
      conflictReason: options.conflict.reason,
      otherLists: options.otherLists,
    };

    if (options.includeFinancials) {
      base.ratePerUnit = props.ratePerUnit;
      base.amount = props.finalAmount;
    }
    return base;
  }
}

/**
 * Derive conflict info from override history: a conflict exists when the latest
 * CUSTOMER override disagrees (on status) with the latest vendor-side override.
 */
export function deriveConflict(
  overrides: Array<{ actorRole: ActorRole | null; newStatus: string | null; createdAt: Date }>
): ConflictInfo {
  const sorted = [...overrides].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const latestCustomer = sorted.find((o) => o.actorRole === ActorRole.CUSTOMER);
  const latestVendor = sorted.find((o) => ActorRoleVO.isVendorSide(o.actorRole));
  if (!latestCustomer || !latestVendor) {
    return { hasConflict: false, reason: null };
  }
  if (
    latestCustomer.newStatus !== null &&
    latestVendor.newStatus !== null &&
    latestCustomer.newStatus !== latestVendor.newStatus
  ) {
    // Conflict only stands if the customer marking is the more recent one.
    if (latestVendor.createdAt.getTime() >= latestCustomer.createdAt.getTime()) {
      return { hasConflict: false, reason: null };
    }
    return {
      hasConflict: true,
      reason: `Staff marked ${latestVendor.newStatus.toLowerCase()}; customer marked ${latestCustomer.newStatus.toLowerCase()}`,
    };
  }
  return { hasConflict: false, reason: null };
}
