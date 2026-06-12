import { NotFoundError, ConflictError, UnprocessableEntityError } from '@/common/errors/app-error';

export class CustomerNotFoundError extends NotFoundError {
  constructor(id?: bigint | string) {
    super(id ? `Customer ${id} not found` : 'Customer not found');
  }
}

export class CustomerConflictError extends ConflictError {
  constructor(message = 'A customer with this phone number already exists') {
    super(message);
  }
}

export class CustomerAlreadyInactiveError extends UnprocessableEntityError {
  constructor() {
    super('Customer is already inactive');
  }
}

export class CustomerAlreadyActiveError extends UnprocessableEntityError {
  constructor() {
    super('Customer is already active');
  }
}

export class SubscriptionConflictError extends ConflictError {
  constructor() {
    super('Customer is already subscribed to this supply list');
  }
}

export class SubscriptionNotActiveError extends UnprocessableEntityError {
  constructor() {
    super('Subscription is not active or does not exist');
  }
}

export class SubscriptionNotFoundError extends NotFoundError {
  constructor() {
    super('Subscription not found');
  }
}

export class PaymentNotFoundError extends NotFoundError {
  constructor() {
    super('Payment not found');
  }
}
