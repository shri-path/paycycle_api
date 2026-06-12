/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { shouldGenerateForDate, appToday, appYesterday, dayStatus } from '../delivery.shared';
import { MarkDeliveryCommand } from '../commands/mark-delivery.command';
import { AddExtraChargeCommand } from '../commands/add-extra-charge.command';
import { CreateLeaveCommand } from '../commands/create-leave.command';
import { CancelLeaveCommand } from '../commands/cancel-leave.command';
import { MarkBulkDeliveryCommand } from '../commands/mark-bulk-delivery.command';
import { GenerateDailySuppliesCommand } from '../commands/generate-daily-supplies.command';
import { AutoMarkSweepCommand } from '../commands/auto-mark-sweep.command';
import { GetTodayDeliveriesQuery } from '../queries/get-today-deliveries.query';
import { ListLeavesQuery } from '../queries/list-leaves.query';
import { GetCalendarQuery } from '../queries/get-calendar.query';
import { GetDateDetailQuery } from '../queries/get-date-detail.query';
import {
  DailySupplyEntity,
  DeliveryNotFoundError,
  LeaveNotFoundError,
  ChargeOnNonDeliverableError,
  NoActiveSubscriptionError,
  InvalidDeliveryTransitionError,
  deriveConflict,
  DeliveryStatusVO,
  ServiceDate,
  DateRange,
  DeliveryQuantity,
  RateMoney,
  LeaveEntity,
  DailySupplyMapper,
} from '../delivery.domain';
import {
  markDeliverySchema,
  markBulkSchema,
  addExtraChargeSchema,
  createLeaveSchema,
  generateSchema,
} from '../delivery.validator';
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
    getSubscriptionById: jest.fn().mockResolvedValue(null),
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
    // BUG-1: CANCELLED is terminal — even a same-status re-mark must throw.
    expect(() => DeliveryStatusVO.assertTransition('CANCELLED', 'CANCELLED')).toThrow(
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

// ============================================================
// Domain invariants — revertToPending
// ============================================================

describe('DailySupplyEntity.revertToPending', () => {
  function makeLeaveEntity(): DailySupplyEntity {
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
    return e;
  }

  it('successfully reverts a LEAVE supply to PENDING', () => {
    const e = makeLeaveEntity();
    e.revertToPending('VENDOR_OWNER', 9n);
    expect(e.status).toBe('PENDING');
    expect(e.getProps().markedByUserId).toBeNull();
    expect(e.getProps().markedAt).toBeNull();
  });

  it('restores finalAmount = baseAmount after revert (no extra charges)', () => {
    const e = makeLeaveEntity();
    e.revertToPending('VENDOR_OWNER', 9n);
    const props = e.getProps();
    expect(props.finalAmount).toBe(props.baseAmount);
  });

  it('appends an override with newStatus=PENDING and comment="Leave cancelled"', () => {
    const e = makeLeaveEntity();
    e.revertToPending('VENDOR_STAFF', 7n);
    const override = e.consumePendingOverride();
    expect(override).toMatchObject({
      previousStatus: 'LEAVE',
      newStatus: 'PENDING',
      actorRole: 'VENDOR_STAFF',
      changedByUserId: 7n,
      comment: 'Leave cancelled',
    });
  });

  it('throws InvalidDeliveryTransitionError when supply is DELIVERED (not LEAVE)', () => {
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
    e.markDelivered('VENDOR_OWNER', 9n);
    expect(() => e.revertToPending('VENDOR_OWNER', 9n)).toThrow(InvalidDeliveryTransitionError);
  });

  it('throws InvalidDeliveryTransitionError when supply is PENDING (not LEAVE)', () => {
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
    expect(() => e.revertToPending('VENDOR_OWNER', 9n)).toThrow(InvalidDeliveryTransitionError);
  });

  it('throws InvalidDeliveryTransitionError when supply is CANCELLED', () => {
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
    e.cancel('VENDOR_OWNER', 9n);
    expect(() => e.revertToPending('VENDOR_OWNER', 9n)).toThrow(InvalidDeliveryTransitionError);
  });
});

// ============================================================
// Domain invariants — cancel()
// ============================================================

describe('DailySupplyEntity.cancel', () => {
  it('transitions PENDING → CANCELLED and zeroes finalAmount', () => {
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
    e.cancel('VENDOR_OWNER', 9n);
    expect(e.status).toBe('CANCELLED');
    expect(e.getProps().finalAmount).toBe(0);
  });

  it('transitions DELIVERED → CANCELLED', () => {
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
    e.markDelivered('VENDOR_OWNER', 9n);
    e.consumePendingOverride();
    e.cancel('VENDOR_OWNER', 9n);
    expect(e.status).toBe('CANCELLED');
  });

  it('transitions LEAVE → CANCELLED', () => {
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
    e.cancel('VENDOR_OWNER', 9n);
    expect(e.status).toBe('CANCELLED');
  });

  it('BUG-1: CANCELLED → CANCELLED throws (terminal state cannot be re-marked)', () => {
    // Per FEATURE_PLAN.md §3: "terminal CANCELLED cannot be re-marked".
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
    e.cancel('VENDOR_OWNER', 9n);
    e.consumePendingOverride();
    // Re-cancelling a terminal CANCELLED row must throw, not silently no-op.
    expect(() => e.cancel('VENDOR_OWNER', 9n)).toThrow(InvalidDeliveryTransitionError);
    // Status is unchanged.
    expect(e.status).toBe('CANCELLED');
  });

  it('appends an override row on cancel', () => {
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
    e.cancel('VENDOR_OWNER', 9n);
    const override = e.consumePendingOverride();
    expect(override).toMatchObject({ newStatus: 'CANCELLED', actorRole: 'VENDOR_OWNER' });
  });
});

// ============================================================
// Domain invariants — markDelivered with quantity override
// ============================================================

describe('DailySupplyEntity.markDelivered with quantity override', () => {
  it('updates baseAmount when a quantity override is provided', () => {
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
    e.markDelivered('VENDOR_OWNER', 9n, 2); // override qty to 2
    const props = e.getProps();
    expect(props.quantity).toBe(2);
    expect(props.baseAmount).toBe(100); // 2 × 50
    expect(props.finalAmount).toBe(100);
  });

  it('records previous and new quantity in the override', () => {
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
    e.markDelivered('VENDOR_OWNER', 9n, 3);
    const override = e.consumePendingOverride();
    expect(override?.previousQuantity).toBe(1);
    expect(override?.newQuantity).toBe(3);
  });

  it('recomputes finalAmount to include existing extra charges after qty override', () => {
    // simulate existing extra charges by reconstituting with extraChargesTotal = 10
    const reconstituted = DailySupplyEntity.reconstitute({
      id: 10n,
      createdAt: new Date(),
      updatedAt: new Date(),
      props: {
        vendorId: 1n,
        supplyListCustomerId: 50n,
        supplyListId: 20n,
        serviceDate: new Date('2026-04-12T00:00:00Z'),
        status: 'PENDING' as any,
        quantity: 1,
        unit: 'ltr',
        ratePerUnit: 50,
        baseAmount: 50,
        finalAmount: 60,
        isAutoMarked: false,
        markedByUserId: null,
        markedAt: null,
        extraChargesTotal: 10,
      },
    });
    reconstituted.markDelivered('VENDOR_OWNER', 9n, 2);
    const props = reconstituted.getProps();
    expect(props.baseAmount).toBe(100); // 2 × 50
    expect(props.finalAmount).toBe(110); // 100 + 10 extra charges
  });

  it('blocks marking a CANCELLED row as DELIVERED', () => {
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
    e.cancel('VENDOR_OWNER', 9n);
    e.consumePendingOverride();
    expect(() => e.markDelivered('VENDOR_OWNER', 9n)).toThrow(InvalidDeliveryTransitionError);
  });
});

// ============================================================
// Value object: ServiceDate.fromIso validation
// ============================================================

describe('ServiceDate.fromIso', () => {
  it('parses a valid YYYY-MM-DD string', () => {
    const sd = ServiceDate.fromIso('2026-04-12');
    expect(sd.toIso()).toBe('2026-04-12');
  });

  it('rejects a non-date string', () => {
    expect(() => ServiceDate.fromIso('not-a-date')).toThrow();
  });

  it('rejects a string that is not YYYY-MM-DD format', () => {
    expect(() => ServiceDate.fromIso('12/04/2026')).toThrow();
  });

  it('rejects February 30 (calendar overflow)', () => {
    expect(() => ServiceDate.fromIso('2026-02-30')).toThrow();
  });

  it('rejects month 13', () => {
    expect(() => ServiceDate.fromIso('2026-13-01')).toThrow();
  });

  it('rejects an empty string', () => {
    expect(() => ServiceDate.fromIso('')).toThrow();
  });
});

// ============================================================
// Value object: DateRange.create validation
// ============================================================

describe('DateRange.create', () => {
  it('creates a valid range where startDate < endDate', () => {
    const range = DateRange.create(
      new Date('2026-04-10T00:00:00Z'),
      new Date('2026-04-15T00:00:00Z')
    );
    expect(range.startDate.toIso()).toBe('2026-04-10');
    expect(range.endDate.toIso()).toBe('2026-04-15');
  });

  it('creates a valid single-day range (startDate === endDate)', () => {
    const range = DateRange.create(
      new Date('2026-04-12T00:00:00Z'),
      new Date('2026-04-12T00:00:00Z')
    );
    expect(range.startDate.toIso()).toBe(range.endDate.toIso());
  });

  it('throws when endDate is before startDate', () => {
    expect(() =>
      DateRange.create(new Date('2026-04-15T00:00:00Z'), new Date('2026-04-10T00:00:00Z'))
    ).toThrow();
  });

  it('contains() returns true for a date inside the range', () => {
    const range = DateRange.create(
      new Date('2026-04-10T00:00:00Z'),
      new Date('2026-04-15T00:00:00Z')
    );
    const mid = ServiceDate.fromIso('2026-04-12');
    expect(range.contains(mid)).toBe(true);
  });

  it('contains() returns true for start boundary', () => {
    const range = DateRange.create(
      new Date('2026-04-10T00:00:00Z'),
      new Date('2026-04-15T00:00:00Z')
    );
    expect(range.contains(ServiceDate.fromIso('2026-04-10'))).toBe(true);
  });

  it('contains() returns true for end boundary', () => {
    const range = DateRange.create(
      new Date('2026-04-10T00:00:00Z'),
      new Date('2026-04-15T00:00:00Z')
    );
    expect(range.contains(ServiceDate.fromIso('2026-04-15'))).toBe(true);
  });

  it('contains() returns false for a date outside the range', () => {
    const range = DateRange.create(
      new Date('2026-04-10T00:00:00Z'),
      new Date('2026-04-15T00:00:00Z')
    );
    expect(range.contains(ServiceDate.fromIso('2026-04-16'))).toBe(false);
  });
});

// ============================================================
// Value object: DeliveryQuantity
// ============================================================

describe('DeliveryQuantity', () => {
  it('creates a valid non-negative quantity', () => {
    expect(DeliveryQuantity.create(1.5).value).toBe(1.5);
  });

  it('allows zero quantity', () => {
    expect(DeliveryQuantity.create(0).value).toBe(0);
  });

  it('rejects negative quantity', () => {
    expect(() => DeliveryQuantity.create(-1)).toThrow();
  });

  it('rejects Infinity', () => {
    expect(() => DeliveryQuantity.create(Infinity)).toThrow();
  });

  it('rounds to 3 decimal places', () => {
    expect(DeliveryQuantity.create(1.0005).value).toBe(1.001);
  });
});

// ============================================================
// Value object: RateMoney
// ============================================================

describe('RateMoney', () => {
  it('creates a valid non-negative rate', () => {
    expect(RateMoney.create(50).amount).toBe(50);
  });

  it('allows zero rate', () => {
    expect(RateMoney.create(0).amount).toBe(0);
  });

  it('rejects negative rate', () => {
    expect(() => RateMoney.create(-1)).toThrow();
  });

  it('rejects NaN', () => {
    expect(() => RateMoney.create(NaN)).toThrow();
  });
});

// ============================================================
// Domain: deriveConflict edge cases
// ============================================================

describe('deriveConflict edge cases', () => {
  it('no conflict when both customer and vendor have the same status', () => {
    const result = deriveConflict([
      {
        actorRole: 'VENDOR_STAFF',
        newStatus: 'DELIVERED',
        createdAt: new Date('2026-04-12T06:00:00Z'),
      },
      {
        actorRole: 'CUSTOMER',
        newStatus: 'DELIVERED',
        createdAt: new Date('2026-04-12T07:00:00Z'),
      },
    ]);
    expect(result.hasConflict).toBe(false);
  });

  it('no conflict when vendor override is more recent than customer', () => {
    // Vendor re-marks after customer: conflict is resolved
    const result = deriveConflict([
      { actorRole: 'CUSTOMER', newStatus: 'LEAVE', createdAt: new Date('2026-04-12T07:00:00Z') },
      {
        actorRole: 'VENDOR_STAFF',
        newStatus: 'DELIVERED',
        createdAt: new Date('2026-04-12T08:00:00Z'),
      },
    ]);
    expect(result.hasConflict).toBe(false);
  });

  it('no conflict when only SYSTEM overrides exist (no customer override)', () => {
    const result = deriveConflict([
      { actorRole: 'SYSTEM', newStatus: 'DELIVERED', createdAt: new Date() },
    ]);
    expect(result.hasConflict).toBe(false);
  });

  it('no conflict with empty override history', () => {
    const result = deriveConflict([]);
    expect(result.hasConflict).toBe(false);
    expect(result.reason).toBeNull();
  });

  it('conflict reason contains both statuses', () => {
    const result = deriveConflict([
      {
        actorRole: 'VENDOR_STAFF',
        newStatus: 'DELIVERED',
        createdAt: new Date('2026-04-12T06:00:00Z'),
      },
      { actorRole: 'CUSTOMER', newStatus: 'LEAVE', createdAt: new Date('2026-04-12T07:00:00Z') },
    ]);
    expect(result.reason).toContain('delivered');
    expect(result.reason).toContain('leave');
  });

  it('VENDOR_OWNER override resolves a conflict (owner is vendor side)', () => {
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
});

// ============================================================
// Command: MarkDeliveryCommand edge cases
// ============================================================

describe('MarkDeliveryCommand additional edge cases', () => {
  it('throws InvalidDeliveryTransitionError when marking a CANCELLED delivery', async () => {
    const repo = makeRepo({
      findById: jest.fn().mockResolvedValue(dailyRecord({ status: 'CANCELLED' })),
    });
    const reader = makeReader({ isAssignedToList: jest.fn().mockResolvedValue(true) });
    const cmd = new MarkDeliveryCommand(repo, reader, audit, logger);
    await expect(cmd.execute(ownerCtx(), 10n, { status: 'DELIVERED' }, meta)).rejects.toThrow(
      InvalidDeliveryTransitionError
    );
  });

  it('owner can mark a LEAVE row as DELIVERED (valid transition)', async () => {
    const repo = makeRepo({
      findById: jest
        .fn()
        .mockResolvedValue(
          dailyRecord({ status: 'LEAVE', finalAmount: { toString: () => '0.00' } })
        ),
      getSubscriptionCustomerIds: jest.fn().mockResolvedValue(new Map()),
    });
    const reader = makeReader({
      getSubscriptionCustomerIds: jest.fn().mockResolvedValue(new Map([['50', 60n]])),
    });
    const cmd = new MarkDeliveryCommand(repo, reader, audit, logger);
    const result = await cmd.execute(ownerCtx(), 10n, { status: 'DELIVERED' }, meta);
    expect(result.delivery.status).toBe('DELIVERED');
    expect(repo.applyMark).toHaveBeenCalledTimes(1);
  });

  it('owner can mark an AUTO_MARKED row as LEAVE (correction)', async () => {
    const repo = makeRepo({
      findById: jest
        .fn()
        .mockResolvedValue(dailyRecord({ status: 'AUTO_MARKED', isAutoMarked: true })),
    });
    const reader = makeReader({
      getSubscriptionCustomerIds: jest.fn().mockResolvedValue(new Map([['50', 60n]])),
    });
    const cmd = new MarkDeliveryCommand(repo, reader, audit, logger);
    const result = await cmd.execute(ownerCtx(), 10n, { status: 'LEAVE' }, meta);
    expect(result.delivery.status).toBe('LEAVE');
  });

  it('staff with MARK_LEAVES grant can mark leave on an assigned list', async () => {
    const repo = makeRepo({
      findById: jest.fn().mockResolvedValue(dailyRecord()),
    });
    const reader = makeReader({
      isAssignedToList: jest.fn().mockResolvedValue(true),
      getSubscriptionCustomerIds: jest.fn().mockResolvedValue(new Map([['50', 60n]])),
    });
    const cmd = new MarkDeliveryCommand(repo, reader, audit, logger);
    const result = await cmd.execute(
      staffCtx([PermissionKey.MARK_LEAVES]),
      10n,
      { status: 'LEAVE' },
      meta
    );
    expect(result.delivery.status).toBe('LEAVE');
  });
});

// ============================================================
// Command: MarkBulkDeliveryCommand edge cases
// ============================================================

describe('MarkBulkDeliveryCommand', () => {
  it('marks all pending when exclude list is empty', async () => {
    const repo = makeRepo({
      findMarkableIds: jest.fn().mockResolvedValue([10n, 11n, 12n]),
      findById: jest
        .fn()
        .mockImplementation((id: bigint) =>
          Promise.resolve(dailyRecord({ id, status: 'PENDING' }))
        ),
    });
    const reader = makeReader({ isAssignedToList: jest.fn().mockResolvedValue(true) });
    const cmd = new MarkBulkDeliveryCommand(repo, reader, audit, logger);
    const result = await cmd.execute(
      ownerCtx(),
      { supplyListId: 20n, date: new Date('2026-04-12T00:00:00Z'), excludeDeliveryIds: [] },
      meta
    );
    expect(result.updated).toBe(3);
    expect(result.excluded).toBe(0);
  });

  it('excluded count equals the excludeDeliveryIds length, not the skip count', async () => {
    const repo = makeRepo({
      findMarkableIds: jest.fn().mockResolvedValue([10n]),
      findById: jest.fn().mockResolvedValue(dailyRecord({ id: 10n, status: 'PENDING' })),
    });
    const reader = makeReader({ isAssignedToList: jest.fn().mockResolvedValue(true) });
    const cmd = new MarkBulkDeliveryCommand(repo, reader, audit, logger);
    const result = await cmd.execute(
      ownerCtx(),
      { supplyListId: 20n, date: new Date('2026-04-12T00:00:00Z'), excludeDeliveryIds: [11n, 12n] },
      meta
    );
    expect(result.updated).toBe(1);
    expect(result.excluded).toBe(2);
  });

  it('staff without mark_deliveries grant is forbidden', async () => {
    const repo = makeRepo();
    const reader = makeReader({ isAssignedToList: jest.fn().mockResolvedValue(true) });
    const cmd = new MarkBulkDeliveryCommand(repo, reader, audit, logger);
    await expect(
      cmd.execute(
        staffCtx([]),
        { supplyListId: 20n, date: new Date('2026-04-12T00:00:00Z'), excludeDeliveryIds: [] },
        meta
      )
    ).rejects.toThrow(ForbiddenError);
  });

  it('staff not assigned to the list is masked as 404', async () => {
    const repo = makeRepo();
    const reader = makeReader({ isAssignedToList: jest.fn().mockResolvedValue(false) });
    const cmd = new MarkBulkDeliveryCommand(repo, reader, audit, logger);
    await expect(
      cmd.execute(
        staffCtx([PermissionKey.MARK_DELIVERIES]),
        { supplyListId: 20n, date: new Date('2026-04-12T00:00:00Z'), excludeDeliveryIds: [] },
        meta
      )
    ).rejects.toThrow(DeliveryNotFoundError);
  });

  it('does nothing and returns updated=0 when no pending rows match', async () => {
    const repo = makeRepo({ findMarkableIds: jest.fn().mockResolvedValue([]) });
    const reader = makeReader({ isAssignedToList: jest.fn().mockResolvedValue(true) });
    const cmd = new MarkBulkDeliveryCommand(repo, reader, audit, logger);
    const result = await cmd.execute(
      ownerCtx(),
      { supplyListId: 20n, date: new Date('2026-04-12T00:00:00Z'), excludeDeliveryIds: [] },
      meta
    );
    expect(result.updated).toBe(0);
    expect(repo.applyMark).not.toHaveBeenCalled();
  });
});

// ============================================================
// Command: AddExtraChargeCommand additional edge cases
// ============================================================

describe('AddExtraChargeCommand additional edge cases', () => {
  it('blocks a charge on a CANCELLED supply', async () => {
    const repo = makeRepo({
      findById: jest
        .fn()
        .mockResolvedValue(
          dailyRecord({ status: 'CANCELLED', finalAmount: { toString: () => '0.00' } })
        ),
    });
    const cmd = new AddExtraChargeCommand(repo, makeReader(), audit, logger);
    await expect(
      cmd.execute(ownerCtx(), { dailySupplyId: 10n, amount: 20, comment: 'x' }, meta)
    ).rejects.toThrow(ChargeOnNonDeliverableError);
  });

  it('accepts a negative amount (discount)', async () => {
    const repo = makeRepo({
      findById: jest.fn().mockResolvedValue(dailyRecord({ status: 'DELIVERED' })),
    });
    const cmd = new AddExtraChargeCommand(repo, makeReader(), audit, logger);
    const result = await cmd.execute(
      ownerCtx(),
      { dailySupplyId: 10n, amount: -5, comment: 'Discount applied' },
      meta
    );
    expect(result.amount).toBe(-5);
  });

  it('correctly computes new final amount (existing total + new charge)', async () => {
    const repo = makeRepo({
      findById: jest.fn().mockResolvedValue(dailyRecord({ status: 'DELIVERED' })),
      getExtraChargesTotal: jest.fn().mockResolvedValue(10), // existing charges
    });
    const cmd = new AddExtraChargeCommand(repo, makeReader(), audit, logger);
    await cmd.execute(ownerCtx(), { dailySupplyId: 10n, amount: 20, comment: 'Extra milk' }, meta);
    // 50 (base) + 10 (existing) + 20 (new) = 80
    expect(repo.insertExtraCharge).toHaveBeenCalledWith(
      expect.objectContaining({ newFinalAmount: 80 })
    );
  });

  it('returns 404 when daily supply not found for tenant', async () => {
    const repo = makeRepo({ findById: jest.fn().mockResolvedValue(null) });
    const cmd = new AddExtraChargeCommand(repo, makeReader(), audit, logger);
    await expect(
      cmd.execute(ownerCtx(), { dailySupplyId: 99n, amount: 10, comment: 'x' }, meta)
    ).rejects.toThrow(DeliveryNotFoundError);
  });
});

// ============================================================
// Command: CreateLeaveCommand additional edge cases
// ============================================================

describe('CreateLeaveCommand additional edge cases', () => {
  it('creates multiple leaves for multiple supply lists', async () => {
    const reader = makeReader({
      resolveSubscriptions: jest.fn().mockResolvedValue([
        { subscriptionId: 50n, supplyListId: 20n },
        { subscriptionId: 51n, supplyListId: 21n },
      ]),
    });
    const cmd = new CreateLeaveCommand(makeRepo(), reader, audit, logger);
    const result = await cmd.execute(
      ownerCtx(),
      {
        customerId: 60n,
        supplyListIds: [20n, 21n],
        startDate: new Date('2026-04-15T00:00:00Z'),
        endDate: new Date('2026-04-17T00:00:00Z'),
        reason: 'Vacation',
      },
      meta
    );
    expect(result.created).toBe(2);
    expect(result.leaves).toHaveLength(2);
  });

  it('skips LEAVE supplies (no double-marking) when pre-marking in range', async () => {
    const reader = makeReader({
      resolveSubscriptions: jest
        .fn()
        .mockResolvedValue([{ subscriptionId: 50n, supplyListId: 20n }]),
    });
    const repo = makeRepo({
      findBySubscriptionInRange: jest
        .fn()
        .mockResolvedValue([
          dailyRecord({ id: 11n, status: 'LEAVE', finalAmount: { toString: () => '0.00' } }),
          dailyRecord({ id: 12n, status: 'CANCELLED', finalAmount: { toString: () => '0.00' } }),
        ]),
    });
    const cmd = new CreateLeaveCommand(repo, reader, audit, logger);
    const result = await cmd.execute(
      ownerCtx(),
      {
        customerId: 60n,
        supplyListIds: [20n],
        startDate: new Date('2026-04-15T00:00:00Z'),
        endDate: new Date('2026-04-17T00:00:00Z'),
        reason: null,
      },
      meta
    );
    expect(result.affectedDeliveries).toBe(0);
    expect(repo.applyMark).not.toHaveBeenCalled();
  });

  it('uses VENDOR_MARKED leaveType when created by owner', async () => {
    const reader = makeReader({
      resolveSubscriptions: jest
        .fn()
        .mockResolvedValue([{ subscriptionId: 50n, supplyListId: 20n }]),
    });
    const repo = makeRepo();
    const cmd = new CreateLeaveCommand(repo, reader, audit, logger);
    await cmd.execute(
      ownerCtx(),
      {
        customerId: 60n,
        supplyListIds: [20n],
        startDate: new Date('2026-04-15T00:00:00Z'),
        endDate: new Date('2026-04-17T00:00:00Z'),
        reason: null,
      },
      meta
    );
    expect(repo.insertLeave).toHaveBeenCalledTimes(1);
    const insertedLeave: LeaveEntity = (repo.insertLeave as jest.Mock).mock.calls[0][0];
    expect(insertedLeave.getProps().leaveType).toBe('VENDOR_MARKED');
  });
});

// ============================================================
// Command: CancelLeaveCommand
// ============================================================

describe('CancelLeaveCommand', () => {
  // Use dates well into the future (2030) so tests pass regardless of when they run
  const futureLeave = {
    id: 77n,
    supplyListCustomerId: 50n,
    startDate: new Date('2030-04-15T00:00:00Z'),
    endDate: new Date('2030-04-20T00:00:00Z'),
    leaveType: 'VENDOR_MARKED' as const,
    reason: null,
    createdByUserId: 9n,
    createdAt: new Date('2030-04-10T00:00:00Z'),
  };

  it('returns 404 when leave does not exist for the tenant', async () => {
    const repo = makeRepo({ findLeaveById: jest.fn().mockResolvedValue(null) });
    const cmd = new CancelLeaveCommand(repo, makeReader(), audit, logger);
    await expect(cmd.execute(ownerCtx(), 77n, meta)).rejects.toThrow(LeaveNotFoundError);
  });

  it('returns 404 (masked) when subscriptionInfo is not found (no supply rows)', async () => {
    const repo = makeRepo({ findLeaveById: jest.fn().mockResolvedValue(futureLeave) });
    const reader = makeReader({ getSubscriptionById: jest.fn().mockResolvedValue(null) });
    const cmd = new CancelLeaveCommand(repo, reader, audit, logger);
    await expect(cmd.execute(ownerCtx(), 77n, meta)).rejects.toThrow(LeaveNotFoundError);
  });

  it('throws LeaveNotFoundError for a past leave (endDate < today)', async () => {
    const pastLeave = {
      ...futureLeave,
      startDate: new Date('2020-01-01T00:00:00Z'),
      endDate: new Date('2020-01-05T00:00:00Z'),
    };
    const repo = makeRepo({ findLeaveById: jest.fn().mockResolvedValue(pastLeave) });
    const reader = makeReader({
      getSubscriptionById: jest.fn().mockResolvedValue({ supplyListId: 20n }),
    });
    const cmd = new CancelLeaveCommand(repo, reader, audit, logger);
    await expect(cmd.execute(ownerCtx(), 77n, meta)).rejects.toThrow(LeaveNotFoundError);
  });

  it('deletes the leave and reverts in-range LEAVE supplies to PENDING', async () => {
    const repo = makeRepo({
      findLeaveById: jest.fn().mockResolvedValue(futureLeave),
      findBySubscriptionInRange: jest.fn().mockResolvedValue([
        // A future LEAVE supply that is not covered by another leave
        {
          ...dailyRecord({ id: 11n, status: 'LEAVE', finalAmount: { toString: () => '0.00' } }),
          serviceDate: new Date('2030-04-16T00:00:00Z'),
        },
      ]),
      countCoveringLeaves: jest.fn().mockResolvedValue(0),
    });
    const reader = makeReader({
      getSubscriptionById: jest.fn().mockResolvedValue({ supplyListId: 20n }),
    });
    const cmd = new CancelLeaveCommand(repo, reader, audit, logger);
    const result = await cmd.execute(ownerCtx(), 77n, meta);
    expect(repo.deleteLeave).toHaveBeenCalledWith(77n, expect.anything());
    expect(repo.applyMark).toHaveBeenCalledTimes(1);
    expect(result.revertedDeliveries).toBe(1);
  });

  it('does not revert when another leave still covers the date', async () => {
    const repo = makeRepo({
      findLeaveById: jest.fn().mockResolvedValue(futureLeave),
      findBySubscriptionInRange: jest.fn().mockResolvedValue([
        {
          ...dailyRecord({ id: 11n, status: 'LEAVE', finalAmount: { toString: () => '0.00' } }),
          serviceDate: new Date('2030-04-16T00:00:00Z'),
        },
      ]),
      countCoveringLeaves: jest.fn().mockResolvedValue(1), // still covered by another leave
    });
    const reader = makeReader({
      getSubscriptionById: jest.fn().mockResolvedValue({ supplyListId: 20n }),
    });
    const cmd = new CancelLeaveCommand(repo, reader, audit, logger);
    const result = await cmd.execute(ownerCtx(), 77n, meta);
    expect(result.revertedDeliveries).toBe(0);
    expect(repo.applyMark).not.toHaveBeenCalled();
  });

  it('staff without mark_leaves grant is forbidden', async () => {
    const repo = makeRepo({ findLeaveById: jest.fn().mockResolvedValue(futureLeave) });
    const reader = makeReader({
      getSubscriptionById: jest.fn().mockResolvedValue({ supplyListId: 20n }),
      isAssignedToList: jest.fn().mockResolvedValue(true),
    });
    const cmd = new CancelLeaveCommand(repo, reader, audit, logger);
    await expect(cmd.execute(staffCtx([]), 77n, meta)).rejects.toThrow(ForbiddenError);
  });
});

// ============================================================
// Command: GenerateDailySuppliesCommand additional edge cases
// ============================================================

describe('GenerateDailySuppliesCommand additional edge cases', () => {
  it('generates a LEAVE row when an open leave covers the date', async () => {
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
    const repo = makeRepo({
      hasLeaveCovering: jest.fn().mockResolvedValue(true),
      insertGenerated: jest.fn().mockResolvedValue(1),
    });
    const cmd = new GenerateDailySuppliesCommand(repo, reader, audit, logger);
    await cmd.generateForVendor(1n, new Date('2026-04-12T00:00:00Z'), 'corr');
    const insertArgs = (repo.insertGenerated as jest.Mock).mock.calls[0][0];
    expect(insertArgs[0].status).toBe('LEAVE');
    expect(insertArgs[0].finalAmount).toBe(0);
  });

  it('counts previously-existing rows (skipDuplicates) as skipped', async () => {
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
    const repo = makeRepo({
      insertGenerated: jest.fn().mockResolvedValue(0), // already exists
    });
    const cmd = new GenerateDailySuppliesCommand(repo, reader, audit, logger);
    const result = await cmd.generateForVendor(1n, new Date('2026-04-12T00:00:00Z'), 'corr');
    expect(result.generated).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('handles empty active subscriptions gracefully', async () => {
    const reader = makeReader({
      getActiveSubscriptionsForGeneration: jest.fn().mockResolvedValue([]),
    });
    const repo = makeRepo({ insertGenerated: jest.fn().mockResolvedValue(0) });
    const cmd = new GenerateDailySuppliesCommand(repo, reader, audit, logger);
    const result = await cmd.generateForVendor(1n, new Date('2026-04-12T00:00:00Z'), 'corr');
    expect(result.generated).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it('skips MONTHLY subscriptions on a non-matching day-of-month', async () => {
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
          frequency: 'MONTHLY',
          frequencyDays: [1], // only on 1st of month
          startDate: null,
          endDate: null,
        },
      ]),
    });
    const repo = makeRepo({ insertGenerated: jest.fn().mockResolvedValue(0) });
    const cmd = new GenerateDailySuppliesCommand(repo, reader, audit, logger);
    // 2026-04-12 → day 12, not day 1
    const result = await cmd.generateForVendor(1n, new Date('2026-04-12T00:00:00Z'), 'corr');
    expect(result.generated).toBe(0);
    expect(result.skipped).toBe(1);
    expect(repo.insertGenerated).toHaveBeenCalledWith([]);
  });
});

// ============================================================
// Command: AutoMarkSweepCommand additional edge cases
// ============================================================

describe('AutoMarkSweepCommand additional edge cases', () => {
  it('sweepYesterday includes zero-quantity PENDING rows (no minQuantity filter)', async () => {
    const repo = makeRepo({
      findPendingIdsForDate: jest.fn().mockResolvedValue([10n]),
      findByIds: jest.fn().mockResolvedValue([
        dailyRecord({
          id: 10n,
          status: 'PENDING',
          quantity: { toString: () => '0.000' },
          baseAmount: { toString: () => '0.00' },
          finalAmount: { toString: () => '0.00' },
        }),
      ]),
    });
    const cmd = new AutoMarkSweepCommand(repo, logger);
    // sweepYesterday should NOT pass minQuantity
    await cmd.sweepYesterday(new Date('2026-04-12T20:00:00Z'));
    expect(repo.findPendingIdsForDate).toHaveBeenCalledWith(expect.any(Date), {});
  });

  it('sweepMorning passes minQuantity: 0 filter', async () => {
    const repo = makeRepo({
      findPendingIdsForDate: jest.fn().mockResolvedValue([]),
    });
    const cmd = new AutoMarkSweepCommand(repo, logger);
    await cmd.sweepMorning(new Date('2026-04-12T04:00:00Z'));
    expect(repo.findPendingIdsForDate).toHaveBeenCalledWith(expect.any(Date), { minQuantity: 0 });
  });

  it('non-PENDING rows are skipped by autoMarkDelivered (no-op returns false)', async () => {
    const repo = makeRepo({
      findPendingIdsForDate: jest.fn().mockResolvedValue([10n]),
      findByIds: jest.fn().mockResolvedValue([
        dailyRecord({ id: 10n, status: 'DELIVERED' }), // already delivered
      ]),
    });
    const cmd = new AutoMarkSweepCommand(repo, logger);
    const result = await cmd.sweepYesterday();
    expect(result.scanned).toBe(1);
    expect(result.marked).toBe(0);
    expect(repo.applyMark).not.toHaveBeenCalled();
  });

  it('reports correct serviceDate ISO string', async () => {
    const repo = makeRepo({
      findPendingIdsForDate: jest.fn().mockResolvedValue([]),
    });
    const cmd = new AutoMarkSweepCommand(repo, logger);
    // 2026-04-12T20:00:00Z → IST 2026-04-13 → yesterday = 2026-04-12
    const result = await cmd.sweepYesterday(new Date('2026-04-12T20:00:00Z'));
    expect(result.serviceDate).toBe('2026-04-12');
  });
});

// ============================================================
// Query: GetTodayDeliveriesQuery additional edge cases
// ============================================================

describe('GetTodayDeliveriesQuery additional edge cases', () => {
  it('returns empty result when no lists are assigned to staff', async () => {
    const reader = makeReader({
      getAssignedListIds: jest.fn().mockResolvedValue([]),
      getSupplyLists: jest.fn().mockResolvedValue([]),
    });
    const repo = makeRepo();
    const query = new GetTodayDeliveriesQuery(repo, reader);
    const result = await query.execute(staffCtx([]), {});
    expect(result.summary.totalDeliveries).toBe(0);
    expect(result.byList).toHaveLength(0);
  });

  it('returns summary.revenue as string in 2dp format', async () => {
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
    expect(result.summary.revenue).toMatch(/^\d+\.\d{2}$/);
  });

  it('counts autoMarked deliveries separately in summary', async () => {
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
        .mockResolvedValue([dailyRecord({ id: 1n, status: 'AUTO_MARKED', isAutoMarked: true })]),
    });
    const query = new GetTodayDeliveriesQuery(repo, reader);
    const result = await query.execute(ownerCtx(), { date: '2026-04-12' });
    expect(result.summary.autoMarked).toBe(1);
    // AUTO_MARKED also counts toward delivered
    expect(result.summary.delivered).toBe(1);
  });

  it('reports conflict count in summary', async () => {
    const reader = makeReader({
      getSupplyLists: jest
        .fn()
        .mockResolvedValue([
          { id: 20n, name: 'Morning Milk', unit: 'ltr', startTime: '06:00', staff: [] },
        ]),
      getSubscriptionCustomers: jest
        .fn()
        .mockResolvedValue(new Map([['50', { name: 'Anil Kumar', listName: 'Morning Milk' }]])),
    });
    const repo = makeRepo({
      listByListAndDate: jest
        .fn()
        .mockResolvedValue([dailyRecord({ id: 1n, status: 'DELIVERED' })]),
      findOverridesFor: jest.fn().mockResolvedValue([
        {
          dailySupplyId: 1n,
          actorRole: 'VENDOR_STAFF',
          newStatus: 'DELIVERED',
          changedByUserId: 7n,
          createdAt: new Date('2026-04-12T06:00:00Z'),
        },
        {
          dailySupplyId: 1n,
          actorRole: 'CUSTOMER',
          newStatus: 'LEAVE',
          changedByUserId: null,
          createdAt: new Date('2026-04-12T07:00:00Z'),
        },
      ]),
    });
    const query = new GetTodayDeliveriesQuery(repo, reader);
    const result = await query.execute(ownerCtx(), { date: '2026-04-12' });
    expect(result.summary.conflicts).toBe(1);
    expect(result.conflicts).toHaveLength(1);
  });
});

