/**
 * CancelSubscriptionCommand — cancels current subscription (guard: not already CANCELLED).
 */
import { randomUUID } from 'crypto';
import { Logger } from '@/infrastructure/logger/logger';
import { ISubscriptionRepository } from '../../database/subscription.repository.port';
import { SubscriptionMapper } from '../../subscription.mapper';
import { SubscriptionNotFoundError } from '../../domain/subscription.errors';
import { SubscriptionEventType } from '../../domain/subscription.types';
import { CancelResponseDto } from '../../subscription.types';

export interface CancelSubscriptionInput {
  vendorId: bigint;
  performedByUserId: bigint;
  today?: Date;
}

export class CancelSubscriptionCommand {
  constructor(
    private readonly subscriptionRepo: ISubscriptionRepository,
    private readonly logger: Logger
  ) {}

  async execute(input: CancelSubscriptionInput): Promise<CancelResponseDto> {
    const correlationId = randomUUID();
    const today = input.today ?? new Date();
    const { vendorId, performedByUserId } = input;

    this.logger.info(
      { vendorId: vendorId.toString(), correlationId },
      'CancelSubscriptionCommand: start'
    );

    return this.subscriptionRepo.transaction(async (tx) => {
      const currentRow = await this.subscriptionRepo.findActiveByVendor(vendorId, tx);
      if (!currentRow) throw new SubscriptionNotFoundError();

      const entity = SubscriptionMapper.toDomain(currentRow);
      entity.cancel(today, performedByUserId); // throws SubscriptionAlreadyCancelledError if needed

      const persisted = await this.subscriptionRepo.persist(entity, tx);

      await this.subscriptionRepo.appendHistory(
        {
          vendorSubscriptionId: persisted.id,
          eventType: SubscriptionEventType.CANCELLED,
          newPlanId: persisted.subscriptionPlanId,
          performedByUserId,
        },
        tx
      );

      this.logger.info(
        { vendorId: vendorId.toString(), subscriptionId: persisted.id.toString(), correlationId },
        'CancelSubscriptionCommand: cancelled'
      );

      return SubscriptionMapper.toCancelResponseDto(persisted);
    });
  }
}
