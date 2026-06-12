/**
 * UpgradeSubscriptionCommand — upgrades to a strictly higher-tier plan.
 * Pro-rata charged for remaining days. Runs in a single transaction.
 */
import { randomUUID } from 'crypto';
import { Logger } from '@/infrastructure/logger/logger';
import { ISubscriptionRepository } from '../../database/subscription.repository.port';
import { ISubscriptionPlanRepository } from '../../database/plan.repository.port';
import { SubscriptionMapper } from '../../subscription.mapper';
import { ProrataCalculator } from '../../services/prorata.calculator';
import { IPaymentGateway } from '../../services/payment/payment-gateway.port';
import { SubscriptionNotFoundError, PlanNotFoundError } from '../../domain/subscription.errors';
import { VendorSubscriptionEntity } from '../../domain/subscription.entity';
import {
  SubscriptionEventType,
  BillingCycleEnum,
  InvoicePaymentStatus,
} from '../../domain/subscription.types';
import { UpgradeResponseDto } from '../../subscription.types';
import { SubscriptionRepository } from '../../database/subscription.repository';

export interface UpgradeSubscriptionInput {
  vendorId: bigint;
  newPlanId: bigint;
  billingCycle: BillingCycleEnum;
  performedByUserId: bigint;
  today?: Date;
}

export class UpgradeSubscriptionCommand {
  constructor(
    private readonly subscriptionRepo: ISubscriptionRepository,
    private readonly planRepo: ISubscriptionPlanRepository,
    private readonly paymentGateway: IPaymentGateway,
    private readonly logger: Logger
  ) {}

  async execute(input: UpgradeSubscriptionInput): Promise<UpgradeResponseDto> {
    const correlationId = randomUUID();
    const today = input.today ?? new Date();
    const { vendorId, newPlanId, billingCycle, performedByUserId } = input;

    this.logger.info(
      { vendorId: vendorId.toString(), newPlanId: newPlanId.toString(), correlationId },
      'UpgradeSubscriptionCommand: start'
    );

    return this.subscriptionRepo.transaction(async (tx) => {
      const currentRow = await this.subscriptionRepo.findActiveByVendor(vendorId, tx);
      if (!currentRow) throw new SubscriptionNotFoundError();

      const newPlan = await this.planRepo.findActiveById(newPlanId);
      if (!newPlan) throw new PlanNotFoundError();

      const currentPlan = await this.planRepo.findActiveById(currentRow.subscriptionPlanId);
      if (!currentPlan) throw new PlanNotFoundError('Current plan not found');

      const prorataAmount = ProrataCalculator.compute(
        currentPlan,
        newPlan,
        billingCycle,
        today,
        currentRow.nextBillingDate
      );

      // Build the entities
      const currentEntity = SubscriptionMapper.toDomain(currentRow);
      currentEntity.closeForUpgrade(today);

      const newEntity = VendorSubscriptionEntity.upgradeTo(
        currentEntity,
        newPlan,
        currentPlan.tier,
        billingCycle,
        today,
        prorataAmount,
        performedByUserId
      );

      const { new: newRow } = await this.subscriptionRepo.closeAndOpen(
        currentEntity,
        newEntity,
        tx
      );

      // Append history
      await this.subscriptionRepo.appendHistory(
        {
          vendorSubscriptionId: newRow.id,
          eventType: SubscriptionEventType.UPGRADED,
          oldPlanId: currentPlan.id,
          newPlanId: newPlan.id,
          performedByUserId,
        },
        tx
      );

      // Generate invoice number inside the transaction
      const invoiceNumber = await SubscriptionRepository.generateInvoiceNumber(vendorId, today, tx);
      const dueDate = new Date(today);
      dueDate.setDate(dueDate.getDate() + 5);

      const paymentStatus =
        prorataAmount === 0 ? InvoicePaymentStatus.PAID : InvoicePaymentStatus.PENDING;

      const invoiceRow = await this.subscriptionRepo.insertInvoice(
        {
          vendorSubscriptionId: newRow.id,
          vendorId,
          invoiceNumber,
          amount: prorataAmount,
          tax: 0,
          totalAmount: prorataAmount,
          invoiceDate: today,
          dueDate,
          paymentStatus,
        },
        tx
      );

      // Create checkout stub (outside critical path — any error is non-fatal)
      let paymentUrl = `/subscription/upgrade`;
      try {
        const checkout = await this.paymentGateway.createCheckout({
          vendorId,
          invoiceId: invoiceRow.id,
          amount: prorataAmount,
          currency: 'INR',
        });
        paymentUrl = checkout.paymentUrl;
      } catch {
        // Payment gateway failure is non-fatal (stub always succeeds anyway)
      }

      this.logger.info(
        {
          vendorId: vendorId.toString(),
          newSubscriptionId: newRow.id.toString(),
          prorataAmount,
          correlationId,
        },
        'UpgradeSubscriptionCommand: success'
      );

      return SubscriptionMapper.toUpgradeResponseDto(newRow, newPlan, invoiceRow, paymentUrl);
    });
  }
}
