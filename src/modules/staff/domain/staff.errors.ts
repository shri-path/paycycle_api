import { AppError, NotFoundError, UnprocessableEntityError } from '@/common/errors/app-error';

/**
 * Illegal membership status transition (e.g. enabling a REMOVED member).
 * 422 Unprocessable Entity.
 */
export class InvalidStatusTransitionError extends UnprocessableEntityError {
  constructor(message = 'Invalid status transition') {
    super(message);
  }
}

/**
 * Invite token is unknown or already used.
 * Modeled as 404 NotFound to avoid revealing token validity (OQ-4).
 */
export class InvalidInviteError extends NotFoundError {
  constructor(message = 'Invitation not found or already used') {
    super(message);
  }
}

/**
 * Invite token exists but is past its expiry.
 * 422 Unprocessable Entity (OQ-4).
 */
export class ExpiredInviteError extends UnprocessableEntityError {
  constructor(message = 'Invitation has expired') {
    super(message);
  }
}

/**
 * Vendor's subscription staff limit reached.
 * 451 is non-standard but required by the story spec (OQ-7).
 */
export class SubscriptionLimitError extends AppError {
  constructor(message = 'Subscription staff limit reached') {
    super(message, 451, 'SUBSCRIPTION_LIMIT', true);
  }
}

/**
 * A capability is gated behind an unbuilt module (e.g. supply-list assignment
 * before US-005 ships). 503 Service Unavailable. Reached only after the auth →
 * owner → tenant guards pass, so it never leaks resource existence.
 */
export class FeatureNotAvailableError extends AppError {
  constructor(message = 'This feature is not available yet') {
    super(message, 503, 'FEATURE_NOT_AVAILABLE', true);
  }
}