// ============================================================
// Query: ListLeavesQuery
// ============================================================

describe('ListLeavesQuery', () => {
  it('returns empty lists when no leaves exist', async () => {
    const repo = makeRepo({ listLeaves: jest.fn().mockResolvedValue([]) });
    const reader = makeReader();
    const query = new ListLeavesQuery(repo, reader);
    const result = await query.execute(ownerCtx(), {});
    expect(result.today).toHaveLength(0);
    expect(result.upcoming).toHaveLength(0);
  });

  it('separates today leaves from upcoming leaves correctly', async () => {
    const today = appToday();
    const tomorrow = new Date(today.getTime() + 86_400_000);
    const dayAfter = new Date(today.getTime() + 2 * 86_400_000);
    const repo = makeRepo({
      listLeaves: jest.fn().mockResolvedValue([
        {
          id: 1n,
          supplyListCustomerId: 50n,
          startDate: today,
          endDate: today,
          leaveType: 'VENDOR_MARKED',
          reason: null,
          createdByUserId: 9n,
          createdAt: new Date(),
        },
        {
          id: 2n,
          supplyListCustomerId: 50n,
          startDate: tomorrow,
          endDate: dayAfter,
          leaveType: 'VENDOR_MARKED',
          reason: null,
          createdByUserId: 9n,
          createdAt: new Date(),
        },
      ]),
      getSubscriptionCustomers: jest.fn().mockResolvedValue(new Map()),
    });
    const reader = makeReader({
      getSubscriptionCustomers: jest
        .fn()
        .mockResolvedValue(new Map([['50', { name: 'Test Customer', listName: 'Morning Milk' }]])),
    });
    const query = new ListLeavesQuery(repo, reader);
    const result = await query.execute(ownerCtx(), {});
    expect(result.today).toHaveLength(1);
    expect(result.upcoming).toHaveLength(1);
  });

  it('filters staff to assigned lists only', async () => {
    const repo = makeRepo({ listLeaves: jest.fn().mockResolvedValue([]) });
    const reader = makeReader({
      getAssignedListIds: jest.fn().mockResolvedValue([20n]),
      resolveSubscriptionsForLists: jest.fn().mockResolvedValue([50n]),
    });
    const query = new ListLeavesQuery(repo, reader);
    await query.execute(staffCtx([]), {});
    expect(reader.getAssignedListIds).toHaveBeenCalledWith(5n); // staffId from staffCtx
    expect(repo.listLeaves).toHaveBeenCalledWith(
      expect.any(BigInt),
      expect.objectContaining({ supplyListCustomerIds: [50n] })
    );
  });

  it('upcoming filter omits today leaves', async () => {
    const today = appToday();
    const repo = makeRepo({
      listLeaves: jest.fn().mockResolvedValue([
        {
          id: 1n,
          supplyListCustomerId: 50n,
          startDate: today,
          endDate: today,
          leaveType: 'VENDOR_MARKED',
          reason: null,
          createdByUserId: 9n,
          createdAt: new Date(),
        },
      ]),
    });
    const reader = makeReader({
      getSubscriptionCustomers: jest.fn().mockResolvedValue(new Map()),
    });
    const query = new ListLeavesQuery(repo, reader);
    const result = await query.execute(ownerCtx(), { status: 'upcoming' });
    expect(result.today).toHaveLength(0);
    expect(result.upcoming).toHaveLength(0);
  });
});

