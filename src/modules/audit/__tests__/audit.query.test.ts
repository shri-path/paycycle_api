/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { RoleContext } from '@/infrastructure/middlewares/rbac/role-context';
import { ForbiddenError } from '@/common/errors/app-error';
import { AuditAction } from '@/common/audit/audit-action.enum';
import {
  actionLabel,
  roleLabel,
  buildAuditCsv,
  appToday,
  startOfWeek,
  startOfMonth,
} from '../audit.shared';
import {
  IAuditRepository,
  AuditLogRow,
  ConflictRow,
  StaffActionRow,
} from '../audit.repository.port';
import { AuditReader } from '../audit.reader';
import { ListAuditLogsQuery } from '../queries/list-audit-logs.query';
import { GetConflictsQuery } from '../queries/get-conflicts.query';
import { GetStaffSummaryQuery } from '../queries/get-staff-summary.query';
import { GetMyActivityQuery } from '../queries/get-my-activity.query';
import { ExportAuditLogsCommand } from '../commands/export-audit-logs.command';
import { AuditLogView } from '../audit.types';

function ownerCtx(overrides: Partial<RoleContext> = {}): RoleContext {
  return {
    role: 'owner',
    roleName: 'vendor_owner',
    vendorId: 10n,
    userId: 1n,
    staffId: 5n,
    permissions: [],
    ...overrides,
  };
}

function staffCtx(overrides: Partial<RoleContext> = {}): RoleContext {
  return {
    role: 'staff',
    roleName: 'vendor_staff',
    vendorId: 10n,
    userId: 2n,
    staffId: 6n,
    permissions: [],
    ...overrides,
  };
}

function makeRow(over: Partial<AuditLogRow> = {}): AuditLogRow {
  return {
    id: 100n,
    createdAt: new Date('2026-04-10T06:15:00.000Z'),
    action: AuditAction.DELIVERY_MARKED,
    entityType: 'daily_supply',
    entityId: 500n,
    performedByUserId: 2n,
    performedByRole: 'vendor_staff',
    metadata: { status: 'DELIVERED' },
    ipAddress: '203.0.113.9',
    ...over,
  };
}

function mockRepo(over: Partial<IAuditRepository> = {}): IAuditRepository {
  return {
    findLogs: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
    findForExport: jest.fn().mockResolvedValue([]),
    distinctStaff: jest.fn().mockResolvedValue([]),
    distinctActions: jest.fn().mockResolvedValue([]),
    findStaffActions: jest.fn().mockResolvedValue([]),
    findConflicts: jest.fn().mockResolvedValue([]),
    findMyActivity: jest.fn().mockResolvedValue([]),
    countMyActionsSince: jest.fn().mockResolvedValue(0),
    ...over,
  };
}

function mockReader(over: Partial<AuditReader> = {}): AuditReader {
  const reader = {
    getUserNames: jest.fn().mockResolvedValue(new Map()),
    getCustomerNames: jest.fn().mockResolvedValue(new Map()),
    getDeliveryRefs: jest.fn().mockResolvedValue(new Map()),
    getSupplyListNames: jest.fn().mockResolvedValue(new Map()),
    ...over,
  };
  return reader as unknown as AuditReader;
}

describe('audit.shared helpers', () => {
  it('maps known action slugs to labels', () => {
    expect(actionLabel(AuditAction.DELIVERY_MARKED)).toBe('Delivery Marked');
    expect(actionLabel(AuditAction.PAYMENT_MARKED)).toBe('Payment Recorded');
  });

  it('humanizes unknown action slugs', () => {
    expect(actionLabel('some_new_action')).toBe('Some New Action');
  });

  it('derives role labels (owner slug, staff slug, null=owner)', () => {
    expect(roleLabel('vendor_owner')).toBe('owner');
    expect(roleLabel('vendor_staff')).toBe('staff');
    expect(roleLabel(null)).toBe('owner');
  });

  it('builds RFC-4180 CSV with escaped quotes and header', () => {
    const rows: AuditLogView[] = [
      {
        id: '1',
        timestamp: '2026-04-10T06:15:00.000Z',
        actionType: 'delivery_marked',
        actionLabel: 'Delivery Marked',
        entityType: 'daily_supply',
        entityId: '5',
        user: { id: '2', name: 'Ra"ju', role: 'staff' },
        customer: { id: '9', name: 'Asha' },
        supplyList: { id: '3', name: 'Morning Milk' },
        details: { status: 'DELIVERED' },
      },
    ];
    const csv = buildAuditCsv(rows);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('"Timestamp","Action","User","Role","Customer","Supply List","Details"');
    expect(lines[1]).toContain('"Ra""ju"'); // doubled quote
    expect(lines[1]).toContain('"Delivery Marked"');
    expect(lines[1]).toContain('"{""status"":""DELIVERED""}"');
  });

  it('date boundary helpers return UTC-midnight dates ordered today>=week>=month', () => {
    const now = new Date('2026-04-15T10:00:00.000Z');
    const today = appToday(now);
    const week = startOfWeek(now);
    const month = startOfMonth(now);
    expect(today.getTime()).toBeGreaterThanOrEqual(week.getTime());
    expect(week.getTime()).toBeGreaterThanOrEqual(month.getTime());
    expect(month.toISOString()).toMatch(/2026-04-01T00:00:00/);
  });
});

