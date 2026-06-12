/**
 * AssignStarterPlanCommand — assigns the Starter plan to a new vendor.
 * Idempotent: if vendor already has an active subscription, no-op (fail-open).
 */
import { randomUUID } from 'crypto';
import { Logger } from '@/infrastructure/logger/logger';
import { ISubscriptionRepository } from '../../database/subscription.repository.port';
import { ISubscriptionPlanRepository } from '../../database/plan.repository.port';
import { VendorSubscriptionEntity } from '../../domain/subscription.entity';
import { SubscriptionEventType } from '../../domain/subscription.types';
import { PlanNotFoundError } from '../../domain/subscription.errors';

export interface AssignStarterPlanInput {
  vendorId: bigint;
  today?: Date;
}

export class AssignStarterPlanCommand {
  constructor(
    private readonly subscriptionRepo: ISubscriptionRepository,
    private readonly planRepo: ISubscriptionPlanRepository,
    private readonly logger: Logger
  ) {}

  async execute(input: AssignStarterPlanInput): Promise<void> {
    const correlationId = randomUUID();
    const today = input.today ?? new Date();
    const { vendorId } = input;

    this.logger.info(
      { vendorId: vendorId.toString(), correlationId },
      'AssignStarterPlanCommand: start'
    );

    await this.subscriptionRepo.transaction(async (tx) => {
      // Idempotency: skip if vendor already has an active subscription
      const existing = await this.subscriptionRepo.findActiveByVendor(vendorId, tx);
      if (existing) {
        this.logger.info(
          { vendorId: vendorId.toString(), existingId: existing.id.toString(), correlationId },
          'AssignStarterPlanCommand: vendor already has active subscription — no-op'
        );
        return;
      }

      const plan = await this.planRepo.findByCode('STARTER');
      if (!plan) {
        throw new PlanNotFoundError('STARTER plan not found in database');
      }

      const entity = VendorSubscriptionEntity.createStarter(vendorId, plan, today);
      const persisted = await this.subscriptionRepo.persist(entity, tx);

      await this.subscriptionRepo.appendHistory(
        {
          vendorSubscriptionId: persisted.id,
          eventType: SubscriptionEventType.CREATED,
          newPlanId: plan.id,
          performedByUserId: null,
        },
        tx
      );

      this.logger.info(
        { vendorId: vendorId.toString(), subscriptionId: persisted.id.toString(), correlationId },
        'AssignStarterPlanCommand: starter plan assigned'
      );
    });
  }
}
