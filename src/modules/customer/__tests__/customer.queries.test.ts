/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/**
 * Unit tests for Customer module queries.
 */

import { ListCustomersQuery } from '../queries/list-customers/list-customers.query';
import { GetCustomerQuery } from '../queries/get-customer/get-customer.query';
import { GetCustomerBillQuery } from '../queries/get-customer-bill/get-customer-bill.query';
import { ListPaymentsQuery } from '../queries/list-payments/list-payments.query';
import { CustomerNotFoundError } from '../domain/customer.errors';
import { ForbiddenError } from '@/common/errors/app-error';

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
    creditLimit: 1000,
    paymentScore: 100,
    customerSince: null,
    status: 'ACTIVE',
    createdByUserId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    supplyListNames: [],
    ...overrides,
  };
}

function makeDetailRow(overrides: any = {}): any {
  return {
    ...makeRow(),
    subscriptions: [
      {
        id: 10n,
        supplyListId: 5n,
        supplyListName: 'Morning Milk',
        startTime: '06:00',
        customQuantity: null,
        defaultQuantity: 1,
        unit: 'ltr',
        customRatePerUnit: null,
        defaultRatePerUnit: 50,
        frequency: 'DAILY',
        startDate: null,
        endDate: null,
        isActive: true,
      },
    ],
    ...overrides,
  };
}

// ── ListCustomersQuery ───────────────────────────────────────────────────────

describe('ListCustomersQuery', () => {
  it('returns empty list when no customers', async () => {
    const repo = {
      listCustomers: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
    } as any;
    const billing = {
      getBulkBalances: jest.fn().mockResolvedValue(new Map()),
      getCurrentMonthTotal: jest.fn().mockResolvedValue(0),
    } as any;

    const qry = new ListCustomersQuery(repo, billing);
    const result = await qry.execute({
      vendorId: 1n,
      isOwner: true,
      page: 1,
      limit: 20,
    });

    expect(result.total).toBe(0);
    expect(result.customers).toHaveLength(0);
  });

  it('returns customers with balance for owner', async () => {
    const row = makeRow();
    const balanceMap = new Map([['1', 200]]);
    const repo = {
      listCustomers: jest.fn().mockResolvedValue({ rows: [row], total: 1 }),
    } as any;
    const billing = {
      getBulkBalances: jest.fn().mockResolvedValue(balanceMap),
      getCurrentMonthTotal: jest.fn().mockResolvedValue(500),
    } as any;

    const qry = new ListCustomersQuery(repo, billing);
    const result = await qry.execute({
      vendorId: 1n,
      isOwner: true,
      page: 1,
      limit: 20,
    });

    expect(result.customers[0].currentBalance).toBe(200);
    expect(result.customers[0].paymentStatus).toBe('pending'); // 200 <= 1000
  });

  it('omits balance for staff', async () => {
    const row = makeRow();
    const repo = {
      listCustomers: jest.fn().mockResolvedValue({ rows: [row], total: 1 }),
    } as any;
    const billing = {} as any;

    const qry = new ListCustomersQuery(repo, billing);
    const result = await qry.execute({
      vendorId: 1n,
      isOwner: false,
      staffListIds: [5n],
      page: 1,
      limit: 20,
    });

    expect(result.customers[0].currentBalance).toBeNull();
    expect(result.customers[0].paymentStatus).toBeNull();
  });

  it('filters by paymentStatusFilter', async () => {
    const row1 = makeRow({ id: 1n });
    const row2 = makeRow({ id: 2n });
    const balanceMap = new Map([
      ['1', 200],
      ['2', 0],
    ]);
    const repo = {
      listCustomers: jest.fn().mockResolvedValue({ rows: [row1, row2], total: 2 }),
    } as any;
    const billing = {
      getBulkBalances: jest.fn().mockResolvedValue(balanceMap),
      getCurrentMonthTotal: jest.fn().mockResolvedValue(0),
    } as any;

    const qry = new ListCustomersQuery(repo, billing);
    const result = await qry.execute({
      vendorId: 1n,
      isOwner: true,
      page: 1,
      limit: 20,
      paymentStatusFilter: 'paid',
    });

    // Only row2 (balance 0) should be 'paid'
    expect(result.customers).toHaveLength(1);
    expect(result.customers[0].id).toBe('2');
  });
});

// ── GetCustomerQuery ─────────────────────────────────────────────────────────

