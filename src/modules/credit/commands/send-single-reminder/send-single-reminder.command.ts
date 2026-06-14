import { randomUUID } from 'crypto';
import { Logger } from '@/infrastructure/logger/logger';
import { NotFoundError } from '@/common/errors/app-error';
import { ICreditBalancePort } from '../../ports/credit-balance.port';
import { ICreditCustomerPort } from '../../ports/credit-customer.port';
import { IReminderNotificationPort } from '../../ports/reminder-notification.port';
import { IPaymentReminderRepository } from '../../database/payment-reminder.repository.port';
import { IReminderConfigRepository } from '../../database/reminder-config.repository.port';
import { PaymentReminderEntity } from '../../domain/payment-reminder.entity';
import { ReminderChannelEnum, ReminderStatusEnum } from '../../domain/credit.types';

export interface SendSingleReminderInput {
  customerId: bigint;
  vendorId: bigint;
  customMessage?: string;
}

export interface SendSingleReminderResult {
  reminderId: string | null;
  customerId: string;
  amountDue: number;
  sentVia: string;
  status: string;
  reminderDate: string;
  skipped: boolean;
  skipReason: string | null;
}

export class SendSingleReminderCommand {
  constructor(
    private readonly reminderRepo: IPaymentReminderRepository,
    private readonly reminderConfigRepo: IReminderConfigRepository,
    private readonly balancePort: ICreditBalancePort,
    private readonly customerPort: ICreditCustomerPort,
    private readonly notificationPort: IReminderNotificationPort,
    private readonly logger: Logger
  ) {}

  async execute(input: SendSingleReminderInput): Promise<SendSingleReminderResult> {
    const correlationId = randomUUID();
    this.logger.info(
      { correlationId, customerId: input.customerId.toString() },
      'SendSingleReminder: start'
    );

    // Multi-tenant guard
    const customer = await this.customerPort.getCustomer(input.customerId, input.vendorId);
    if (!customer) throw new NotFoundError('Customer not found');

    const today = new Date();
    const todayDateOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const reminderDateStr = todayDateOnly.toISOString().substring(0, 10);

    // Skip: inactive
    if (customer.status !== 'ACTIVE') {
      return this._skipped(input.customerId, 0, reminderDateStr, 'customer_inactive');
    }

    const balance = await this.balancePort.getCustomerBalance(input.customerId, input.vendorId);

    // Skip: already paid
    if (balance <= 0) {
      return this._skipped(input.customerId, balance, reminderDateStr, 'already_paid');
    }

    // Skip: already reminded today
    const alreadyReminded = await this.reminderRepo.existsForDate(input.customerId, todayDateOnly);
    if (alreadyReminded) {
      return this._skipped(input.customerId, balance, reminderDateStr, 'duplicate_today');
    }

    // Get template
    const config = await this.reminderConfigRepo.findByVendor(input.vendorId);
    const template =
      config?.getProps().reminderTemplate ??
      'Dear {customer_name}, your outstanding balance is ₹{amount}. Please pay at your earliest convenience.';

    const body =
      input.customMessage ??
      template
        .replace('{customer_name}', customer.name)
        .replace('{amount}', balance.toFixed(2))
        .replace('{phone}', customer.phone);

    const result = await this.notificationPort.send({
      customerPhone: customer.phone,
      channel: ReminderChannelEnum.WHATSAPP,
      body,
      correlationId,
    });

    const status = result.status === 'SENT' ? ReminderStatusEnum.SENT : ReminderStatusEnum.FAILED;

    const entity = PaymentReminderEntity.create({
      customerId: input.customerId,
      vendorId: input.vendorId,
      amountDue: balance,
      reminderDate: todayDateOnly,
      sentVia: ReminderChannelEnum.WHATSAPP,
      status,
    });

    const saved = await this.reminderRepo.insert(entity);
    const savedProps = saved.getProps();

    return {
      reminderId: savedProps.id.toString(),
      customerId: input.customerId.toString(),
      amountDue: balance,
      sentVia: ReminderChannelEnum.WHATSAPP.toLowerCase(),
      status: status.toLowerCase(),
      reminderDate: reminderDateStr,
      skipped: false,
      skipReason: null,
    };
  }

  private _skipped(
    customerId: bigint,
    amountDue: number,
    reminderDate: string,
    reason: string
  ): SendSingleReminderResult {
    return {
      reminderId: null,
      customerId: customerId.toString(),
      amountDue,
      sentVia: ReminderChannelEnum.WHATSAPP.toLowerCase(),
      status: 'skipped',
      reminderDate,
      skipped: true,
      skipReason: reason,
    };
  }
}
