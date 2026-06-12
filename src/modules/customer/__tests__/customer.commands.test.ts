/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/**
 * Unit tests for Customer module commands.
 * All external dependencies (repository, billing port, prisma) are mocked.
 */

import { CreateCustomerCommand } from '../commands/create-customer/create-customer.command';
import { UpdateCustomerCommand } from '../commands/update-customer/update-customer.command';
import { DeactivateCustomerCommand } from '../commands/deactivate-customer/deactivate-customer.command';
import { UpdateCreditLimitCommand } from '../commands/update-credit-limit/update-credit-limit.command';
import { RecordPaymentCommand } from '../commands/record-payment/record-payment.command';
import { CustomerConflictError, CustomerNotFoundError } from '../domain/customer.errors';
import { PaymentMethod } from '../domain/customer.entity';

const logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
} as any;

/** Helper: builds a minimal CustomerRow */
function makeRow(overrides: any = {}): any {
  return {
    id: 1n,
    vendorId: 1n,
    name: 'Test Customer',
    phone: '+919876543210',
    phoneCountryCode: '+91',
    email: null,
    address: null,
    area: null,
    locality: null,
    languagePreference: 'en',
    creditLimit: 0,
    paymentScore: 100,
    customerSince: null,
    status: 'ACTIVE',
    createdByUserId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    supplyListNames: [],
    subscriptions: [],
    ...overrides,
  };
}

function makePaymentRow(overrides: any = {}): any {
  return {
    id: 10n,
    customerId: 1n,
    vendorId: 1n,
    amount: 500,
    paymentDate: new Date(),
    paymentMethod: 'CASH',
    referenceNumber: null,
    recordedByUserId: 1n,
    createdAt: new Date(),
    ...overrides,
  };
}

// ── CreateCustomerCommand ────────────────────────────────────────────────────

describe('CreateCustomerCommand', () => {
  it('creates a customer successfully', async () => {
    const row = makeRow();
    const repo = {
      findByPhone: jest.fn().mockResolvedValue(null),
      insert: jest.fn().mockResolvedValue(row),
      getCustomerWithDetail: jest.fn().mockResolvedValue({ ...row, subscriptions: [] }),
    } as any;
    const billing = {
      getCustomerBalance: jest.fn().mockResolvedValue(0),
      getCurrentMonthTotal: jest.fn().mockResolvedValue(0),
    } as any;

    const cmd = new CreateCustomerCommand(repo, billing, logger);
    const result = await cmd.execute({
      vendorId: 1n,
      performedByUserId: 5n,
      name: 'Test Customer',
      phone: '9876543210',
    });

    expect(result.id).toBe(row.id.toString());
    expect(repo.findByPhone).toHaveBeenCalledTimes(1);
    expect(repo.insert).toHaveBeenCalledTimes(1);
  });

  it('throws CustomerConflictError when phone already exists', async () => {
    const repo = {
      findByPhone: jest.fn().mockResolvedValue(makeRow()),
    } as any;
    const billing = {} as any;

    const cmd = new CreateCustomerCommand(repo, billing, logger);
    await expect(
      cmd.execute({
        vendorId: 1n,
        performedByUserId: 5n,
        name: 'Test Customer',
        phone: '9876543210',
      })
    ).rejects.toBeInstanceOf(CustomerConflictError);
  });
});

// ── UpdateCustomerCommand ────────────────────────────────────────────────────

describe('UpdateCustomerCommand', () => {
  it('throws CustomerNotFoundError when customer not found', async () => {
    const repo = {
      findById: jest.fn().mockResolvedValue(null),
    } as any;

    const cmd = new UpdateCustomerCommand(repo, {} as any, logger);
    await expect(
      cmd.execute({ customerId: 99n, vendorId: 1n, name: 'New Name' })
    ).rejects.toBeInstanceOf(CustomerNotFoundError);
  });

  it('updates customer name', async () => {
    const row = makeRow();
    const detailRow = { ...row, subscriptions: [] };
    const repo = {
      findById: jest.fn().mockResolvedValue(row),
      findByPhone: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue(undefined),
      getCustomerWithDetail: jest.fn().mockResolvedValue(detailRow),
    } as any;
    const billing = {
      getCustomerBalance: jest.fn().mockResolvedValue(0),
      getCurrentMonthTotal: jest.fn().mockResolvedValue(0),
    } as any;

    const cmd = new UpdateCustomerCommand(repo, billing, logger);
    const result = await cmd.execute({ customerId: 1n, vendorId: 1n, name: 'New Name' });

    expect(result).toBeDefined();
    expect(repo.update).toHaveBeenCalledTimes(1);
  });
});

