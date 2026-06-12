/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { shouldGenerateForDate, appToday, appYesterday } from '../delivery.shared';
import { MarkDeliveryCommand } from '../commands/mark-delivery.command';
import { AddExtraChargeCommand } from '../commands/add-extra-charge.command';
import { CreateLeaveCommand } from '../commands/create-leave.command';
import { GenerateDailySuppliesCommand } from '../commands/generate-daily-supplies.command';
import { AutoMarkSweepCommand } from '../commands/auto-mark-sweep.command';
import { GetTodayDeliveriesQuery } from '../queries/get-today-deliveries.query';
import {
  DailySupplyEntity,
  DeliveryNotFoundError,
  ChargeOnNonDeliverableError,
  NoActiveSubscriptionError,
  InvalidDeliveryTransitionError,
  deriveConflict,
  DeliveryStatusVO,
} from '../delivery.domain';
import { PermissionKey } from '@/modules/staff/domain/value-objects/permission-key.value-object';
import { ForbiddenError } from '@/common/errors/app-error';

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as any;
const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;

function dailyRecord(overrides: any = {}): any {
  return {
    id: 10n,
    vendorId: 1n,
    supplyListCustomerId: 50n,
    supplyListId: 20n,
    serviceDate: new Date('2026-04-12T00:00:00Z'),
    status: 'PENDING',
    quantity: { toString: () => '1.000' },
    unit: 'ltr',
    ratePerUnit: { toString: () => '50.00' },
    baseAmount: { toString: () => '50.00' },
    finalAmount: { toString: () => '50.00' },
    isAutoMarked: false,
    markedByUserId: null,
    markedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function ownerCtx(overrides: any = {}): any {
  return {
    role: 'owner',
    roleName: 'vendor_owner',
    vendorId: 1n,
    userId: 9n,
    staffId: 5n,
    permissions: [],
    ...overrides,
  };
}

function staffCtx(permissions: PermissionKey[] = []): any {
  return {
    role: 'staff',
    roleName: 'vendor_staff',
    vendorId: 1n,
    userId: 7n,
    staffId: 5n,
    permissions,
  };
}

function makeRepo(overrides: any = {}): any {
  return {
    findById: jest.fn(),
    getExtraChargesTotal: jest.fn().mockResolvedValue(0),
    listByListAndDate: jest.fn().mockResolvedValue([]),
    findMarkableIds: jest.fn().mockResolvedValue([]),
    findPendingIdsForDate: jest.fn().mockResolvedValue([]),
    findByIds: jest.fn().mockResolvedValue([]),
    applyMark: jest.fn().mockResolvedValue(undefined),
    insertGenerated: jest.fn().mockResolvedValue(0),
    findBySubscriptionInRange: jest.fn().mockResolvedValue([]),
    findOverridesFor: jest.fn().mockResolvedValue([]),
    insertExtraCharge: jest.fn().mockResolvedValue({ id: 99n, createdAt: new Date() }),
    findLeaveById: jest.fn(),
    insertLeave: jest.fn().mockResolvedValue({ id: 77n }),
    deleteLeave: jest.fn().mockResolvedValue(undefined),
    countCoveringLeaves: jest.fn().mockResolvedValue(0),
    hasLeaveCovering: jest.fn().mockResolvedValue(false),
    listLeaves: jest.fn().mockResolvedValue([]),
    transaction: jest.fn((fn: any) => fn({})),
    ...overrides,
  };
}

function makeReader(overrides: any = {}): any {
  return {
    getSupplyLists: jest.fn().mockResolvedValue([]),
    getSupplyList: jest.fn(),
    getAssignedListIds: jest.fn().mockResolvedValue([]),
    isAssignedToList: jest.fn().mockResolvedValue(false),
    resolveSubscriptions: jest.fn().mockResolvedValue([]),
    resolveSubscriptionsForLists: jest.fn().mockResolvedValue([]),
    getCustomerDisplay: jest.fn().mockResolvedValue(new Map()),
    getSubscriptionCustomers: jest.fn().mockResolvedValue(new Map()),
    getSubscriptionCustomerIds: jest.fn().mockResolvedValue(new Map()),
    getOtherListNames: jest.fn().mockResolvedValue(new Map()),
    getMarkerNames: jest.fn().mockResolvedValue(new Map()),
    getActiveSubscriptionsForGeneration: jest.fn().mockResolvedValue([]),
    getVendorIdsWithActiveSubscriptions: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
}

const meta = { ip: null, userAgent: null };

beforeEach(() => jest.clearAllMocks());

// ============================================================
// Domain: state machine & amounts
// ============================================================

describe('DailySupply domain', () => {
  it('computes baseAmount = quantity × rate on creation', () => {
    const e = DailySupplyEntity.create({
      vendorId: 1n,
      supplyListCustomerId: 50n,
      supplyListId: 20n,
      serviceDate: new Date('2026-04-12T00:00:00Z'),
      quantity: 2,
      unit: 'ltr',
      ratePerUnit: 50,
      onLeave: false,
    });
    expect(e.getProps().baseAmount).toBe(100);
    expect(e.getProps().finalAmount).toBe(100);
    expect(e.status).toBe('PENDING');
  });

  it('creates a LEAVE row with zero amount when onLeave', () => {
    const e = DailySupplyEntity.create({
      vendorId: 1n,
      supplyListCustomerId: 50n,
      supplyListId: 20n,
      serviceDate: new Date('2026-04-12T00:00:00Z'),
      quantity: 2,
      unit: 'ltr',
      ratePerUnit: 50,
      onLeave: true,
    });
    expect(e.status).toBe('LEAVE');
    expect(e.getProps().finalAmount).toBe(0);
  });

  it('markLeave zeroes finalAmount and appends an override', () => {
    const e = DailySupplyEntity.create({
      vendorId: 1n,
      supplyListCustomerId: 50n,
      supplyListId: 20n,
      serviceDate: new Date('2026-04-12T00:00:00Z'),
      quantity: 1,
      unit: 'ltr',
      ratePerUnit: 50,
      onLeave: false,
    });
    e.markLeave('VENDOR_OWNER', 9n);
    expect(e.status).toBe('LEAVE');
    expect(e.getProps().finalAmount).toBe(0);
    expect(e.consumePendingOverride()).toMatchObject({ newStatus: 'LEAVE' });
  });

  it('blocks an extra charge on a LEAVE supply', () => {
    const e = DailySupplyEntity.create({
      vendorId: 1n,
      supplyListCustomerId: 50n,
      supplyListId: 20n,
      serviceDate: new Date('2026-04-12T00:00:00Z'),
      quantity: 1,
      unit: 'ltr',
      ratePerUnit: 50,
      onLeave: true,
    });
    expect(() => e.addExtraCharge(20)).toThrow(ChargeOnNonDeliverableError);
  });

  it('rejects a zero extra-charge amount', () => {
    const e = DailySupplyEntity.create({
      vendorId: 1n,
      supplyListCustomerId: 50n,
      supplyListId: 20n,
      serviceDate: new Date('2026-04-12T00:00:00Z'),
      quantity: 1,
      unit: 'ltr',
      ratePerUnit: 50,
      onLeave: false,
    });
    expect(() => e.addExtraCharge(0)).toThrow();
  });

  it('forbids re-marking a CANCELLED row', () => {
    expect(() => DeliveryStatusVO.assertTransition('CANCELLED', 'DELIVERED')).toThrow(
      InvalidDeliveryTransitionError
    );
  });
});

// ============================================================
// Domain: conflict derivation
// ============================================================

describe('deriveConflict', () => {
  it('flags a conflict when customer marks after staff with a different status', () => {
    const result = deriveConflict([
      {
        actorRole: 'VENDOR_STAFF',
        newStatus: 'DELIVERED',
        createdAt: new Date('2026-04-12T06:00:00Z'),
      },
      { actorRole: 'CUSTOMER', newStatus: 'LEAVE', createdAt: new Date('2026-04-12T07:00:00Z') },
    ]);
    expect(result.hasConflict).toBe(true);
    expect(result.reason).toContain('customer');
  });

  it('resolves the conflict when the owner re-marks last', () => {
    const result = deriveConflict([
      { actorRole: 'CUSTOMER', newStatus: 'LEAVE', createdAt: new Date('2026-04-12T07:00:00Z') },
      {
        actorRole: 'VENDOR_OWNER',
        newStatus: 'DELIVERED',
        createdAt: new Date('2026-04-12T08:00:00Z'),
      },
    ]);
    expect(result.hasConflict).toBe(false);
  });

  it('no conflict without a customer override', () => {
    const result = deriveConflict([
      { actorRole: 'VENDOR_STAFF', newStatus: 'DELIVERED', createdAt: new Date() },
    ]);
    expect(result.hasConflict).toBe(false);
  });
});

// ============================================================
// shouldGenerateForDate
// ============================================================

describe('shouldGenerateForDate', () => {
  it('always generates for DAILY', () => {
    expect(shouldGenerateForDate('DAILY', [], new Date('2026-04-12T00:00:00Z'))).toBe(true);
  });

  it('generates WEEKLY only on configured ISO days', () => {
    // 2026-04-13 is a Monday → ISO day 1.
    expect(shouldGenerateForDate('WEEKLY', [1], new Date('2026-04-13T00:00:00Z'))).toBe(true);
    expect(shouldGenerateForDate('WEEKLY', [2], new Date('2026-04-13T00:00:00Z'))).toBe(false);
  });

  it('generates MONTHLY only on configured day-of-month', () => {
    expect(shouldGenerateForDate('MONTHLY', [12], new Date('2026-04-12T00:00:00Z'))).toBe(true);
    expect(shouldGenerateForDate('MONTHLY', [13], new Date('2026-04-12T00:00:00Z'))).toBe(false);
  });
});

// ============================================================
// Service: markDelivery
// ============================================================

describe('MarkDeliveryCommand', () => {
  it('404 when the delivery is missing / wrong tenant', async () => {
    const repo = makeRepo({ findById: jest.fn().mockResolvedValue(null) });
    const cmd = new MarkDeliveryCommand(repo, makeReader(), audit, logger);
    await expect(cmd.execute(ownerCtx(), 10n, { status: 'DELIVERED' }, meta)).rejects.toThrow(
      DeliveryNotFoundError
    );
  });

  it('owner marks delivered, persists, and audits', async () => {
    const repo = makeRepo({ findById: jest.fn().mockResolvedValue(dailyRecord()) });
    const reader = makeReader({
      getSubscriptionCustomerIds: jest.fn().mockResolvedValue(new Map([['50', 60n]])),
    });
    const cmd = new MarkDeliveryCommand(repo, reader, audit, logger);
    const result = await cmd.execute(ownerCtx(), 10n, { status: 'DELIVERED' }, meta);
    expect(repo.applyMark).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(result.delivery.status).toBe('DELIVERED');
    // Owner sees financials.
    expect(result.delivery.amount).toBe(50);
  });

  it('staff without the mark grant is forbidden', async () => {
    const repo = makeRepo({ findById: jest.fn().mockResolvedValue(dailyRecord()) });
    const reader = makeReader({ isAssignedToList: jest.fn().mockResolvedValue(true) });
    const cmd = new MarkDeliveryCommand(repo, reader, audit, logger);
    await expect(cmd.execute(staffCtx([]), 10n, { status: 'DELIVERED' }, meta)).rejects.toThrow(
      ForbiddenError
    );
  });

  it('staff not assigned to the list is masked as 404', async () => {
    const repo = makeRepo({ findById: jest.fn().mockResolvedValue(dailyRecord()) });
    const reader = makeReader({ isAssignedToList: jest.fn().mockResolvedValue(false) });
    const cmd = new MarkDeliveryCommand(repo, reader, audit, logger);
    await expect(
      cmd.execute(staffCtx([PermissionKey.MARK_DELIVERIES]), 10n, { status: 'DELIVERED' }, meta)
    ).rejects.toThrow(DeliveryNotFoundError);
  });

  it('staff with the grant on an assigned list succeeds (no financials)', async () => {
    const repo = makeRepo({ findById: jest.fn().mockResolvedValue(dailyRecord()) });
    const reader = makeReader({
      isAssignedToList: jest.fn().mockResolvedValue(true),
      getSubscriptionCustomerIds: jest.fn().mockResolvedValue(new Map([['50', 60n]])),
    });
    const cmd = new MarkDeliveryCommand(repo, reader, audit, logger);
    const result = await cmd.execute(
      staffCtx([PermissionKey.MARK_DELIVERIES]),
      10n,
      { status: 'DELIVERED' },
      meta
    );
    expect(result.delivery.status).toBe('DELIVERED');
    expect(result.delivery.amount).toBeUndefined();
    expect(result.delivery.ratePerUnit).toBeUndefined();
  });

  it('leave marking requires the mark_leaves grant', async () => {
    const repo = makeRepo({ findById: jest.fn().mockResolvedValue(dailyRecord()) });
    const reader = makeReader({ isAssignedToList: jest.fn().mockResolvedValue(true) });
    const cmd = new MarkDeliveryCommand(repo, reader, audit, logger);
    await expect(
      cmd.execute(staffCtx([PermissionKey.MARK_DELIVERIES]), 10n, { status: 'LEAVE' }, meta)
    ).rejects.toThrow(ForbiddenError);
  });
});

// ============================================================
// Service: addExtraCharge
// ============================================================

describe('AddExtraChargeCommand', () => {
  it('blocks a charge on a LEAVE supply (422)', async () => {
    const repo = makeRepo({
      findById: jest
        .fn()
        .mockResolvedValue(
          dailyRecord({ status: 'LEAVE', finalAmount: { toString: () => '0.00' } })
        ),
    });
    const cmd = new AddExtraChargeCommand(repo, makeReader(), audit, logger);
    await expect(
      cmd.execute(ownerCtx(), { dailySupplyId: 10n, amount: 20, comment: 'x' }, meta)
    ).rejects.toThrow(ChargeOnNonDeliverableError);
  });

  it('adds a charge and recomputes finalAmount', async () => {
    const repo = makeRepo({
      findById: jest.fn().mockResolvedValue(dailyRecord({ status: 'DELIVERED' })),
    });
    const cmd = new AddExtraChargeCommand(repo, makeReader(), audit, logger);
    const result = await cmd.execute(
      ownerCtx(),
      { dailySupplyId: 10n, amount: 20, comment: 'Extra milk' },
      meta
    );
    expect(repo.insertExtraCharge).toHaveBeenCalledWith(
      expect.objectContaining({ newFinalAmount: 70 })
    );
    expect(result.amount).toBe(20);
    expect(audit.log).toHaveBeenCalledTimes(1);
  });
});

// ============================================================
// Service: createLeave
// ============================================================

describe('CreateLeaveCommand', () => {
  it('422 when the customer has no active subscription', async () => {
    const reader = makeReader({ resolveSubscriptions: jest.fn().mockResolvedValue([]) });
    const cmd = new CreateLeaveCommand(makeRepo(), reader, audit, logger);
    await expect(
      cmd.execute(
        ownerCtx(),
        {
          customerId: 60n,
          supplyListIds: [20n],
          startDate: new Date('2026-04-15T00:00:00Z'),
          endDate: new Date('2026-04-17T00:00:00Z'),
          reason: null,
        },
        meta
      )
    ).rejects.toThrow(NoActiveSubscriptionError);
  });

  it('creates a leave per subscription and pre-marks in-range supplies', async () => {
    const reader = makeReader({
      resolveSubscriptions: jest
        .fn()
        .mockResolvedValue([{ subscriptionId: 50n, supplyListId: 20n }]),
    });
    const repo = makeRepo({
      findBySubscriptionInRange: jest
        .fn()
        .mockResolvedValue([dailyRecord({ id: 11n, status: 'PENDING' })]),
    });
    const cmd = new CreateLeaveCommand(repo, reader, audit, logger);
    const result = await cmd.execute(
      ownerCtx(),
      {
        customerId: 60n,
        supplyListIds: [20n],
        startDate: new Date('2026-04-12T00:00:00Z'),
        endDate: new Date('2026-04-12T00:00:00Z'),
        reason: 'Travel',
      },
      meta
    );
    expect(result.created).toBe(1);
    expect(result.affectedDeliveries).toBe(1);
    expect(repo.insertLeave).toHaveBeenCalledTimes(1);
    expect(repo.applyMark).toHaveBeenCalledTimes(1);
  });
});

// ============================================================
// Service: generate (idempotent fan-out)
// ============================================================

describe('GenerateDailySuppliesCommand.generateForVendor', () => {
  it('builds rows for daily subscriptions and reports generated/skipped', async () => {
    const reader = makeReader({
      getActiveSubscriptionsForGeneration: jest.fn().mockResolvedValue([
        {
          subscriptionId: 50n,
          vendorId: 1n,
          supplyListId: 20n,
          customerId: 60n,
          quantity: 1,
          unit: 'ltr',
          ratePerUnit: 50,
          frequency: 'DAILY',
          frequencyDays: [],
          startDate: null,
          endDate: null,
        },
      ]),
    });
    const repo = makeRepo({ insertGenerated: jest.fn().mockResolvedValue(1) });
    const cmd = new GenerateDailySuppliesCommand(repo, reader, audit, logger);
    const result = await cmd.generateForVendor(1n, new Date('2026-04-12T00:00:00Z'), 'corr');
    expect(result.generated).toBe(1);
    expect(repo.insertGenerated).toHaveBeenCalledTimes(1);
  });

  it('skips a subscription whose weekly schedule does not match', async () => {
    const reader = makeReader({
      getActiveSubscriptionsForGeneration: jest.fn().mockResolvedValue([
        {
          subscriptionId: 50n,
          vendorId: 1n,
          supplyListId: 20n,
          customerId: 60n,
          quantity: 1,
          unit: 'ltr',
          ratePerUnit: 50,
          frequency: 'WEEKLY',
          frequencyDays: [7], // Sunday only
          startDate: null,
          endDate: null,
        },
      ]),
    });
    const repo = makeRepo({ insertGenerated: jest.fn().mockResolvedValue(0) });
    const cmd = new GenerateDailySuppliesCommand(repo, reader, audit, logger);
    // 2026-04-13 is Monday.
    const result = await cmd.generateForVendor(1n, new Date('2026-04-13T00:00:00Z'), 'corr');
    expect(result.generated).toBe(0);
    expect(result.skipped).toBe(1);
  });
});

// ============================================================
// Service: getToday (query)
// ============================================================

describe('GetTodayDeliveriesQuery', () => {
  it('aggregates per-list counts and hides revenue for staff', async () => {
    const reader = makeReader({
      getAssignedListIds: jest.fn().mockResolvedValue([20n]),
      getSupplyLists: jest
        .fn()
        .mockResolvedValue([
          { id: 20n, name: 'Morning Milk', unit: 'ltr', startTime: '06:00', staff: [] },
        ]),
    });
    const repo = makeRepo({
      listByListAndDate: jest
        .fn()
        .mockResolvedValue([
          dailyRecord({ id: 1n, status: 'DELIVERED' }),
          dailyRecord({ id: 2n, status: 'PENDING' }),
        ]),
    });
    const query = new GetTodayDeliveriesQuery(repo, reader);
    const result = await query.execute(staffCtx([]), { date: '2026-04-12' });
    expect(result.summary.delivered).toBe(1);
    expect(result.summary.pending).toBe(1);
    expect(result.byList[0]!.revenue).toBeUndefined();
  });

  it('includes per-list revenue for owners', async () => {
    const reader = makeReader({
      getSupplyLists: jest
        .fn()
        .mockResolvedValue([
          { id: 20n, name: 'Morning Milk', unit: 'ltr', startTime: '06:00', staff: [] },
        ]),
    });
    const repo = makeRepo({
      listByListAndDate: jest
        .fn()
        .mockResolvedValue([dailyRecord({ id: 1n, status: 'DELIVERED' })]),
    });
    const query = new GetTodayDeliveriesQuery(repo, reader);
    const result = await query.execute(ownerCtx(), { date: '2026-04-12' });
    expect(result.byList[0]!.revenue).toBe('50.00');
  });
});

// ============================================================
// Domain: autoMarkDelivered (system sweep)
// ============================================================

describe('DailySupplyEntity.autoMarkDelivered', () => {
  function pending(): DailySupplyEntity {
    return DailySupplyEntity.create({
      vendorId: 1n,
      supplyListCustomerId: 50n,
      supplyListId: 20n,
      serviceDate: new Date('2026-04-12T00:00:00Z'),
      quantity: 2,
      unit: 'ltr',
      ratePerUnit: 50,
      onLeave: false,
    });
  }

  it('marks a PENDING supply DELIVERED with a SYSTEM override and isAutoMarked', () => {
    const e = pending();
    expect(e.autoMarkDelivered()).toBe(true);
    expect(e.status).toBe('DELIVERED');
    expect(e.getProps().isAutoMarked).toBe(true);
    expect(e.getProps().markedByUserId).toBeNull();
    expect(e.consumePendingOverride()).toMatchObject({
      actorRole: 'SYSTEM',
      newStatus: 'DELIVERED',
    });
  });

  it('is a no-op on a non-PENDING supply', () => {
    const e = pending();
    e.markLeave('VENDOR_OWNER', 9n);
    e.consumePendingOverride();
    expect(e.autoMarkDelivered()).toBe(false);
    expect(e.status).toBe('LEAVE');
  });
});

// ============================================================
// Command: AutoMarkSweepCommand (cron sweeps)
// ============================================================

describe('AutoMarkSweepCommand', () => {
  it('sweeps yesterday: marks every PENDING row DELIVERED via SYSTEM', async () => {
    const repo = makeRepo({
      findPendingIdsForDate: jest.fn().mockResolvedValue([10n, 11n]),
      findByIds: jest
        .fn()
        .mockResolvedValue([
          dailyRecord({ id: 10n, status: 'PENDING' }),
          dailyRecord({ id: 11n, status: 'PENDING' }),
        ]),
    });
    const cmd = new AutoMarkSweepCommand(repo, logger);
    const result = await cmd.sweepYesterday(new Date('2026-04-12T20:00:00Z'));
    expect(result.scanned).toBe(2);
    expect(result.marked).toBe(2);
    expect(repo.applyMark).toHaveBeenCalledTimes(2);
    // Yesterday relative to 2026-04-13 IST service date.
    expect(result.serviceDate).toBe('2026-04-12');
  });

  it('sweeps the morning window with a quantity filter', async () => {
    const repo = makeRepo({
      findPendingIdsForDate: jest.fn().mockResolvedValue([10n]),
      findByIds: jest.fn().mockResolvedValue([dailyRecord({ id: 10n, status: 'PENDING' })]),
    });
    const cmd = new AutoMarkSweepCommand(repo, logger);
    await cmd.sweepMorning(new Date('2026-04-12T04:00:00Z'));
    expect(repo.findPendingIdsForDate).toHaveBeenCalledWith(expect.any(Date), { minQuantity: 0 });
    expect(repo.applyMark).toHaveBeenCalledTimes(1);
  });

  it('does nothing when no PENDING rows match', async () => {
    const repo = makeRepo({ findPendingIdsForDate: jest.fn().mockResolvedValue([]) });
    const cmd = new AutoMarkSweepCommand(repo, logger);
    const result = await cmd.sweepYesterday();
    expect(result.marked).toBe(0);
    expect(repo.transaction).not.toHaveBeenCalled();
  });
});

describe('appYesterday', () => {
  it('returns the day before the app-timezone today', () => {
    // 2026-04-12T20:00:00Z → 2026-04-13 IST → yesterday = 2026-04-12.
    const d = appYesterday(new Date('2026-04-12T20:00:00Z'));
    expect(d.toISOString().slice(0, 10)).toBe('2026-04-12');
  });
});

// ============================================================
// appToday timezone helper
// ============================================================

describe('appToday', () => {
  it('returns a UTC-midnight date in Asia/Kolkata', () => {
    // 2026-04-11T20:00:00Z is 2026-04-12T01:30 IST → service date 2026-04-12.
    const d = appToday(new Date('2026-04-11T20:00:00Z'));
    expect(d.toISOString().slice(0, 10)).toBe('2026-04-12');
  });
});
