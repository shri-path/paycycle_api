/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { SupplyFrequency } from '../domain/supply-list.types';
import { CreateSupplyListService } from '../commands/create-supply-list/create-supply-list.service';
import { ArchiveSupplyListService } from '../commands/archive-supply-list/archive-supply-list.service';
import { AssignStaffService } from '../commands/assign-staff/assign-staff.service';
import { AddCustomersService } from '../commands/add-customers/add-customers.service';
import { GetSupplyListService } from '../queries/get-supply-list/get-supply-list.service';
import {
  AllCustomersAlreadySubscribedError,
  CustomerNotInVendorError,
  DuplicateListNameError,
  StaffNotAssignableError,
  SupplyListNotFoundError,
} from '../domain/supply-list.errors';

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as any;
const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
const deliveryStats = {
  getTodayStats: jest.fn().mockResolvedValue({
    date: '2025-01-01',
    delivered: 0,
    onLeave: 0,
    pending: 0,
    totalQuantity: 0,
  }),
  getMonthStats: jest
    .fn()
    .mockResolvedValue({ month: '2025-01', daysCompleted: 0, totalQuantity: 0, revenue: 0 }),
} as any;

function listRecord(overrides: any = {}): any {
  return {
    id: 100n,
    vendorId: 1n,
    name: 'Morning Milk',
    supplyType: 'Milk',
    unit: 'ltr',
    defaultQuantity: { toString: () => '1.000' },
    ratePerUnit: { toString: () => '60.00' },
    startTime: '06:30',
    frequency: SupplyFrequency.DAILY,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    staff: [],
    schedule: [],
    ...overrides,
  };
}

const baseCreateDto = {
  vendorId: 1n,
  actorUserId: 9n,
  actorRole: 'vendor_owner',
  name: 'Morning Milk',
  supplyType: 'Milk',
  unit: 'ltr',
  defaultQuantity: 1,
  defaultRatePerUnit: 60,
  startTime: '06:30',
  frequency: SupplyFrequency.DAILY,
  frequencyDays: [],
  staffIds: [] as bigint[],
  primaryStaffId: null,
  ip: null,
  userAgent: null,
};

describe('CreateSupplyListService', () => {
  it('rejects a duplicate active name (409)', async () => {
    const repo = {
      findActiveByName: jest.fn().mockResolvedValue(listRecord()),
    } as any;
    const staffDir = { findActiveMembership: jest.fn() } as any;
    const svc = new CreateSupplyListService(repo, staffDir, deliveryStats, audit, logger);
    await expect(svc.execute(baseCreateDto)).rejects.toBeInstanceOf(DuplicateListNameError);
  });

  it('rejects a non-active staff member (422)', async () => {
    const repo = {
      findActiveByName: jest.fn().mockResolvedValue(null),
    } as any;
    const staffDir = { findActiveMembership: jest.fn().mockResolvedValue(null) } as any;
    const svc = new CreateSupplyListService(repo, staffDir, deliveryStats, audit, logger);
    await expect(svc.execute({ ...baseCreateDto, staffIds: [10n] })).rejects.toBeInstanceOf(
      StaffNotAssignableError
    );
  });

  it('creates and returns a DTO on the happy path', async () => {
    const repo = {
      findActiveByName: jest.fn().mockResolvedValue(null),
      insert: jest.fn().mockResolvedValue(listRecord()),
      assignedStaffFor: jest.fn().mockResolvedValue(new Map()),
    } as any;
    const staffDir = { findActiveMembership: jest.fn() } as any;
    const svc = new CreateSupplyListService(repo, staffDir, deliveryStats, audit, logger);
    const dto = await svc.execute(baseCreateDto);
    expect(dto.id).toBe('100');
    expect(audit.log).toHaveBeenCalled();
  });
});

describe('ArchiveSupplyListService', () => {
  it('masks a wrong-tenant list as 404', async () => {
    const repo = { findById: jest.fn().mockResolvedValue(null) } as any;
    const svc = new ArchiveSupplyListService(repo, audit, logger);
    await expect(
      svc.execute({
        vendorId: 1n,
        listId: 100n,
        actorUserId: 9n,
        actorRole: 'o',
        ip: null,
        userAgent: null,
      })
    ).rejects.toBeInstanceOf(SupplyListNotFoundError);
  });

  it('archives an existing list', async () => {
    const repo = {
      findById: jest.fn().mockResolvedValue(listRecord()),
      archive: jest.fn().mockResolvedValue(undefined),
    } as any;
    const svc = new ArchiveSupplyListService(repo, audit, logger);
    const res = await svc.execute({
      vendorId: 1n,
      listId: 100n,
      actorUserId: 9n,
      actorRole: 'o',
      ip: null,
      userAgent: null,
    });
    expect(res.status).toBe('archived');
    expect(repo.archive).toHaveBeenCalledWith(100n);
  });
});