// ============================================================
// Query: GetCalendarQuery
// ============================================================

describe('GetCalendarQuery', () => {
  it('returns empty days when no records exist for the month', async () => {
    const reader = makeReader({
      getSupplyLists: jest
        .fn()
        .mockResolvedValue([
          { id: 20n, name: 'Morning Milk', unit: 'ltr', startTime: '06:00', staff: [] },
        ]),
    });
    const repo = makeRepo({
      listByListAndDate: jest.fn().mockResolvedValue([]),
    });
    const query = new GetCalendarQuery(repo, reader);
    const result = await query.execute(ownerCtx(), { month: '2026-04' });
    expect(Object.keys(result.days)).toHaveLength(0);
    expect(result.summary.totalDeliveries).toBe(0);
    expect(result.summary.revenue).toBe('0.00');
  });

  it('returns days with counts and revenue for a month with records', async () => {
    const reader = makeReader({
      getSupplyLists: jest
        .fn()
        .mockResolvedValue([
          { id: 20n, name: 'Morning Milk', unit: 'ltr', startTime: '06:00', staff: [] },
        ]),
    });
    const repo = makeRepo({
      listByListAndDate: jest.fn().mockImplementation((_vendorId, _listId, dayDate: Date) => {
        // Only return records for April 12
        if (dayDate.getUTCDate() === 12) {
          return Promise.resolve([dailyRecord({ id: 1n, status: 'DELIVERED' })]);
        }
        return Promise.resolve([]);
      }),
    });
    const query = new GetCalendarQuery(repo, reader);
    const result = await query.execute(ownerCtx(), { month: '2026-04' });
    expect(result.days['2026-04-12']).toBeDefined();
    expect(result.days['2026-04-12']?.status).toBe('completed');
    expect(result.days['2026-04-12']?.delivered).toBe(1);
  });

  it('day status precedence: has_conflicts > pending > has_leaves > completed', () => {
    expect(dayStatus(1, 0, 0)).toBe('has_conflicts');
    expect(dayStatus(0, 1, 0)).toBe('pending');
    expect(dayStatus(0, 0, 1)).toBe('has_leaves');
    expect(dayStatus(0, 0, 0)).toBe('completed');
  });

  it('GetCalendarQuery: non-owner gets ForbiddenError', async () => {
    // BUG-5: owner-only financial view must be guarded at the service layer.
    const query = new GetCalendarQuery(makeRepo(), makeReader());
    await expect(query.execute(staffCtx(), { month: '2026-04' })).rejects.toThrow(ForbiddenError);
  });

  it('GetDateDetailQuery: non-owner gets ForbiddenError', async () => {
    // BUG-5: owner-only financial view must be guarded at the service layer.
    const query = new GetDateDetailQuery(makeRepo(), makeReader());
    await expect(query.execute(staffCtx(), '2026-04-12')).rejects.toThrow(ForbiddenError);
  });
});

