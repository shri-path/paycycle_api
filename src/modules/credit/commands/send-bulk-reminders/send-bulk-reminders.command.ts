import { randomUUID } from 'crypto';
import { Logger } from '@/infrastructure/logger/logger';
import { ICreditBalancePort } from '../../ports/credit-balance.port';
import { ICreditCustomerPort } from '../../ports/credit-customer.port';
import { IReminderNotificationPort } from '../../ports/reminder-notification.port';
import { IPaymentReminderRepository } from '../../database/payment-reminder.repository.port';
import { IReminderConfigRepository } from '../../database/reminder-config.repository.port';
import { PaymentReminderEntity } from '../../domain/payment-reminder.entity';
import { ReminderChannelEnum, ReminderStatusEnum } from '../../domain/credit.types';

const MAX_PER_BATCH = 50;

export interface SendBulkRemindersInput {
  vendorId: bigint;
  target: 'all_overdue' | 'selected';
  customerIds?: bigint[];
  customMessage?: string;
}

export interface SendBulkRemindersResult {
  sent: number;
  skipped: number;
  failed: number;
}

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? `{${key}}`);
}

export class SendBulkRemindersCommand {
  constructor(
    private readonly reminderRepo: IPaymentReminderRepository,
    private readonly reminderConfigRepo: IReminderConfigRepository,
    private readonly balancePort: ICreditBalancePort,
    private readonly customerPort: ICreditCustomerPort,
    private readonly notificationPort: IReminderNotificationPort,
    private readonly logger: Logger
  ) {}

  async execute(input: SendBulkRemindersInput): Promise<SendBulkRemindersResult> {
    const correlationId = randomUUID();
    this.logger.info(
      { correlationId, vendorId: input.vendorId.toString() },
      'SendBulkReminders: start'
    );

    // Load reminder config (for excluded IDs and template)
    const config = await this.reminderConfigRepo.findByVendor(input.vendorId);
    const excludedIds = new Set(config?.getProps().excludedCustomerIds.map(String) ?? []);
    const template =
      config?.getProps().reminderTemplate ??
      'Dear {customer_name}, your outstanding balance is ₹{amount}. Please pay at your earliest convenience.';

    // Resolve target customers
    let allCustomers = await this.customerPort.listCustomersWithCredit(input.vendorId);

    if (input.target === 'selected' && input.customerIds && input.customerIds.length > 0) {
      const selectedIds = new Set(input.customerIds.map(String));
      allCustomers = allCustomers.filter((c) => selectedIds.has(c.id.toString()));
    }

    // Get balances
    const customerIds = allCustomers.map((c) => c.id);
    const balanceMap = await this.balancePort.getBulkBalances(customerIds, input.vendorId);

    const today = new Date();
    const todayDateOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    let sent = 0,
      skipped = 0,
      failed = 0;
    let processed = 0;

    for (const customer of allCustomers) {
      if (processed >= MAX_PER_BATCH) break;

      const balance = balanceMap.get(customer.id.toString()) ?? 0;

      // Skip: already paid
      if (balance <= 0) {
        skipped++;
        continue;
      }

      // Skip: excluded
      if (excludedIds.has(customer.id.toString())) {
        skipped++;
        continue;
      }

      // Skip: inactive
      if (customer.status !== 'ACTIVE') {
        skipped++;
        continue;
      }

      // Skip: already reminded today (idempotency)
      const alreadyReminded = await this.reminderRepo.existsForDate(customer.id, todayDateOnly);
      if (alreadyReminded) {
        skipped++;
        continue;
      }

      // Render message
      const body =
        input.customMessage ??
        renderTemplate(template, {
          customer_name: customer.name,
          amount: balance.toFixed(2),
          phone: customer.phone,
        });

      // Send via notification port (never throws)
      const result = await this.notificationPort.send({
        customerPhone: customer.phone,
        channel: ReminderChannelEnum.WHATSAPP,
        body,
        correlationId,
      });

      const status = result.status === 'SENT' ? ReminderStatusEnum.SENT : ReminderStatusEnum.FAILED;

      // Insert reminder record
      try {
        const entity = PaymentReminderEntity.create({
          customerId: customer.id,
          vendorId: input.vendorId,
          amountDue: balance,
          reminderDate: todayDateOnly,
          sentVia: ReminderChannelEnum.WHATSAPP,
          status,
        });
        await this.reminderRepo.insert(entity);
        if (status === ReminderStatusEnum.SENT) sent++;
        else failed++;
      } catch {
        // Duplicate (idempotency conflict) treated as skip
        skipped++;
      }

      processed++;
    }

    this.logger.info({ correlationId, sent, skipped, failed }, 'SendBulkReminders: complete');
    return { sent, skipped, failed };
  }
}
