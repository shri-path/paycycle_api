import { randomUUID } from 'crypto';
import { Logger } from '@/infrastructure/logger/logger';
import { ICustomerRepository } from '../../database/customer.repository.port';
import {
  SubscriptionNotFoundError,
  SubscriptionNotActiveError,
} from '../../domain/customer.errors';

export interface RemoveSubscriptionInput {
  subscriptionId: bigint;
  vendorId: bigint;
}

export class RemoveSubscriptionCommand {
  constructor(
    private readonly repository: ICustomerRepository,
    private readonly logger: Logger
  ) {}

  async execute(input: RemoveSubscriptionInput): Promise<void> {
    const correlationId = randomUUID();
    this.logger.info(
      { subscriptionId: input.subscriptionId.toString(), correlationId },
      'RemoveSubscriptionCommand: executing'
    );

    const row = await this.repository.findSubscriptionById(input.subscriptionId, input.vendorId);
    if (!row) throw new SubscriptionNotFoundError();
    if (!row.isActive) throw new SubscriptionNotActiveError();

    await this.repository.endSubscription(input.subscriptionId, new Date());
  }
}