// ============================================================
// Validation schemas (Zod)
// ============================================================

describe('markDeliverySchema validation', () => {
  it('accepts valid DELIVERED status', () => {
    expect(() => markDeliverySchema.parse({ status: 'DELIVERED' })).not.toThrow();
  });

  it('accepts valid LEAVE status', () => {
    expect(() => markDeliverySchema.parse({ status: 'LEAVE' })).not.toThrow();
  });

  it('rejects invalid status value', () => {
    expect(() => markDeliverySchema.parse({ status: 'PENDING' })).toThrow();
  });

  it('rejects unknown fields (strict mode)', () => {
    expect(() => markDeliverySchema.parse({ status: 'DELIVERED', markedByUserId: '9' })).toThrow();
  });

  it('accepts optional quantity when non-negative', () => {
    expect(() => markDeliverySchema.parse({ status: 'DELIVERED', quantity: 1.5 })).not.toThrow();
  });

  it('accepts quantity of zero', () => {
    expect(() => markDeliverySchema.parse({ status: 'DELIVERED', quantity: 0 })).not.toThrow();
  });

  it('rejects negative quantity', () => {
    expect(() => markDeliverySchema.parse({ status: 'DELIVERED', quantity: -1 })).toThrow();
  });
});

describe('addExtraChargeSchema validation', () => {
  it('accepts valid charge', () => {
    expect(() =>
      addExtraChargeSchema.parse({ dailySupplyId: '10', amount: 20, comment: 'Extra milk' })
    ).not.toThrow();
  });

  it('rejects zero amount', () => {
    expect(() =>
      addExtraChargeSchema.parse({ dailySupplyId: '10', amount: 0, comment: 'x' })
    ).toThrow();
  });

  it('rejects sub-penny amount (0.001)', () => {
    expect(() =>
      addExtraChargeSchema.parse({ dailySupplyId: '10', amount: 0.001, comment: 'x' })
    ).toThrow();
  });

  it('accepts negative amount (discount)', () => {
    expect(() =>
      addExtraChargeSchema.parse({ dailySupplyId: '10', amount: -5, comment: 'Discount' })
    ).not.toThrow();
  });

  it('rejects empty comment', () => {
    expect(() =>
      addExtraChargeSchema.parse({ dailySupplyId: '10', amount: 10, comment: '' })
    ).toThrow();
  });

  it('rejects whitespace-only comment', () => {
    expect(() =>
      addExtraChargeSchema.parse({ dailySupplyId: '10', amount: 10, comment: '   ' })
    ).toThrow();
  });

  it('rejects unknown fields (strict mode)', () => {
    expect(() =>
      addExtraChargeSchema.parse({ dailySupplyId: '10', amount: 10, comment: 'x', extra: 'field' })
    ).toThrow();
  });
});

