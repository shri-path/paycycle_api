import { ForbiddenError } from '@/common/errors/app-error';
import { ICustomerRepository } from '../../database/customer.repository.port';
import { IDeliveryBillingPort } from '../../ports/delivery-billing.port';
import { CustomerNotFoundError } from '../../domain/customer.errors';
import { CustomerMapper } from '../../customer.mapper';
import { CustomerDetailDto } from '../../customer.types';

export interface GetCustomerInput {
  customerId: bigint;
  vendorId: bigint;
  isOwner: boolean;
  staffListIds?: bigint[] | undefined;
}

export class GetCustomerQuery {
  constructor(
    private readonly repository: ICustomerRepository,
    private readonly billingPort: IDeliveryBillingPort
  ) {}

  async execute(input: GetCustomerInput): Promise<CustomerDetailDto> {
    const detail = await this.repository.getCustomerWithDetail(input.customerId, input.vendorId);
    if (!detail) throw new CustomerNotFoundError(input.customerId);

    // Staff access guard: must have at least one subscription in assigned lists
    if (!input.isOwner) {
      const assignedListIds = new Set((input.staffListIds ?? []).map((id) => id.toString()));
      const hasAccess = detail.subscriptions.some(
        (s) => s.isActive && assignedListIds.has(s.supplyListId.toString())
      );
      if (!hasAccess) throw new ForbiddenError('Access denied');
    }

    const { rows: paymentRows } = await this.repository.listPayments(
      input.customerId,
      input.vendorId,
      1,
      12
    );

    const balance = input.isOwner
      ? await this.billingPort.getCustomerBalance(input.customerId, input.vendorId)
      : null;
    const monthlyTotal = input.isOwner
      ? await this.billingPort.getCurrentMonthTotal(input.customerId, input.vendorId)
      : null;

    return CustomerMapper.toDetailDto(
      detail,
      detail.subscriptions,
      paymentRows,
      balance,
      monthlyTotal
    );
  }
}
