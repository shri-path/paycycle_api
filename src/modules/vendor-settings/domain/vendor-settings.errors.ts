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