describe('createLeaveSchema validation', () => {
  it('accepts valid leave input', () => {
    expect(() =>
      createLeaveSchema.parse({
        customerId: '60',
        supplyListIds: ['20'],
        startDate: '2026-04-15',
        endDate: '2026-04-17',
      })
    ).not.toThrow();
  });

  it('rejects endDate before startDate', () => {
    expect(() =>
      createLeaveSchema.parse({
        customerId: '60',
        supplyListIds: ['20'],
        startDate: '2026-04-17',
        endDate: '2026-04-15',
      })
    ).toThrow();
  });

  it('accepts same startDate and endDate (single day)', () => {
    expect(() =>
      createLeaveSchema.parse({
        customerId: '60',
        supplyListIds: ['20'],
        startDate: '2026-04-15',
        endDate: '2026-04-15',
      })
    ).not.toThrow();
  });

  it('rejects empty supplyListIds array', () => {
    expect(() =>
      createLeaveSchema.parse({
        customerId: '60',
        supplyListIds: [],
        startDate: '2026-04-15',
        endDate: '2026-04-17',
      })
    ).toThrow();
  });

  it('rejects missing required fields', () => {
    expect(() => createLeaveSchema.parse({ customerId: '60', supplyListIds: ['20'] })).toThrow();
  });

  it('rejects unknown fields (strict mode)', () => {
    expect(() =>
      createLeaveSchema.parse({
        customerId: '60',
        supplyListIds: ['20'],
        startDate: '2026-04-15',
        endDate: '2026-04-17',
        unknownField: 'bad',
      })
    ).toThrow();
  });
});