describe('ListAuditLogsQuery', () => {
  it('returns enriched rows + facets for owner, including ipAddress', async () => {
    const repo = mockRepo({
      findLogs: jest.fn().mockResolvedValue({ rows: [makeRow()], total: 1 }),
      distinctStaff: jest.fn().mockResolvedValue([{ id: 2n, name: 'Raju' }]),
      distinctActions: jest.fn().mockResolvedValue(['delivery_marked']),
    });
    const reader = mockReader({
      getUserNames: jest.fn().mockResolvedValue(new Map([['2', 'Raju']])),
      getDeliveryRefs: jest
        .fn()
        .mockResolvedValue(
          new Map([
            [
              '500',
              { customerId: 9n, customerName: 'Asha', supplyListId: 3n, supplyListName: 'Milk' },
            ],
          ])
        ),
      getCustomerNames: jest.fn().mockResolvedValue(new Map([['9', 'Asha']])),
    });

    const result = await new ListAuditLogsQuery(repo, reader).execute(ownerCtx(), {});

    expect(result.auditLogs).toHaveLength(1);
    const view = result.auditLogs[0]!;
    expect(view.user).toEqual({ id: '2', name: 'Raju', role: 'staff' });
    expect(view.customer).toEqual({ id: '9', name: 'Asha' });
    expect(view.supplyList).toEqual({ id: '3', name: 'Milk' });
    expect(view.ipAddress).toBe('203.0.113.9');
    expect(result.pagination).toEqual({ page: 1, limit: 50, total: 1, totalPages: 1 });
    expect(result.filters.availableStaff).toEqual([{ id: '2', name: 'Raju' }]);
    expect(result.filters.availableActionTypes).toEqual(['delivery_marked']);
  });

  it('forces staff self-scope and omits ipAddress + staff facet', async () => {
    const findLogs = jest.fn().mockResolvedValue({ rows: [makeRow()], total: 1 });
    const distinctStaff = jest.fn().mockResolvedValue([{ id: 2n, name: 'Raju' }]);
    const repo = mockRepo({ findLogs, distinctStaff });
    const reader = mockReader({
      getDeliveryRefs: jest.fn().mockResolvedValue(new Map()),
    });

    // Staff supplies a foreign staffId — must be ignored and overwritten.
    const result = await new ListAuditLogsQuery(repo, reader).execute(staffCtx(), {
      staffId: 999n,
    });

    const whereArg = findLogs.mock.calls[0][0];
    expect(whereArg.performedByUserId).toBe(2n); // ctx.userId, not 999
    expect(result.auditLogs[0]!.ipAddress).toBeUndefined();
    expect(distinctStaff).not.toHaveBeenCalled();
    expect(result.filters.availableStaff).toEqual([]);
  });

  it('clamps limit to 100 and translates endDate to exclusive next-day bound', async () => {
    const findLogs = jest.fn().mockResolvedValue({ rows: [], total: 0 });
    const repo = mockRepo({ findLogs });
    await new ListAuditLogsQuery(repo, mockReader()).execute(ownerCtx(), {
      limit: 500,
      endDate: new Date('2026-04-30T00:00:00.000Z'),
    });
    const [, , limit] = findLogs.mock.calls[0];
    expect(limit).toBe(100);
    const where = findLogs.mock.calls[0][0];
    expect(where.createdToExclusive.toISOString()).toBe('2026-05-01T00:00:00.000Z');
  });
});

