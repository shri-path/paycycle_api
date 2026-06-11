import { VendorUserStatus } from '@prisma/client';
import { prisma } from '@/infrastructure/database/prisma.client';
import { StaffDirectoryPort, StaffMembershipInfo } from '../ports/staff-directory.port';

/**
 * Reads `vendor_users` (+ `users`) directly to validate a membership without
 * importing the staff bounded context's domain code.
 */
export class StaffDirectoryAdapter implements StaffDirectoryPort {
  async findActiveMembership(
    vendorId: bigint,
    vendorUserId: bigint
  ): Promise<StaffMembershipInfo | null> {
    const row = await prisma.vendorUser.findFirst({
      where: { id: vendorUserId, vendorId, deletedAt: null },
      select: {
        id: true,
        status: true,
        phone: true,
        user: { select: { name: true, phone: true } },
      },
    });
    if (!row || row.status !== VendorUserStatus.ACTIVE) return null;
    return {
      id: row.id,
      status: row.status,
      displayName: row.user?.name ?? null,
      phone: row.phone ?? row.user?.phone ?? null,
    };
  }
}
