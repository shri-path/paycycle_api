/**
 * Domain exceptions for VendorSettings aggregate.
 * Framework-free.
 */

export class InvalidTimeOfDayError extends Error {
  readonly code = 'INVALID_TIME_OF_DAY';

  constructor(value: string) {
    super(`Invalid autoSendBillsTime "${value}". Expected HH:mm (00:00–23:59).`);
    this.name = 'InvalidTimeOfDayError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class InvalidNotificationPreferencesError extends Error {
  readonly code = 'INVALID_NOTIFICATION_PREFERENCES';

  constructor() {
    super('notificationPreferences must be a plain JSON object (not an array or primitive).');
    this.name = 'InvalidNotificationPreferencesError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class InvalidCreditLimitError extends Error {
  readonly code = 'INVALID_CREDIT_LIMIT';

  constructor(value: unknown) {
    super(
      `Invalid defaultCreditLimit "${String(value)}". Must be a non-negative decimal string with max 10 digits and 2 decimal places.`
    );
    this.name = 'InvalidCreditLimitError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class InvalidCreditPeriodError extends Error {
  readonly code = 'INVALID_CREDIT_PERIOD';

  constructor(value: unknown) {
    super(
      `Invalid defaultCreditPeriodDays "${String(value)}". Must be an integer between 1 and 365.`
    );
    this.name = 'InvalidCreditPeriodError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class InvalidBulkDateError extends Error {
  readonly code = 'INVALID_BULK_DATE';

  constructor(value: string) {
    super(
      `Invalid bulk operation date "${value}". Date must be today or in the future (Asia/Kolkata).`
    );
    this.name = 'InvalidBulkDateError';
    Error.captureStackTrace(this, this.constructor);
  }
}