// ── DeactivateCustomerCommand ────────────────────────────────────────────────

describe('DeactivateCustomerCommand', () => {
  it('deactivates an active customer', async () => {
    const repo = {
      findById: jest.fn().mockResolvedValue(makeRow({ status: 'ACTIVE' })),
      deactivate: jest.fn().mockResolvedValue(undefined),
    } as any;

    const cmd = new DeactivateCustomerCommand(repo, logger);
    await expect(cmd.execute({ customerId: 1n, vendorId: 1n })).resolves.toBeUndefined();
    expect(repo.deactivate).toHaveBeenCalledWith(1n, expect.any(Date));
  });

  it('throws CustomerNotFoundError when not found', async () => {
    const repo = {
      findById: jest.fn().mockResolvedValue(null),
    } as any;

    const cmd = new DeactivateCustomerCommand(repo, logger);
    await expect(cmd.execute({ customerId: 99n, vendorId: 1n })).rejects.toBeInstanceOf(
      CustomerNotFoundError
    );
  });

  it('throws when customer is already inactive', async () => {
    const repo = {
      findById: jest.fn().mockResolvedValue(makeRow({ status: 'INACTIVE' })),
    } as any;

    const cmd = new DeactivateCustomerCommand(repo, logger);
    await expect(cmd.execute({ customerId: 1n, vendorId: 1n })).rejects.toThrow();
  });
});

// ── UpdateCreditLimitCommand ─────────────────────────────────────────────────

describe('UpdateCreditLimitCommand', () => {
  it('updates credit limit and returns utilization', async () => {
    const repo = {
      findById: jest.fn().mockResolvedValue(makeRow()),
      update: jest.fn().mockResolvedValue(undefined),
    } as any;
    const billing = {
      getCustomerBalance: jest.fn().mockResolvedValue(500),
    } as any;

    const cmd = new UpdateCreditLimitCommand(repo, billing, logger);
    const result = await cmd.execute({ customerId: 1n, vendorId: 1n, creditLimit: 1000 });

    expect(result.creditLimit).toBe(1000);
    expect(result.creditUtilization).toBe(50); // 500/1000 * 100
  });

  it('throws CustomerNotFoundError', async () => {
    const repo = {
      findById: jest.fn().mockResolvedValue(null),
    } as any;

    const cmd = new UpdateCreditLimitCommand(repo, {} as any, logger);
    await expect(
      cmd.execute({ customerId: 99n, vendorId: 1n, creditLimit: 500 })
    ).rejects.toBeInstanceOf(CustomerNotFoundError);
  });
});

// ── RecordPaymentCommand ─────────────────────────────────────────────────────

describe('RecordPaymentCommand', () => {
  it('records a payment', async () => {
    const paymentRow = makePaymentRow();
    const repo = {
      findById: jest.fn().mockResolvedValue(makeRow()),
      insertPayment: jest.fn().mockResolvedValue(paymentRow),
    } as any;

    const cmd = new RecordPaymentCommand(repo, logger);
    const result = await cmd.execute({
      customerId: 1n,
      vendorId: 1n,
      recordedByUserId: 5n,
      amount: 500,
      paymentDate: new Date(),
      paymentMethod: PaymentMethod.CASH,
    });

    expect(result.amount).toBe(500);
    expect(result.method).toBe('cash');
    expect(repo.insertPayment).toHaveBeenCalledTimes(1);
  });

  it('throws CustomerNotFoundError when customer not found', async () => {
    const repo = {
      findById: jest.fn().mockResolvedValue(null),
    } as any;

    const cmd = new RecordPaymentCommand(repo, logger);
    await expect(
      cmd.execute({
        customerId: 99n,
        vendorId: 1n,
        recordedByUserId: 5n,
        amount: 500,
        paymentDate: new Date(),
        paymentMethod: PaymentMethod.CASH,
      })
    ).rejects.toBeInstanceOf(CustomerNotFoundError);
  });

  it('throws on invalid (negative) amount via PaymentEntity', async () => {
    const repo = {
      findById: jest.fn().mockResolvedValue(makeRow()),
    } as any;

    const cmd = new RecordPaymentCommand(repo, logger);
    await expect(
      cmd.execute({
        customerId: 1n,
        vendorId: 1n,
        recordedByUserId: 5n,
        amount: -100,
        paymentDate: new Date(),
        paymentMethod: PaymentMethod.CASH,
      })
    ).rejects.toThrow();
  });
});
