/**
 * enforceSubscriptionLimit(resource) — subscription limit enforcement middleware.
 *
 * Placement: after identifyUserRole(vendorId), before the controller.
 *
 * Behaviour:
 *   1. Load the vendor's active subscription + plan limits.
 *   2. If plan is unlimited for the resource → next().
 *   3. Compute live count via UsageQueryService.
 *   4. If count < max → next(); else → next(SubscriptionLimitReachedError) [451].
 *   Fail-open: if no active subscription exists → warn-log + next() (OQ-8).
 */
import crypto from 'crypto';
import { Request, Response, NextFunction, RequestHandler } from 'express';
import { logger } from '@/infrastructure/logger/logger';
import { SubscriptionLimitReachedError } from '@/modules/subscription/domain/subscription.errors';
import { ISubscriptionRepository } from '@/modules/subscription/database/subscription.repository.port';
import { ISubscriptionPlanRepository } from '@/modules/subscription/database/plan.repository.port';
import {
  PlanLimitsVO,
  LimitResource,
} from '@/modules/subscription/domain/value-objects/plan-limits.vo';
import { IUsageCounter } from '@/modules/subscription/ports/usage-counter.port';

export function enforceSubscriptionLimit(
  resource: LimitResource,
  subscriptionRepo: ISubscriptionRepository,
  planRepo: ISubscriptionPlanRepository,
  usageCounter: IUsageCounter
): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    void run(req, next, resource, subscriptionRepo, planRepo, usageCounter);
  };
}

async function run(
  req: Request,
  next: NextFunction,
  resource: LimitResource,
  subscriptionRepo: ISubscriptionRepository,
  planRepo: ISubscriptionPlanRepository,
  usageCounter: IUsageCounter
): Promise<void> {
  const correlationId =
    (req.headers['x-correlation-id'] as string | undefined) ?? crypto.randomUUID();

  const vendorId = req.roleContext?.vendorId;
  if (!vendorId) {
    // Should not happen (identifyUserRole should have run first), but fail-open.
    logger.warn({ correlationId }, 'enforceSubscriptionLimit: no roleContext; failing open');
    return next();
  }

  try {
    const subRow = await subscriptionRepo.findActiveByVendor(vendorId);

    if (!subRow) {
      // Fail-open: no active subscription (data gap; once signup auto-assigns this never happens)
      logger.warn(
        { vendorId: vendorId.toString(), resource, correlationId },
        'enforceSubscriptionLimit: no active subscription found — failing open (OQ-8)'
      );
      return next();
    }

    const plan = await planRepo.findActiveById(subRow.subscriptionPlanId);
    if (!plan) {
      // Plan not found — fail-open
      logger.warn(
        { vendorId: vendorId.toString(), resource, correlationId },
        'enforceSubscriptionLimit: plan not found — failing open'
      );
      return next();
    }

    const limits = PlanLimitsVO.create(
      plan.limits.maxCustomers,
      plan.limits.maxStaff,
      plan.limits.maxSupplyLists
    );

    if (limits.isUnlimited(resource)) {
      return next();
    }

    const current = await getCount(resource, vendorId, usageCounter);
    const max = limits.max(resource);

    if (current < max) {
      return next();
    }

    const resourceLabel = resourceDisplayLabel(resource);
    next(
      new SubscriptionLimitReachedError(
        {
          upgradeUrl: '/subscription/upgrade',
          limits: { max, current },
        },
        `Your current plan allows up to ${max} ${resourceLabel}. Please upgrade to add more.`
      )
    );
  } catch (err) {
    // Unexpected error — fail-open and log
    logger.error(
      { err, vendorId: vendorId.toString(), resource, correlationId },
      'enforceSubscriptionLimit: unexpected error — failing open'
    );
    next();
  }
}

async function getCount(
  resource: LimitResource,
  vendorId: bigint,
  usageCounter: IUsageCounter
): Promise<number> {
  switch (resource) {
    case 'customers':
      return usageCounter.countCustomers(vendorId);
    case 'staff':
      return usageCounter.countStaff(vendorId);
    case 'supplyLists':
      return usageCounter.countSupplyLists(vendorId);
  }
}

function resourceDisplayLabel(resource: LimitResource): string {
  switch (resource) {
    case 'customers':
      return 'customers';
    case 'staff':
      return 'staff members';
    case 'supplyLists':
      return 'supply lists';
  }
}
