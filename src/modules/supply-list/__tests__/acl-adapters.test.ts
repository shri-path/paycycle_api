/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-require-imports */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { ConflictError, NotFoundError } from '@/common/errors/app-error';

jest.mock('@/infrastructure/database/prisma.client', () => {
  const tx = {
    supplyList: { findFirst: jest.fn() },
    vendorUser: { findFirst: jest.fn() },
    supplyListStaff: {
      create: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };
  return {
    prisma: {
      $transaction: jest.fn((cb: any) => cb(tx)),
      supplyListStaff: {
        count: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        deleteMany: jest.fn(),
      },
      supplyListCustomer: { findFirst: jest.fn() },
      __tx: tx,
    },
  };
});

const { prisma } = require('@/infrastructure/database/prisma.client');
const tx = prisma.__tx;

import { SupplyListAssignmentReadAdapter } from '../adapters/supply-list-assignment-read.adapter';
import { SupplyListAssignmentWriteAdapter } from '../adapters/supply-list-assignment-write.adapter';

describe('SupplyListAssignmentReadAdapter (real, replaces stub)', () => {
  const read = new SupplyListAssignmentReadAdapter();

  it('isAssignedToList returns true when a row exists', async () => {
    prisma.supplyListStaff.findFirst.mockResolvedValueOnce({ id: 1n });
    expect(await read.isAssignedToList(5n, 1n)).toBe(true);
  });

  it('unassignAll deletes all rows for the membership (StaffRemoved → unassignAll)', async () => {
    prisma.supplyListStaff.deleteMany.mockResolvedValueOnce({ count: 3 });
    await read.unassignAll(5n);
    expect(prisma.supplyListStaff.deleteMany).toHaveBeenCalledWith({
      where: { vendorUserId: 5n },
    });
  });
});

describe('SupplyListAssignmentWriteAdapter (real, replaces 503 stub)', () => {
  const write = new SupplyListAssignmentWriteAdapter();

  beforeEach(() => {
    // resetMocks:true clears the $transaction implementation between tests.
    prisma.$transaction.mockImplementation((cb: any) => cb(tx));
    tx.supplyList.findFirst.mockResolvedValue({ vendorId: 1n });
    tx.vendorUser.findFirst.mockResolvedValue({ vendorId: 1n });
    tx.supplyListStaff.create.mockResolvedValue({ id: 1n });
    tx.supplyListStaff.updateMany.mockResolvedValue({ count: 0 });
  });

  it('assign performs a real write (no 503)', async () => {
    await write.assign(5n, 1n, false, 9n);
    expect(tx.supplyListStaff.create).toHaveBeenCalled();
  });

  it('assign demotes other primaries when isPrimary', async () => {
    await write.assign(5n, 1n, true, 9n);
    expect(tx.supplyListStaff.updateMany).toHaveBeenCalled();
  });

  it('assign maps P2002 to ConflictError', async () => {
    const { Prisma } = require('@prisma/client');
    tx.supplyListStaff.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '5' })
    );
    await expect(write.assign(5n, 1n, false, 9n)).rejects.toBeInstanceOf(ConflictError);
  });

  it('assign masks cross-tenant as NotFound', async () => {
    tx.vendorUser.findFirst.mockResolvedValueOnce({ vendorId: 2n });
    await expect(write.assign(5n, 1n, false, 9n)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('unassign deletes the assignment row', async () => {
    prisma.supplyListStaff.deleteMany.mockResolvedValueOnce({ count: 1 });
    await write.unassign(5n, 1n);
    expect(prisma.supplyListStaff.deleteMany).toHaveBeenCalledWith({
      where: { supplyListId: 1n, vendorUserId: 5n },
    });
  });
});
