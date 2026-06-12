/**
 * SetAutoRenewalCommand — toggles auto-renewal flag on current subscription.
 */
import { randomUUID } from 'crypto';
import { Logger } from '@/infrastructure/logger/logger';
import { ISubscriptionRepository } from '../../database/subscription.repository.port';
import { SubscriptionMapper } from '../../subscription.mapper';
import { SubscriptionNotFoundError } from '../../domain/subscription.errors';
import { AutoRenewalResponseDto } from '../../subscription.types';

export interface SetAutoRenewalInput {
  vendorId: bigint;
  autoRenewal: boolean;
}

export class SetAutoRenewalCommand {
  constructor(
    private readonly subscriptionRepo: ISubscriptionRepository,
    private readonly logger: Logger
  ) {}

  async execute(input: SetAutoRenewalInput): Promise<AutoRenewalResponseDto> {
    const correlationId = randomUUID();
    const { vendorId, autoRenewal } = input;

    this.logger.info(
      { vendorId: vendorId.toString(), autoRenewal, correlationId },
      'SetAutoRenewalCommand: start'
    );

    const currentRow = await this.subscriptionRepo.findActiveByVendor(vendorId);
    if (!currentRow) throw new SubscriptionNotFoundError();

    const entity = SubscriptionMapper.toDomain(currentRow);
    entity.setAutoRenewal(autoRenewal);

    const persisted = await this.subscriptionRepo.persist(entity);

    this.logger.info(
      { vendorId: vendorId.toString(), subscriptionId: persisted.id.toString(), correlationId },
      'SetAutoRenewalCommand: updated'
    );

    return SubscriptionMapper.toAutoRenewalResponseDto(persisted);
  }
}
