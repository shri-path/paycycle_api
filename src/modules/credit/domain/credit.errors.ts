import { NotFoundError, ConflictError } from '@/common/errors/app-error';

export class CreditSettingsNotFoundError extends NotFoundError {
  constructor(customerId?: bigint | string) {
    super(
      customerId
        ? `Credit settings for customer ${customerId} not found`
        : 'Credit settings not found'
    );
  }
}

export class InvalidCreditTransitionError extends ConflictError {
  constructor(message = 'Invalid credit type transition') {
    super(message);
  }
}

export class ReminderConfigNotFoundError extends NotFoundError {
  constructor(vendorId?: bigint | string) {
    super(
      vendorId ? `Reminder config for vendor ${vendorId} not found` : 'Reminder config not found'
    );
  }
}
