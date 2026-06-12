/**
 * Domain errors for the Platform Subscription & Billing context.
 * Extends the shared app-error base classes.
 */
import {
  AppError,
  NotFoundError,
  UnprocessableEntityError,
  ConflictError,
} from '@/common/errors/app-error';

export class SubscriptionNotFoundError extends NotFoundError {
  constructor(message = 'Subscription not found') {
    super(message);
    this.name = 'SubscriptionNotFoundError';
  }
}

export class PlanNotFoundError extends NotFoundError {
  constructor(message = 'Plan not found') {
    super(message);
    this.name = 'PlanNotFoundError';
  }
}

export class InvalidPlanUpgradeError extends UnprocessableEntityError {
  constructor(message = 'Target plan must be a strictly higher tier than the current plan') {
    super(message);
    this.name = 'InvalidPlanUpgradeError';
  }
}

export class SubscriptionAlreadyCancelledError extends UnprocessableEntityError {
  constructor(message = 'Subscription is already cancelled') {
    super(message);
    this.name = 'SubscriptionAlreadyCancelledError';
  }
}

export class SubscriptionConflictError extends ConflictError {
  constructor(message = 'Subscription already active') {
    super(message);
    this.name = 'SubscriptionConflictError';
  }
}

export interface SubscriptionLimitDetails {
  upgradeUrl: string;
  limits: { max: number; current: number };
}

export class SubscriptionLimitReachedError extends AppError {
  constructor(details: SubscriptionLimitDetails, message?: string) {
    const max = details.limits.max;
    const current = details.limits.current;
    super(
      message ?? `Your current plan allows up to ${max}. Please upgrade to add more.`,
      451,
      'SUBSCRIPTION_LIMIT_REACHED',
      true,
      details
    );
    this.name = 'SubscriptionLimitReachedError';
    // Ensure HTTP 451 round-trips correctly through toJSON
    void current;
  }
}
