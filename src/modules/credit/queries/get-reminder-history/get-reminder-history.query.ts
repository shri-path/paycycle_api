import { NotFoundError } from '@/common/errors/app-error';
import { ICreditCustomerPort } from '../../ports/credit-customer.port';
import { IPaymentReminderRepository } from '../../database/payment-reminder.repository.port';
import { CreditMapper } from '../../credit.mapper';

export class GetReminderHistoryQuery {
  constructor(
    private readonly reminderRepo: IPaymentReminderRepository,
    private readonly customerPort: ICreditCustomerPort
  ) {}

  async execute(customerId: bigint, vendorId: bigint, page: number, limit: number) {
    // Multi-tenant guard
    const customer = await this.customerPort.getCustomer(customerId, vendorId);
    if (!customer) throw new NotFoundError('Customer not found');

    const [{ rows, total }, successRate] = await Promise.all([
      this.reminderRepo.listByCustomer(customerId, vendorId, page, limit),
      this.reminderRepo.successRateByCustomer(customerId, vendorId),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      data: {
        totalReminders: total,
        successRate,
        reminders: rows.map((r) => CreditMapper.toReminderHistoryItem(r)),
      },
      meta: { page, limit, total, totalPages },
    };
  }
}