describe('AssignStaffService', () => {
  it('rejects a disabled staff member (422)', async () => {
    const repo = { findById: jest.fn().mockResolvedValue(listRecord()) } as any;
    const staffDir = { findActiveMembership: jest.fn().mockResolvedValue(null) } as any;
    const svc = new AssignStaffService(repo, staffDir, deliveryStats, audit, logger);
    await expect(
      svc.execute({
        vendorId: 1n,
        listId: 100n,
        staffId: 10n,
        isPrimary: false,
        actorUserId: 9n,
        actorRole: 'o',
        ip: null,
        userAgent: null,
      })
    ).rejects.toBeInstanceOf(StaffNotAssignableError);
  });
});

describe('AddCustomersService', () => {
  const list = listRecord();

  it('rejects customers not in the vendor (422)', async () => {
    const listRepo = { findById: jest.fn().mockResolvedValue(list) } as any;
    const subRepo = {} as any;
    const customerDir = {
      findCustomersNotInVendor: jest.fn().mockResolvedValue([99n]),
    } as any;
    const svc = new AddCustomersService(listRepo, subRepo, customerDir, audit, logger);
    await expect(svc.execute(addDto([3n, 99n]))).rejects.toBeInstanceOf(CustomerNotInVendorError);
  });

  it('throws 409 when all requested customers already subscribed', async () => {
    const listRepo = { findById: jest.fn().mockResolvedValue(list) } as any;
    const subRepo = {
      findNonEndedSubscriptionCustomerIds: jest.fn().mockResolvedValue([3n]),
    } as any;
    const customerDir = { findCustomersNotInVendor: jest.fn().mockResolvedValue([]) } as any;
    const svc = new AddCustomersService(listRepo, subRepo, customerDir, audit, logger);
    await expect(svc.execute(addDto([3n]))).rejects.toBeInstanceOf(
      AllCustomersAlreadySubscribedError
    );
  });

  it('adds new and skips existing (per-item result)', async () => {
    const listRepo = { findById: jest.fn().mockResolvedValue(list) } as any;
    const subRepo = {
      findNonEndedSubscriptionCustomerIds: jest.fn().mockResolvedValue([3n]),
      insertMany: jest.fn().mockResolvedValue([
        {
          id: 201n,
          vendorId: 1n,
          supplyListId: 100n,
          customerId: 4n,
          customQuantity: null,
          customRatePerUnit: null,
          startDate: new Date(),
          endDate: null,
          isActive: true,
          deletedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]),
      otherListNamesFor: jest.fn().mockResolvedValue(new Map()),
    } as any;
    const customerDir = {
      findCustomersNotInVendor: jest.fn().mockResolvedValue([]),
      getCustomerInfo: jest.fn().mockResolvedValue(new Map()),
    } as any;
    const svc = new AddCustomersService(listRepo, subRepo, customerDir, audit, logger);
    const res = await svc.execute(addDto([3n, 4n]));
    expect(res.addedCount).toBe(1);
    expect(res.skippedCount).toBe(1);
    expect(res.skipped[0]!.customerId).toBe('3');
  });

  function addDto(ids: bigint[]) {
    return {
      vendorId: 1n,
      listId: 100n,
      customerIds: ids,
      useDefaultQuantity: true,
      customQuantity: null,
      useDefaultRate: true,
      customRate: null,
      startDate: null,
      actorUserId: 9n,
      actorRole: 'o',
      ip: null,
      userAgent: null,
    };
  }
});

describe('GetSupplyListService (404-mask for unassigned staff)', () => {
  it('masks an unassigned staff member as 404', async () => {
    const repo = {
      findById: jest.fn().mockResolvedValue(
        listRecord({
          staff: [
            {
              vendorUserId: 77n,
              isPrimary: false,
              assignedByUserId: null,
              assignedAt: new Date(),
            },
          ],
        })
      ),
    } as any;
    const svc = new GetSupplyListService(repo, deliveryStats, logger);
    await expect(
      svc.execute({ vendorId: 1n, listId: 100n, role: 'staff', callerStaffId: 10n })
    ).rejects.toBeInstanceOf(SupplyListNotFoundError);
  });

  it('allows an assigned staff member', async () => {
    const repo = {
      findById: jest.fn().mockResolvedValue(
        listRecord({
          staff: [
            {
              vendorUserId: 10n,
              isPrimary: true,
              assignedByUserId: null,
              assignedAt: new Date(),
            },
          ],
        })
      ),
      assignedStaffFor: jest.fn().mockResolvedValue(new Map()),
      countActiveCustomers: jest.fn().mockResolvedValue(new Map()),
    } as any;
    const svc = new GetSupplyListService(repo, deliveryStats, logger);
    const dto = await svc.execute({
      vendorId: 1n,
      listId: 100n,
      role: 'staff',
      callerStaffId: 10n,
    });
    expect(dto.id).toBe('100');
  });
});
