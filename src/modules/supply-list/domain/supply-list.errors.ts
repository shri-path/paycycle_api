import { ConflictError, NotFoundError, UnprocessableEntityError } from '@/common/errors/app-error';

/**
 * A supply list with the same (case-insensitive) name already exists for this
 * vendor among its active lists (OQ-5). 409 Conflict.
 */
export class DuplicateListNameError extends ConflictError {
  constructor(message = 'A supply list with this name already exists') {
    super(message);
  }
}

/**
 * A staff member targeted for assignment is not an ACTIVE member of the vendor
 * (disabled, removed, or belongs to another vendor — edge #4). 422.
 */
export class StaffNotAssignableError extends UnprocessableEntityError {
  constructor(message = 'Staff member is not available for assignment') {
    super(message);
  }
}

/**
 * A customer targeted for subscription does not belong to the vendor. 422.
 */
export class CustomerNotInVendorError extends UnprocessableEntityError {
  constructor(message = 'Customer does not belong to this vendor') {
    super(message);
  }
}

/**
 * All requested customers already hold an active subscription on this list. 409.
 */
export class AllCustomersAlreadySubscribedError extends ConflictError {
  constructor(message = 'All selected customers are already subscribed to this list') {
    super(message);
  }
}

/**
 * Illegal subscription status transition (e.g. reactivating an ENDED one). 422.
 */
export class InvalidSubscriptionTransitionError extends UnprocessableEntityError {
  constructor(message = 'Invalid subscription status transition') {
    super(message);
  }
}

/**
 * A subscription's effective quantity/rate cannot be resolved because neither a
 * per-subscription override nor a list default is set. Surfaces as 422 instead of
 * a leaking 500 (BUG-3).
 */
export class MissingSubscriptionPricingError extends UnprocessableEntityError {
  constructor(message = 'Subscription quantity or rate is not set and the list has no default') {
    super(message);
  }
}

/**
 * Supply list not found OR belongs to another tenant (masked). 404.
 */
export class SupplyListNotFoundError extends NotFoundError {
  constructor(message = 'Supply list not found') {
    super(message);
  }
}

/**
 * Subscription not found OR belongs to another tenant/list (masked). 404.
 */
export class SubscriptionNotFoundError extends NotFoundError {
  constructor(message = 'Subscription not found') {
    super(message);
  }
}
