import { Prisma } from '@prisma/client';
import { prisma } from '@/infrastructure/database/prisma.client';
import { ConflictError, NotFoundError } from '@/common/errors/app-error';
import { ListAssignmentWritePort } from '@/modules/staff/ports/list-assignment-write.port';

/**
 * Real write adapter implementing the staff module's `ListAssignmentWritePort`
 * over `supply_list_staff` (US-005 — replaces the 503 stub). Enforces same-tenant
 * (list and membership share a vendor) and maps P2002 → ConflictError. Throws
 * only domain errors the staff services already handle.
 */
export class SupplyListAssignmentWriteAdapter implements ListAssignmentWritePort {
  async assign(
    staffMembershipId: bigint,
    listId: bigint,
    isPrimary: boolean,
    assignedByUserId: bigint
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const { vendorId, membershipVendorId } = await this.resolveTenants(
        tx,
        listId,
        staffMembershipId
      );
      if (vendorId !== membershipVendorId) {
        // Cross-tenant — mask as not found.
        throw new NotFoundError('Supply list not found');
      }
      try {
        await tx.supplyListStaff.create({
          data: {
            supplyListId: listId,
            vendorUserId: staffMembershipId,
            isPrimary,
            assignedByUserId,
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictError('Staff member is already assigned to this list');
        }
        throw error;
      }
      if (isPrimary) {
        await tx.supplyListStaff.updateMany({
          where: {
            supplyListId: listId,
            vendorUserId: { not: staffMembershipId },
            isPrimary: true,
          },
          data: { isPrimary: false },
        });
      }
    });
  }

  async unassign(staffMembershipId: bigint, listId: bigint): Promise<void> {
    await prisma.supplyListStaff.deleteMany({
      where: { supplyListId: listId, vendorUserId: staffMembershipId },
    });
  }

  async setPrimary(staffMembershipId: bigint, listId: bigint): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.supplyListStaff.findFirst({
        where: { supplyListId: listId, vendorUserId: staffMembershipId },
        select: { id: true },
      });
      if (!existing) {
        throw new NotFoundError('Assignment not found');
      }
      await tx.supplyListStaff.updateMany({
        where: { supplyListId: listId, vendorUserId: { not: staffMembershipId }, isPrimary: true },
        data: { isPrimary: false },
      });
      await tx.supplyListStaff.update({
        where: { id: existing.id },
        data: { isPrimary: true },
      });
    });
  }

  private async resolveTenants(
    tx: Prisma.TransactionClient,
    listId: bigint,
    membershipId: bigint
  ): Promise<{ vendorId: bigint; membershipVendorId: bigint }> {
    const list = await tx.supplyList.findFirst({
      where: { id: listId, isActive: true, deletedAt: null },
      select: { vendorId: true },
    });
    if (!list) {
      throw new NotFoundError('Supply list not found');
    }
    const membership = await tx.vendorUser.findFirst({
      where: { id: membershipId, deletedAt: null },
      select: { vendorId: true },
    });
    if (!membership) {
      throw new NotFoundError('Staff member not found');
    }
    return { vendorId: list.vendorId, membershipVendorId: membership.vendorId };
  }
}
