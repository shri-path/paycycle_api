import { BadRequestError } from '@/common/errors/app-error';
import { ICustomerRepository } from '../../database/customer.repository.port';
import { IDeliveryBillingPort } from '../../ports/delivery-billing.port';
import { CustomerNotFoundError } from '../../domain/customer.errors';
import { CustomerBillDto } from '../../customer.types';

const MONTH_RE = /^\d{4}-\d{2}$/;

export interface GetCustomerBillInput {
  customerId: bigint;
  vendorId: bigint;
  month: string;
}

export class GetCustomerBillQuery {
  constructor(
    private readonly repository: ICustomerRepository,
    private readonly billingPort: IDeliveryBillingPort
  ) {}

  async execute(input: GetCustomerBillInput): Promise<CustomerBillDto> {
    if (!MONTH_RE.test(input.month)) {
      throw new BadRequestError('Month must be in YYYY-MM format');
    }

    const customer = await this.repository.findById(input.customerId, input.vendorId);
    if (!customer) throw new CustomerNotFoundError(input.customerId);

    const [deliveries, extraCharges, previousDue] = await Promise.all([
      this.billingPort.getMonthlyDeliveries(input.customerId, input.vendorId, input.month),
      this.billingPort.getMonthlyExtraCharges(input.customerId, input.vendorId, input.month),
      this.billingPort.getBalanceAsOf(input.customerId, input.vendorId, input.month),
    ]);

    const subtotal =
      deliveries.reduce((sum, d) => sum + d.subtotal, 0) +
      extraCharges.reduce((sum, c) => sum + c.amount, 0);
    const totalDue = previousDue + subtotal;

    const paymentStatus: string =
      totalDue <= 0 ? 'paid' : totalDue <= customer.creditLimit ? 'pending' : 'overdue';

    return {
      customerId: customer.id.toString(),
      customerName: customer.name ?? '',
      month: input.month,
      billDetails: {
        byList: deliveries.map((d) => ({
          listName: d.supplyListName,
          deliveries: d.deliveries,
          leaves: d.leaves,
          quantity: d.totalQuantity,
          unit: d.unit,
          ratePerUnit: d.ratePerUnit,
          subtotal: d.subtotal,
        })),
        extraCharges: extraCharges.map((c) => ({
          date: c.date.toISOString().slice(0, 10),
          amount: c.amount,
          reason: c.reason,
          listName: c.supplyListName,
        })),
        subtotal,
        previousDue,
        totalDue,
      },
      paymentStatus,
    };
  }
}