describe('GetCustomerQuery', () => {
  it('returns customer detail for owner', async () => {
    const detailRow = makeDetailRow();
    const repo = {
      getCustomerWithDetail: jest.fn().mockResolvedValue(detailRow),
      listPayments: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
    } as any;
    const billing = {
      getCustomerBalance: jest.fn().mockResolvedValue(300),
      getCurrentMonthTotal: jest.fn().mockResolvedValue(600),
    } as any;

    const qry = new GetCustomerQuery(repo, billing);
    const result = await qry.execute({ customerId: 1n, vendorId: 1n, isOwner: true });

    expect(result.id).toBe('1');
    expect(result.currentBalance).toBe(300);
    expect(result.subscriptions).toHaveLength(1);
  });

  it('throws CustomerNotFoundError when not found', async () => {
    const repo = {
      getCustomerWithDetail: jest.fn().mockResolvedValue(null),
    } as any;

    const qry = new GetCustomerQuery(repo, {} as any);
    await expect(
      qry.execute({ customerId: 99n, vendorId: 1n, isOwner: true })
    ).rejects.toBeInstanceOf(CustomerNotFoundError);
  });

  it('throws ForbiddenError when staff has no matching list', async () => {
    const detailRow = makeDetailRow(); // subscription is in list 5n
    const repo = {
      getCustomerWithDetail: jest.fn().mockResolvedValue(detailRow),
    } as any;

    const qry = new GetCustomerQuery(repo, {} as any);
    await expect(
      qry.execute({
        customerId: 1n,
        vendorId: 1n,
        isOwner: false,
        staffListIds: [99n], // does not match subscription list 5n
      })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('allows staff access when list matches', async () => {
    const detailRow = makeDetailRow(); // subscription in list 5n
    const repo = {
      getCustomerWithDetail: jest.fn().mockResolvedValue(detailRow),
      listPayments: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
    } as any;
    const billing = {} as any;

    const qry = new GetCustomerQuery(repo, billing);
    const result = await qry.execute({
      customerId: 1n,
      vendorId: 1n,
      isOwner: false,
      staffListIds: [5n], // matches subscription
    });

    expect(result.id).toBe('1');
    expect(result.currentBalance).toBeNull(); // staff gets no balance
  });
});

// ── GetCustomerBillQuery ─────────────────────────────────────────────────────

describe('GetCustomerBillQuery', () => {
  it('throws on invalid month format', async () => {
    const qry = new GetCustomerBillQuery({} as any, {} as any);
    await expect(
      qry.execute({ customerId: 1n, vendorId: 1n, month: 'June-2026' })
    ).rejects.toThrow();
  });

  it('throws CustomerNotFoundError when customer not found', async () => {
    const repo = { findById: jest.fn().mockResolvedValue(null) } as any;
    const qry = new GetCustomerBillQuery(repo, {} as any);
    await expect(
      qry.execute({ customerId: 99n, vendorId: 1n, month: '2026-06' })
    ).rejects.toBeInstanceOf(CustomerNotFoundError);
  });

  it('returns bill with correct totals', async () => {
    const repo = { findById: jest.fn().mockResolvedValue(makeRow({ creditLimit: 1000 })) } as any;
    const billing = {
      getMonthlyDeliveries: jest.fn().mockResolvedValue([
        {
          supplyListName: 'Milk',
          deliveries: 30,
          leaves: 0,
          totalQuantity: 30,
          unit: 'ltr',
          ratePerUnit: 50,
          subtotal: 1500,
        },
      ]),
      getMonthlyExtraCharges: jest.fn().mockResolvedValue([]),
      getBalanceAsOf: jest.fn().mockResolvedValue(200),
    } as any;

    const qry = new GetCustomerBillQuery(repo, billing);
    const result = await qry.execute({ customerId: 1n, vendorId: 1n, month: '2026-06' });

    expect(result.billDetails.subtotal).toBe(1500);
    expect(result.billDetails.previousDue).toBe(200);
    expect(result.billDetails.totalDue).toBe(1700);
    expect(result.paymentStatus).toBe('overdue'); // 1700 > 1000 credit limit
  });
});

// ── ListPaymentsQuery ────────────────────────────────────────────────────────

describe('ListPaymentsQuery', () => {
  it('throws CustomerNotFoundError when customer not found', async () => {
    const repo = { findById: jest.fn().mockResolvedValue(null) } as any;
    const qry = new ListPaymentsQuery(repo);
    await expect(
      qry.execute({ customerId: 99n, vendorId: 1n, page: 1, limit: 20 })
    ).rejects.toBeInstanceOf(CustomerNotFoundError);
  });

  it('returns paginated payment list', async () => {
    const paymentRows = [
      {
        id: 1n,
        customerId: 1n,
        vendorId: 1n,
        amount: 500,
        paymentDate: new Date('2026-06-01'),
        paymentMethod: 'CASH',
        referenceNumber: null,
        recordedByUserId: 1n,
        createdAt: new Date(),
      },
    ];
    const repo = {
      findById: jest.fn().mockResolvedValue(makeRow()),
      listPayments: jest.fn().mockResolvedValue({ rows: paymentRows, total: 1 }),
    } as any;

    const qry = new ListPaymentsQuery(repo);
    const result = await qry.execute({ customerId: 1n, vendorId: 1n, page: 1, limit: 20 });

    expect(result.total).toBe(1);
    expect(result.payments).toHaveLength(1);
    expect(result.payments[0].amount).toBe(500);
    expect(result.payments[0].method).toBe('cash');
  });
});
