/**
 * CustomerEntity — aggregate root for the Customer bounded context.
 * No framework imports (no Prisma, Express, Pino).
 */
import { ArgumentInvalidException } from '@/common/errors/app-error';
import { CustomerNameVO } from './value-objects/customer-name.vo';
import { CustomerPhoneVO } from './value-objects/customer-phone.vo';
import { CreditLimitVO } from './value-objects/credit-limit.vo';
import { PaymentScoreVO } from './value-objects/payment-score.vo';
import {
  CustomerProps,
  CreateCustomerProps,
  UpdateCustomerProps,
  CustomerStatus,
  PaymentMethod,
  PaymentProps,
} from './customer.types';

// ──────────────────────────────────────────────────────────────────────────────
// CustomerEntity
// ──────────────────────────────────────────────────────────────────────────────

export class CustomerEntity {
  private readonly _id: bigint;
  private readonly _createdAt: Date;
  private _updatedAt: Date;
  private _props: CustomerProps;

  private constructor(id: bigint, createdAt: Date, updatedAt: Date, props: CustomerProps) {
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

  getProps(): Readonly<CustomerProps & { id: bigint; createdAt: Date; updatedAt: Date }> {
    return Object.freeze({
      id: this._id,
      createdAt: this._createdAt,
      updatedAt: this._updatedAt,
      ...this._props,
    });
  }

  equals(other?: CustomerEntity): boolean {
    if (!other) return false;
    return this._id === other._id;
  }

  // ── Factory: new customer ──────────────────────────────────────────────────

  static create(input: CreateCustomerProps): CustomerEntity {
    const phone = CustomerPhoneVO.create(input.phone, input.phoneCountryCode ?? '+91');
    const entity = new CustomerEntity(0n, new Date(), new Date(), {
      vendorId: input.vendorId,
      name: CustomerNameVO.create(input.name),
      phone,
      phoneCountryCode: input.phoneCountryCode ?? '+91',
      email: input.email ?? null,
      address: input.address ?? null,
      area: input.area ?? null,
      languagePreference: input.languagePreference ?? 'en',
      creditLimit: CreditLimitVO.create(input.creditLimit ?? 0),
      paymentScore: PaymentScoreVO.create(100),
      customerSince: new Date(),
      status: CustomerStatus.ACTIVE,
      createdByUserId: input.createdByUserId ?? null,
      deletedAt: null,
    });
    entity.validate();
    return entity;
  }

  // ── Factory: reconstitute from persistence ────────────────────────────────

  static reconstitute(data: {
    id: bigint;
    createdAt: Date;
    updatedAt: Date;
    props: CustomerProps;
  }): CustomerEntity {
    const entity = new CustomerEntity(data.id, data.createdAt, data.updatedAt, data.props);
    entity.validate();
    return entity;
  }

  // ── Domain behaviour ──────────────────────────────────────────────────────

  update(patch: UpdateCustomerProps): void {
    if (patch.name !== undefined) {
      this._props = { ...this._props, name: CustomerNameVO.create(patch.name) };
    }
    if (patch.phone !== undefined) {
      const cc = patch.phoneCountryCode ?? this._props.phoneCountryCode;
      this._props = { ...this._props, phone: CustomerPhoneVO.create(patch.phone, cc) };
    }
    if (patch.phoneCountryCode !== undefined) {
      this._props = { ...this._props, phoneCountryCode: patch.phoneCountryCode };
    }
    if (patch.email !== undefined) {
      this._props = { ...this._props, email: patch.email };
    }
    if (patch.address !== undefined) {
      this._props = { ...this._props, address: patch.address };
    }
    if (patch.area !== undefined) {
      this._props = { ...this._props, area: patch.area };
    }
    if (patch.languagePreference !== undefined) {
      this._props = { ...this._props, languagePreference: patch.languagePreference };
    }
    if (patch.status !== undefined) {
      this._props = { ...this._props, status: patch.status };
    }
    this._updatedAt = new Date();
    this.validate();
  }

  deactivate(): void {
    if (this._props.status === CustomerStatus.INACTIVE) {
      throw new ArgumentInvalidException('Customer is already inactive');
    }
    this._props = {
      ...this._props,
      status: CustomerStatus.INACTIVE,
      deletedAt: new Date(),
    };
    this._updatedAt = new Date();
  }

  reactivate(): void {
    if (this._props.status === CustomerStatus.ACTIVE) {
      throw new ArgumentInvalidException('Customer is already active');
    }
    this._props = {
      ...this._props,
      status: CustomerStatus.ACTIVE,
      deletedAt: null,
    };
    this._updatedAt = new Date();
  }

  updateCreditLimit(limit: number): void {
    this._props = { ...this._props, creditLimit: CreditLimitVO.create(limit) };
    this._updatedAt = new Date();
  }

  // ── Invariant enforcement ─────────────────────────────────────────────────

  private validate(): void {
    if (!this._props.name) {
      throw new ArgumentInvalidException('Customer name is required');
    }
    if (!this._props.phone) {
      throw new ArgumentInvalidException('Customer phone is required');
    }
    if (!this._props.creditLimit) {
      throw new ArgumentInvalidException('Credit limit is required');
    }
    if (!this._props.paymentScore) {
      throw new ArgumentInvalidException('Payment score is required');
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// PaymentEntity (immutable after creation)
// ──────────────────────────────────────────────────────────────────────────────

export class PaymentEntity {
  private readonly _id: bigint;
  private readonly _createdAt: Date;
  private readonly _props: PaymentProps;

  private constructor(id: bigint, createdAt: Date, props: PaymentProps) {
    this._id = id;
    this._createdAt = createdAt;
    this._props = props;
  }

  get id(): bigint {
    return this._id;
  }

  get createdAt(): Date {
    return this._createdAt;
  }

  getProps(): Readonly<PaymentProps & { id: bigint; createdAt: Date }> {
    return Object.freeze({
      id: this._id,
      createdAt: this._createdAt,
      ...this._props,
    });
  }

  static create(input: {
    customerId: bigint;
    vendorId: bigint;
    amount: number;
    paymentDate: Date;
    paymentMethod: PaymentMethod;
    referenceNumber?: string | null | undefined;
    recordedByUserId?: bigint | null | undefined;
  }): PaymentEntity {
    if (!isFinite(input.amount) || input.amount <= 0) {
      throw new ArgumentInvalidException('Payment amount must be positive');
    }
    const oneDayMs = 24 * 60 * 60 * 1000;
    if (input.paymentDate.getTime() > Date.now() + oneDayMs) {
      throw new ArgumentInvalidException('Payment date cannot be in the future');
    }
    const entity = new PaymentEntity(0n, new Date(), {
      customerId: input.customerId,
      vendorId: input.vendorId,
      amount: input.amount,
      paymentDate: input.paymentDate,
      paymentMethod: input.paymentMethod,
      referenceNumber: input.referenceNumber ?? null,
      recordedByUserId: input.recordedByUserId ?? null,
    });
    return entity;
  }

  static reconstitute(data: { id: bigint; createdAt: Date; props: PaymentProps }): PaymentEntity {
    return new PaymentEntity(data.id, data.createdAt, data.props);
  }
}

export { CustomerStatus, PaymentMethod };