describe('GetConflictsQuery', () => {
  const conflictRow: ConflictRow = {
    dailySupplyId: 500n,
    serviceDate: new Date('2026-04-10T00:00:00.000Z'),
    supplyListId: 3n,
    supplyListCustomerId: 70n,
    customerId: 9n,
    status: 'DELIVERED',
    markedByUserId: 2n,
    markedAt: new Date('2026-04-10T06:15:00.000Z'),
    overrideStatus: 'LEAVE',
    overrideRole: 'CUSTOMER',
    overrideAt: new Date('2026-04-10T06:30:00.000Z'),
  };

  it('rejects staff callers with ForbiddenError', async () => {
    await expect(
      new GetConflictsQuery(mockRepo(), mockReader()).execute(staffCtx())
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('maps conflicts with by=customer and computed time diff', async () => {
    const repo = mockRepo({ findConflicts: jest.fn().mockResolvedValue([conflictRow]) });
    const reader = mockReader({
      getUserNames: jest.fn().mockResolvedValue(new Map([['2', 'Raju']])),
      getCustomerNames: jest.fn().mockResolvedValue(new Map([['9', 'Asha']])),
      getSupplyListNames: jest.fn().mockResolvedValue(new Map([['3', 'Milk']])),
    });

    const { conflicts } = await new GetConflictsQuery(repo, reader).execute(ownerCtx());

    expect(conflicts).toHaveLength(1);
    const c = conflicts[0]!;
    expect(c.deliveryDate).toBe('2026-04-10');
    expect(c.staffAction.status).toBe('DELIVERED');
    expect(c.staffAction.staff).toEqual({ id: '2', name: 'Raju' });
    expect(c.overrideAction.by).toBe('customer');
    expect(c.overrideAction.status).toBe('LEAVE');
    expect(c.overrideAction.timeDiffMinutes).toBe(15);
  });

  it('maps owner overrides to by=owner', async () => {
    const repo = mockRepo({
      findConflicts: jest
        .fn()
        .mockResolvedValue([{ ...conflictRow, overrideRole: 'VENDOR_OWNER' }]),
    });
    const { conflicts } = await new GetConflictsQuery(repo, mockReader()).execute(ownerCtx());
    expect(conflicts[0]!.overrideAction.by).toBe('owner');
  });
});

describe('GetStaffSummaryQuery', () => {
  it('rejects staff callers', async () => {
    await expect(
      new GetStaffSummaryQuery(mockRepo(), mockReader()).execute(staffCtx(), {})
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('aggregates by action type and date, computes totals and averages', async () => {
    const actions: StaffActionRow[] = [
      {
        performedByUserId: 2n,
        action: 'delivery_marked',
        createdAt: new Date('2026-04-10T06:00:00Z'),
      },
      {
        performedByUserId: 2n,
        action: 'delivery_marked',
        createdAt: new Date('2026-04-10T07:00:00Z'),
      },
      {
        performedByUserId: 2n,
        action: 'leave_marked',
        createdAt: new Date('2026-04-11T06:00:00Z'),
      },
    ];
    const repo = mockRepo({ findStaffActions: jest.fn().mockResolvedValue(actions) });
    const reader = mockReader({
      getUserNames: jest.fn().mockResolvedValue(new Map([['2', 'Raju']])),
    });

    const { summary } = await new GetStaffSummaryQuery(repo, reader).execute(ownerCtx(), {});

    expect(summary).toHaveLength(1);
    const s = summary[0]!;
    expect(s.staffId).toBe('2');
    expect(s.staffName).toBe('Raju');
    expect(s.totalActions).toBe(3);
    expect(s.activeDays).toBe(2);
    expect(s.avgActionsPerDay).toBe(2); // round(3/2)
    const delivered = s.byActionType.find((a) => a.actionType === 'delivery_marked')!;
    expect(delivered.count).toBe(2);
    expect(delivered.actionLabel).toBe('Delivery Marked');
    expect(s.byDate).toHaveLength(2);
  });
});

describe('GetMyActivityQuery', () => {
  it('returns self activity with today/week/month counts', async () => {
    const repo = mockRepo({
      findMyActivity: jest.fn().mockResolvedValue([makeRow({ performedByUserId: 2n })]),
      countMyActionsSince: jest
        .fn()
        .mockResolvedValueOnce(1)
        .mockResolvedValueOnce(4)
        .mockResolvedValueOnce(12),
    });
    const reader = mockReader({
      getDeliveryRefs: jest
        .fn()
        .mockResolvedValue(
          new Map([
            [
              '500',
              { customerId: 9n, customerName: 'Asha', supplyListId: 3n, supplyListName: 'Milk' },
            ],
          ])
        ),
      getCustomerNames: jest.fn().mockResolvedValue(new Map([['9', 'Asha']])),
    });

    const result = await new GetMyActivityQuery(repo, reader).execute(staffCtx());

    expect(result.activity).toHaveLength(1);
    expect(result.activity[0]!.supplyList).toEqual({ id: '3', name: 'Milk' });
    expect(result.summary).toEqual({ todayActions: 1, thisWeekActions: 4, thisMonthActions: 12 });

    // my-activity must be scoped to the caller's own userId.
    const callArgs = (repo.findMyActivity as jest.Mock).mock.calls[0];
    expect(callArgs[0]).toBe(10n); // vendorId
    expect(callArgs[1]).toBe(2n); // ctx.userId
  });
});

describe('ExportAuditLogsCommand', () => {
  it('rejects staff callers', async () => {
    await expect(
      new ExportAuditLogsCommand(mockRepo(), mockReader()).execute(staffCtx(), {})
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('produces a CSV with a vendor-stamped filename', async () => {
    const repo = mockRepo({
      findForExport: jest.fn().mockResolvedValue([makeRow({ performedByUserId: 2n })]),
    });
    const reader = mockReader({
      getUserNames: jest.fn().mockResolvedValue(new Map([['2', 'Raju']])),
      getDeliveryRefs: jest
        .fn()
        .mockResolvedValue(
          new Map([
            [
              '500',
              { customerId: 9n, customerName: 'Asha', supplyListId: 3n, supplyListName: 'Milk' },
            ],
          ])
        ),
      getCustomerNames: jest.fn().mockResolvedValue(new Map([['9', 'Asha']])),
    });

    const result = await new ExportAuditLogsCommand(repo, reader).execute(ownerCtx(), {});

    expect(result.filename).toMatch(/^audit-logs-10-\d+\.csv$/);
    expect(result.csv).toContain('"Delivery Marked"');
    expect(result.csv).toContain('"Raju"');
    expect(result.csv).toContain('"Milk"');
  });
});
