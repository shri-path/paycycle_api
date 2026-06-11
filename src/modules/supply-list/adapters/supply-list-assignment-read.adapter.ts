import { prisma } from '@/infrastructure/database/prisma.client';
import { ListAssignmentPort } from '@/modules/staff/ports/list-assignment.port';

/**
 * Real read adapter implementing the staff module's `ListAssignmentPort` over
 * `supply_list_staff` (US-005 — replaces ListAssignmentStubAdapter). Only counts
 * assignments to active (non-archived) lists for capability checks.
 */
export class SupplyListAssignmentReadAdapter implements ListAssignmentPort {
  async countAssignedLists(staffMembershipId: bigint): Promise<number> {
    return prisma.supplyListStaff.count({
      where: { vendorUserId: staffMembershipId, supplyList: { isActive: true, deletedAt: null } },
    });
  }

  async getAssignedListIds(staffMembershipId: bigint): Promise<bigint[]> {
    const rows = await prisma.supplyListStaff.findMany({
      where: { vendorUserId: staffMembershipId, supplyList: { isActive: true, deletedAt: null } },
      select: { supplyListId: true },
    });
    return rows.map((r) => r.supplyListId);
  }

  async isAssignedToList(staffMembershipId: bigint, listId: bigint): Promise<boolean> {
    const row = await prisma.supplyListStaff.findFirst({
      where: { vendorUserId: staffMembershipId, supplyListId: listId },
      select: { id: true },
    });
    return row !== null;
  }

  async isCustomerInAssignedList(staffMembershipId: bigint, customerId: bigint): Promise<boolean> {
    // True when the customer holds an active subscription on a list the staff
    // member is assigned to.
    const row = await prisma.supplyListCustomer.findFirst({
      where: {
        customerId,
        endDate: null,
        deletedAt: null,
        supplyList: {
          isActive: true,
          deletedAt: null,
          staff: { some: { vendorUserId: staffMembershipId } },
        },
      },
      select: { id: true },
    });
    return row !== null;
  }

  async unassignAll(staffMembershipId: bigint): Promise<void> {
    await prisma.supplyListStaff.deleteMany({ where: { vendorUserId: staffMembershipId } });
  }
}
