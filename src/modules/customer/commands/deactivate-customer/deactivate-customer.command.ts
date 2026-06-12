import { randomUUID } from 'crypto';
import { Logger } from '@/infrastructure/logger/logger';
import { ICustomerRepository } from '../../database/customer.repository.port';
import { CustomerNotFoundError, CustomerAlreadyInactiveError } from '../../domain/customer.errors';
import { CustomerStatus } from '../../domain/customer.entity';

export interface DeactivateCustomerInput {
  customerId: bigint;
  vendorId: bigint;
}

export class DeactivateCustomerCommand {
  constructor(
    private readonly repository: ICustomerRepository,
    private readonly logger: Logger
  ) {}

  async execute(input: DeactivateCustomerInput): Promise<void> {
    const correlationId = randomUUID();
    this.logger.info(
      { customerId: input.customerId.toString(), correlationId },
      'DeactivateCustomerCommand: executing'
    );

    const row = await this.repository.findById(input.customerId, input.vendorId);
    if (!row) throw new CustomerNotFoundError(input.customerId);
    if ((row.status as CustomerStatus) === CustomerStatus.INACTIVE)
      throw new CustomerAlreadyInactiveError();

    await this.repository.deactivate(input.customerId, new Date());
  }
}
