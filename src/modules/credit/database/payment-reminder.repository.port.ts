import { PaymentReminderEntity } from '../domain/payment-reminder.entity';

export interface ReminderHistoryRow {
  id: bigint;
  amountDue: number;
  reminderDate: Date;
  sentVia: string;
  status: string;
  responseType: string | null;
  responseAmount: number | null;
  createdAt: Date;
}

export interface IPaymentReminderRepository {
  insert(entity: PaymentReminderEntity): Promise<PaymentReminderEntity>;
  existsForDate(customerId: bigint, date: Date): Promise<boolean>;
  listByCustomer(
    customerId: bigint,
    vendorId: bigint,
    page: number,
    limit: number
  ): Promise<{ rows: ReminderHistoryRow[]; total: number }>;
  countByCustomer(customerId: bigint, vendorId: bigint): Promise<number>;
  successRateByCustomer(customerId: bigint, vendorId: bigint): Promise<number>;
}
