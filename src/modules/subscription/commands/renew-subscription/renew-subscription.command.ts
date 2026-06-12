/**
 * RenewSubscriptionCommand — renews or re-activates from EXPIRED.
 */
import { randomUUID } from 'crypto';
import { Logger } from '@/infrastructure/logger/logger';
import { ISubscriptionRepository } from '../../database/subscription.repository.port';
import { ISubscriptionPlanRepository } from '../../database/plan.repository.port';
import { SubscriptionMapper } from '../../subscription.mapper';
import { IPaymentGateway } from '../../services/payment/payment-gateway.port';
import { SubscriptionNotFoundError, PlanNotFoundError } from '../../domain/subscription.errors';
import {
  SubscriptionEventType,
  BillingCycleEnum,
  InvoicePaymentStatus,
} from '../../domain/subscription.types';
import { RenewResponseDto } from '../../subscription.types';

export interface RenewSubscriptionInput {
  vendorId: bigint;
  billingCycle: BillingCycleEnum;
  performedByUserId: bigint;
  today?: Date;
}

export class RenewSubscriptionCommand {
  constructor(
    private readonly subscriptionRepo: ISubscriptionRepository,
    private readonly planRepo: ISubscriptionPlanRepository,
    private readonly paymentGateway: IPaymentGateway,
    private readonly logger: Logger
  ) {}

  async execute(input: RenewSubscriptionInput): Promise<RenewResponseDto> {
    const correlationId = randomUUID();
    const today = input.today ?? new Date();
    const { vendorId, billingCycle, performedByUserId } = input;

    this.logger.info(
      { vendorId: vendorId.toString(), correlationId },
      'RenewSubscriptionCommand: start'
    );

    return this.subscriptionRepo.transaction(async (tx) => {
      // Look for active OR most-recent expired subscription
      let currentRow = await this.subscriptionRepo.findActiveByVendor(vendorId, tx);

      if (!currentRow) {
        // Re-activation from EXPIRED: find the most recent expired sub for this vendor
        const expiredRow = await this.subscriptionRepo.findLatestExpiredByVendor(vendorId, tx);
        if (!expiredRow) throw new SubscriptionNotFoundError();
        currentRow = expiredRow;
      }

      const plan = await this.planRepo.findActiveById(currentRow.subscriptionPlanId);
      if (!plan) throw new PlanNotFoundError('Current plan not found');

      const amount = plan.priceForCycle(billingCycle === BillingCycleEnum.YEARLY ? 365 : 30);

      const entity = SubscriptionMapper.toDomain(currentRow);
      entity.renew(billingCycle, today, amount, performedByUserId);

      const persisted = await this.subscriptionRepo.persist(entity, tx);

      await this.subscriptionRepo.appendHistory(
        {
          vendorSubscriptionId: persisted.id,
          eventType: SubscriptionEventType.RENEWED,
          newPlanId: plan.id,
          performedByUserId,
        },
        tx
      );

      const invoiceNumber = await this.subscriptionRepo.generateInvoiceNumber(vendorId, today, tx);
      const dueDate = new Date(today);
      dueDate.setDate(dueDate.getDate() + 5);

      const paymentStatus = amount === 0 ? InvoicePaymentStatus.PAID : InvoicePaymentStatus.PENDING;

      const invoiceRow = await this.subscriptionRepo.insertInvoice(
        {
          vendorSubscriptionId: persisted.id,
          vendorId,
          invoiceNumber,
          amount,
          tax: 0,
          totalAmount: amount,
          invoiceDate: today,
          dueDate,
          paymentStatus,
        },
        tx
      );

      let paymentUrl = `/subscription/upgrade`;
      try {
        const checkout = await this.paymentGateway.createCheckout({
          vendorId,
          invoiceId: invoiceRow.id,
          amount,
          currency: 'INR',
        });
        paymentUrl = checkout.paymentUrl;
      } catch {
        // Non-fatal
      }

      this.logger.info(
        { vendorId: vendorId.toString(), subscriptionId: persisted.id.toString(), correlationId },
        'RenewSubscriptionCommand: success'
      );

      return SubscriptionMapper.toRenewResponseDto(persisted, plan, invoiceRow, paymentUrl);
    });
  }
}
