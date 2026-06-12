import { ICustomerRepository } from '../../database/customer.repository.port';
import { CustomerNotFoundError } from '../../domain/customer.errors';
import { CustomerMapper } from '../../customer.mapper';
import { PaymentDto } from '../../customer.types';

export interface ListPaymentsInput {
  customerId: bigint;
  vendorId: bigint;
  page: number;
  limit: number;
}

export interface ListPaymentsResult {
  total: number;
  payments: PaymentDto[];
}

export class ListPaymentsQuery {
  constructor(private readonly repository: ICustomerRepository) {}

  async execute(input: ListPaymentsInput): Promise<ListPaymentsResult> {
    const customer = await this.repository.findById(input.customerId, input.vendorId);
    if (!customer) throw new CustomerNotFoundError(input.customerId);

    const { rows, total } = await this.repository.listPayments(
      input.customerId,
      input.vendorId,
      input.page,
      input.limit
    );

    return {
      total,
      payments: rows.map((p) => CustomerMapper.toPaymentDto(p)),
    };
  }
}