describe('markBulkSchema validation', () => {
  it('accepts valid bulk mark input', () => {
    expect(() =>
      markBulkSchema.parse({ supplyListId: '20', date: '2026-04-12', status: 'DELIVERED' })
    ).not.toThrow();
  });

  it('rejects status other than DELIVERED', () => {
    expect(() =>
      markBulkSchema.parse({ supplyListId: '20', date: '2026-04-12', status: 'LEAVE' })
    ).toThrow();
  });

  it('accepts optional excludeDeliveryIds', () => {
    expect(() =>
      markBulkSchema.parse({
        supplyListId: '20',
        date: '2026-04-12',
        status: 'DELIVERED',
        excludeDeliveryIds: ['10', '11'],
      })
    ).not.toThrow();
  });

  it('rejects unknown fields (strict mode)', () => {
    expect(() =>
      markBulkSchema.parse({
        supplyListId: '20',
        date: '2026-04-12',
        status: 'DELIVERED',
        extra: 'bad',
      })
    ).toThrow();
  });
});

describe('generateSchema validation', () => {
  it('accepts empty object (optional date)', () => {
    expect(() => generateSchema.parse({})).not.toThrow();
  });

  it('accepts a valid date', () => {
    expect(() => generateSchema.parse({ date: '2026-04-12' })).not.toThrow();
  });

  it('rejects an invalid date format', () => {
    expect(() => generateSchema.parse({ date: 'not-a-date' })).toThrow();
  });

  it('rejects unknown fields (strict mode)', () => {
    expect(() => generateSchema.parse({ date: '2026-04-12', extra: 'bad' })).toThrow();
  });
});

