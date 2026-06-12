import { BadRequestError, ForbiddenError } from '@/common/errors/app-error';
import { ICustomerRepository } from '../../database/customer.repository.port';
import { IDeliveryBillingPort } from '../../ports/delivery-billing.port';
import { CustomerNotFoundError } from '../../domain/customer.errors';
import { CustomerCalendarDto } from '../../customer.types';

const MONTH_RE = /^\d{4}-\d{2}$/;

export interface GetCustomerCalendarInput {
  customerId: bigint;
  vendorId: bigint;
  month: string;
  isOwner: boolean;
  staffListIds?: bigint[] | undefined;
}

export class GetCustomerCalendarQuery {
  constructor(
    private readonly repository: ICustomerRepository,
    private readonly billingPort: IDeliveryBillingPort
  ) {}

  async execute(input: GetCustomerCalendarInput): Promise<CustomerCalendarDto> {
    if (!MONTH_RE.test(input.month)) {
      throw new BadRequestError('Month must be in YYYY-MM format');
    }

    const detail = await this.repository.getCustomerWithDetail(input.customerId, input.vendorId);
    if (!detail) throw new CustomerNotFoundError(input.customerId);

    // Staff access guard
    if (!input.isOwner) {
      const assignedListIds = new Set((input.staffListIds ?? []).map((id) => id.toString()));
      const hasAccess = detail.subscriptions.some(
        (s) => s.isActive && assignedListIds.has(s.supplyListId.toString())
      );
      if (!hasAccess) throw new ForbiddenError('Access denied');
    }

    const parts = input.month.split('-');
    const y = Number(parts[0]);
    const m = Number(parts[1]);
    const from = new Date(y, m - 1, 1);
    const to = new Date(y, m, 0); // last day of the month

    const rows = await this.billingPort.getDailySuppliesForCalendar(
      input.customerId,
      input.vendorId,
      from,
      to
    );

    // Group by date
    const days: Record<string, CustomerCalendarDto['days'][string]> = {};
    for (const row of rows) {
      const dateKey = row.serviceDate.toISOString().slice(0, 10);
      if (!days[dateKey]) days[dateKey] = { deliveries: [] };
      days[dateKey].deliveries.push({
        listName: row.supplyListName,
        quantity: row.quantity,
        unit: row.unit,
        status: row.status.toLowerCase(),
        amount: row.finalAmount,
      });
    }

    return { month: input.month, days };
  }
}
