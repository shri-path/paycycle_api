/**
 * ExpireOrRenewDueCommand — cron worker.
 * For each due subscription: auto-renew if flag set, else expire.
 */
import { Logger } from '@/infrastructure/logger/logger';
import { ISubscriptionRepository } from '../../database/subscription.repository.port';
import { ISubscriptionPlanRepository } from '../../database/plan.repository.port';
import { SubscriptionMapper } from '../../subscription.mapper';
import {
  SubscriptionEventType,
  BillingCycleEnum,
  InvoicePaymentStatus,
} from '../../domain/subscription.types';
import { SubscriptionRepository } from '../../database/subscription.repository';

export interface ExpireOrRenewResult {
  renewed: number;
  expired: number;
}

export class ExpireOrRenewDueCommand {
  constructor(
    private readonly subscriptionRepo: ISubscriptionRepository,
    private readonly planRepo: ISubscriptionPlanRepository,
    private readonly logger: Logger
  ) {}

  async run(today: Date): Promise<ExpireOrRenewResult> {
    const due = await this.subscriptionRepo.findDueSubscriptions(today);
    let renewed = 0;
    let expired = 0;

    for (const row of due) {
      try {
        if (row.autoRenewal) {
          await this.subscriptionRepo.transaction(async (tx) => {
            const plan = await this.planRepo.findActiveById(row.subscriptionPlanId);
            if (!plan) {
              this.logger.warn(
                { subscriptionId: row.id.toString() },
                'ExpireOrRenewDueCommand: plan not found; skipping auto-renew'
              );
              return;
            }

            const amount = plan.priceForCycle(row.billingCycle === 'YEARLY' ? 365 : 30);

            const entity = SubscriptionMapper.toDomain(row);
            entity.renew(row.billingCycle as BillingCycleEnum, today, amount, null);

            const persisted = await this.subscriptionRepo.persist(entity, tx);

            await this.subscriptionRepo.appendHistory(
              {
                vendorSubscriptionId: persisted.id,
                eventType: SubscriptionEventType.RENEWED,
                newPlanId: plan.id,
                performedByUserId: null,
              },
              tx
            );

            const invoiceNumber = await SubscriptionRepository.generateInvoiceNumber(
              row.vendorId,
              today,
              tx
            );
            const dueDate = new Date(today);
            dueDate.setDate(dueDate.getDate() + 5);

            await this.subscriptionRepo.insertInvoice(
              {
                vendorSubscriptionId: persisted.id,
                vendorId: row.vendorId,
                invoiceNumber,
                amount,
                tax: 0,
                totalAmount: amount,
                invoiceDate: today,
                dueDate,
                paymentStatus:
                  amount === 0 ? InvoicePaymentStatus.PAID : InvoicePaymentStatus.PENDING,
              },
              tx
            );
          });

          this.logger.info(
            { subscriptionId: row.id.toString(), vendorId: row.vendorId.toString() },
            'ExpireOrRenewDueCommand: auto-renewed (notification: log-stub)'
          );
          renewed++;
        } else {
          await this.subscriptionRepo.transaction(async (tx) => {
            const entity = SubscriptionMapper.toDomain(row);
            entity.expire(today);
            const persisted = await this.subscriptionRepo.persist(entity, tx);

            await this.subscriptionRepo.appendHistory(
              {
                vendorSubscriptionId: persisted.id,
                eventType: SubscriptionEventType.EXPIRED,
                performedByUserId: null,
              },
              tx
            );
          });

          this.logger.info(
            { subscriptionId: row.id.toString(), vendorId: row.vendorId.toString() },
            'ExpireOrRenewDueCommand: expired (notification: log-stub)'
          );
          expired++;
        }
      } catch (err) {
        this.logger.error(
          { subscriptionId: row.id.toString(), error: err },
          'ExpireOrRenewDueCommand: failed to process subscription'
        );
      }
    }

    this.logger.info({ renewed, expired }, 'ExpireOrRenewDueCommand: done');
    return { renewed, expired };
  }
}