// ============================================================
// DailySupplyMapper.toResponse whitelist
// ============================================================

describe('DailySupplyMapper.toResponse whitelist', () => {
  function makeEntity() {
    return DailySupplyEntity.create({
      vendorId: 1n,
      supplyListCustomerId: 50n,
      supplyListId: 20n,
      serviceDate: new Date('2026-04-12T00:00:00Z'),
      quantity: 1,
      unit: 'ltr',
      ratePerUnit: 50,
      onLeave: false,
    });
  }

  const baseOptions = {
    customer: {
      id: 60n,
      name: 'Test Customer',
      address: 'Test Address',
      phoneNumber: '1234567890',
    },
    marker: null,
    conflict: { hasConflict: false, reason: null },
    otherLists: [],
    includeFinancials: false,
  };

  it('serializes id as a string', () => {
    const e = DailySupplyEntity.reconstitute({
      id: 10n,
      createdAt: new Date(),
      updatedAt: new Date(),
      props: {
        vendorId: 1n,
        supplyListCustomerId: 50n,
        supplyListId: 20n,
        serviceDate: new Date('2026-04-12T00:00:00Z'),
        status: 'PENDING' as any,
        quantity: 1,
        unit: 'ltr',
        ratePerUnit: 50,
        baseAmount: 50,
        finalAmount: 50,
        isAutoMarked: false,
        markedByUserId: null,
        markedAt: null,
        extraChargesTotal: 0,
      },
    });
    const dto = DailySupplyMapper.toResponse(e, baseOptions);
    expect(typeof dto.id).toBe('string');
    expect(dto.id).toBe('10');
  });

  it('serializes customer.id as a string', () => {
    const dto = DailySupplyMapper.toResponse(makeEntity(), baseOptions);
    expect(typeof dto.customer.id).toBe('string');
    expect(dto.customer.id).toBe('60');
  });

  it('omits ratePerUnit and amount for staff (includeFinancials=false)', () => {
    const dto = DailySupplyMapper.toResponse(makeEntity(), {
      ...baseOptions,
      includeFinancials: false,
    });
    expect(dto.ratePerUnit).toBeUndefined();
    expect(dto.amount).toBeUndefined();
  });

  it('includes ratePerUnit and amount for owners (includeFinancials=true)', () => {
    const dto = DailySupplyMapper.toResponse(makeEntity(), {
      ...baseOptions,
      includeFinancials: true,
    });
    expect(dto.ratePerUnit).toBeDefined();
    expect(dto.amount).toBeDefined();
  });

  it('hasConflict is present in all responses', () => {
    const dto = DailySupplyMapper.toResponse(makeEntity(), baseOptions);
    expect(dto.hasConflict).toBe(false);
  });

  it('markedAt is null when supply has not been marked', () => {
    const dto = DailySupplyMapper.toResponse(makeEntity(), baseOptions);
    expect(dto.markedAt).toBeNull();
  });

  it('markedAt is ISO 8601 string after marking', () => {
    const e = makeEntity();
    e.markDelivered('VENDOR_OWNER', 9n);
    const dto = DailySupplyMapper.toResponse(e, { ...baseOptions, includeFinancials: true });
    expect(dto.markedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
