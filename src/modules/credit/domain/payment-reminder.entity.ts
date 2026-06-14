/**
 * PaymentReminderEntity — append-only reminder record.
 * No framework imports.
 */
import { PaymentReminderProps, ReminderChannelEnum, ReminderStatusEnum } from './credit.types';

export class PaymentReminderEntity {
  private readonly _id: bigint;
  private readonly _createdAt: Date;
  private readonly _props: PaymentReminderProps;

  private constructor(id: bigint, createdAt: Date, props: PaymentReminderProps) {
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

  getProps(): Readonly<PaymentReminderProps & { id: bigint; createdAt: Date }> {
    return Object.freeze({
      id: this._id,
      createdAt: this._createdAt,
      ...this._props,
    });
  }

  static create(input: {
    customerId: bigint;
    vendorId: bigint;
    amountDue: number;
    reminderDate: Date;
    sentVia: ReminderChannelEnum;
    status: ReminderStatusEnum;
  }): PaymentReminderEntity {
    return new PaymentReminderEntity(0n, new Date(), {
      customerId: input.customerId,
      vendorId: input.vendorId,
      amountDue: input.amountDue,
      reminderDate: input.reminderDate,
      sentVia: input.sentVia,
      status: input.status,
      responseType: null,
      responseAmount: null,
    });
  }

  static reconstitute(data: {
    id: bigint;
    createdAt: Date;
    props: PaymentReminderProps;
  }): PaymentReminderEntity {
    return new PaymentReminderEntity(data.id, data.createdAt, data.props);
  }
}
