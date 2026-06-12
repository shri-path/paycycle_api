/**
 * SubscriptionMapper — three-way mapping.
 * Field whitelist only; never spreads raw rows.
 */
import { SubscriptionPlanEntity } from './domain/plan.entity';
import { VendorSubscriptionEntity } from './domain/subscription.entity';
import {
  VendorSubscriptionProps,
  VendorSubscriptionStatus,
  BillingCycleEnum,
} from './domain/subscription.types';
import {
  VendorSubscriptionRow,
  InvoiceRow,
  HistoryRow,
} from './database/subscription.repository.port';
import {
  PlanDto,
  SubscriptionViewDto,
  UpgradeResponseDto,
  RenewResponseDto,
  CancelResponseDto,
  AutoRenewalResponseDto,
  InvoiceDto,
  HistoryEventDto,
  SubscriptionSummaryDto,
  InvoiceSummaryDto,
  UsageDto,
} from './subscription.types';

function formatDate(d: Date | null | undefined): string | null {
  if (!d) return null;
  return d.toISOString().substring(0, 10);
}

export class SubscriptionMapper {
  // ── Plan ──────────────────────────────────────────────────────────────────

  static toPlanDto(plan: SubscriptionPlanEntity): PlanDto {
    return {
      id: plan.id.toString(),
      planCode: plan.planCode,
      planName: plan.planName,
      maxCustomers: plan.limits.maxCustomers,
      maxStaff: plan.limits.maxStaff,
      maxSupplyLists: plan.limits.maxSupplyLists,
      priceMonthly: plan.priceMonthly.amount,
      priceYearly: plan.priceYearly?.amount ?? null,
      features: plan.features,
    };
  }

  // ── Subscription view (GET /subscription) ─────────────────────────────────

  static toSubscriptionViewDto(
    sub: VendorSubscriptionRow,
    plan: SubscriptionPlanEntity,
    usage: UsageDto,
    util: UsageDto,
    canAddMore: { customers: boolean; staff: boolean; supplyLists: boolean }
  ): SubscriptionViewDto {
    return {
      currentPlan: {
        subscriptionId: sub.id.toString(),
        planId: sub.subscriptionPlanId.toString(),
        planCode: plan.planCode,
        planName: plan.planName,
        status: sub.status,
        billingCycle: sub.billingCycle,
        startDate: formatDate(sub.startDate) ?? '',
        endDate: formatDate(sub.endDate),
        nextBillingDate: formatDate(sub.nextBillingDate),
        autoRenewal: sub.autoRenewal,
        isTrial: sub.isTrial,
        limits: {
          maxCustomers: plan.limits.maxCustomers,
          maxStaff: plan.limits.maxStaff,
          maxSupplyLists: plan.limits.maxSupplyLists,
        },
      },
      usage,
      utilizationPercentage: util,
      canAddMore,
    };
  }

  // ── Upgrade / Renew response DTOs ─────────────────────────────────────────

  private static toSubscriptionSummaryDto(
    sub: VendorSubscriptionRow,
    plan: SubscriptionPlanEntity
  ): SubscriptionSummaryDto {
    return {
      subscriptionId: sub.id.toString(),
      planId: plan.id.toString(),
      planCode: plan.planCode,
      planName: plan.planName,
      status: sub.status,
      billingCycle: sub.billingCycle,
      startDate: formatDate(sub.startDate) ?? '',
      endDate: formatDate(sub.endDate),
      nextBillingDate: formatDate(sub.nextBillingDate),
      autoRenewal: sub.autoRenewal,
    };
  }

  private static toInvoiceSummaryDto(invoice: InvoiceRow, paymentUrl: string): InvoiceSummaryDto {
    return {
      id: invoice.id.toString(),
      invoiceNumber: invoice.invoiceNumber,
      amount: invoice.amount,
      tax: invoice.tax,
      totalAmount: invoice.totalAmount,
      invoiceDate: formatDate(invoice.invoiceDate) ?? '',
      dueDate: formatDate(invoice.dueDate) ?? '',
      paymentStatus: invoice.paymentStatus,
      paymentUrl,
    };
  }

  static toUpgradeResponseDto(
    sub: VendorSubscriptionRow,
    plan: SubscriptionPlanEntity,
    invoice: InvoiceRow,
    paymentUrl: string
  ): UpgradeResponseDto {
    return {
      subscription: this.toSubscriptionSummaryDto(sub, plan),
      invoice: this.toInvoiceSummaryDto(invoice, paymentUrl),
    };
  }

  static toRenewResponseDto(
    sub: VendorSubscriptionRow,
    plan: SubscriptionPlanEntity,
    invoice: InvoiceRow,
    paymentUrl: string
  ): RenewResponseDto {
    return {
      subscription: this.toSubscriptionSummaryDto(sub, plan),
      invoice: this.toInvoiceSummaryDto(invoice, paymentUrl),
    };
  }

  // ── Cancel ────────────────────────────────────────────────────────────────

  static toCancelResponseDto(sub: VendorSubscriptionRow): CancelResponseDto {
    return {
      subscriptionId: sub.id.toString(),
      status: sub.status,
      autoRenewal: sub.autoRenewal,
      activeUntil: formatDate(sub.nextBillingDate),
    };
  }

  // ── Auto-renewal ──────────────────────────────────────────────────────────

  static toAutoRenewalResponseDto(sub: VendorSubscriptionRow): AutoRenewalResponseDto {
    return {
      subscriptionId: sub.id.toString(),
      autoRenewal: sub.autoRenewal,
    };
  }

  // ── Invoice list ──────────────────────────────────────────────────────────

  static toInvoiceDto(invoice: InvoiceRow): InvoiceDto {
    return {
      id: invoice.id.toString(),
      invoiceNumber: invoice.invoiceNumber,
      amount: invoice.amount,
      tax: invoice.tax,
      totalAmount: invoice.totalAmount,
      invoiceDate: formatDate(invoice.invoiceDate) ?? '',
      dueDate: formatDate(invoice.dueDate) ?? '',
      paymentStatus: invoice.paymentStatus,
      paymentDate: formatDate(invoice.paymentDate),
      paymentMethod: invoice.paymentMethod,
      paymentReference: invoice.paymentReference,
    };
  }

  // ── History list ──────────────────────────────────────────────────────────

  static toHistoryDto(
    h: HistoryRow,
    oldPlanName: string | null,
    newPlanName: string | null
  ): HistoryEventDto {
    return {
      id: h.id.toString(),
      eventType: h.eventType,
      oldPlanName,
      newPlanName,
      reason: h.reason,
      performedByUserId: h.performedByUserId?.toString() ?? null,
      createdAt: h.createdAt.toISOString(),
    };
  }

  // ── toDomain / toPersistence ──────────────────────────────────────────────

  static toDomain(row: VendorSubscriptionRow): VendorSubscriptionEntity {
    return VendorSubscriptionEntity.reconstitute(row.id, row.createdAt, row.updatedAt, {
      vendorId: row.vendorId,
      subscriptionPlanId: row.subscriptionPlanId,
      billingCycle: row.billingCycle as BillingCycleEnum,
      startDate: row.startDate,
      endDate: row.endDate,
      nextBillingDate: row.nextBillingDate,
      status: row.status as VendorSubscriptionStatus,
      amountPaid: row.amountPaid,
      autoRenewal: row.autoRenewal,
      isTrial: row.isTrial,
      trialEndsAt: row.trialEndsAt,
    });
  }

  static toPersistence(entity: VendorSubscriptionEntity): VendorSubscriptionProps {
    return entity.getProps();
  }
}
