import { Prisma, VendorUserStatus } from '@prisma/client';
import { prisma, PrismaTransaction } from '@/infrastructure/database/prisma.client';
import { ConflictError } from '@/common/errors/app-error';
import {
  IVendorMembershipRepository,
  VendorMembershipRecord,
  StaffPermissionInput,
  MembershipUpdateData,
  ListMembershipsParams,
} from './vendor-membership.repository.port';

const INCLUDE = {
  role: { select: { name: true } },
  user: { select: { name: true, phone: true } },
  staffPermissions: true,
} satisfies Prisma.VendorUserInclude;

export class VendorMembershipRepository implements IVendorMembershipRepository {
  private getClient(tx?: PrismaTransaction) {
    return (tx ?? prisma).vendorUser;
  }

  async findById(id: bigint, tx?: PrismaTransaction): Promise<VendorMembershipRecord | null> {
    return this.getClient(tx).findFirst({
      where: { id },
      include: INCLUDE,
    }) as Promise<VendorMembershipRecord | null>;
  }

  async findByVendorAndUser(
    vendorId: bigint,
    userId: bigint,
    tx?: PrismaTransaction
  ): Promise<VendorMembershipRecord | null> {
    return this.getClient(tx).findFirst({
      where: { vendorId, userId },
      include: INCLUDE,
    }) as Promise<VendorMembershipRecord | null>;
  }

  async findByVendorAndPhone(
    vendorId: bigint,
    phone: string,
    tx?: PrismaTransaction
  ): Promise<VendorMembershipRecord | null> {
    return this.getClient(tx).findFirst({
      where: {
        vendorId,
        OR: [{ phone }, { user: { phone } }],
      },
      include: INCLUDE,
      orderBy: { createdAt: 'desc' },
    }) as Promise<VendorMembershipRecord | null>;
  }

  async listByVendor(
    vendorId: bigint,
    params: ListMembershipsParams,
    tx?: PrismaTransaction
  ): Promise<{ rows: VendorMembershipRecord[]; total: number }> {
    const client = this.getClient(tx);
    // Staff list excludes the owner and soft-removed rows.
    const where: Prisma.VendorUserWhereInput = {
      ...params.where,
      vendorId,
      deletedAt: null,
      role: { name: { not: 'vendor_owner' } },
    };

    const [rows, total] = await Promise.all([
      client.findMany({
        where,
        include: INCLUDE,
        orderBy: params.orderBy ?? { createdAt: 'desc' },
        ...(params.skip !== undefined ? { skip: params.skip } : {}),
        ...(params.take !== undefined ? { take: params.take } : {}),
      }),
      client.count({ where }),
    ]);

    return { rows: rows as VendorMembershipRecord[], total };
  }

  async insertWithPermissions(
    data: Prisma.VendorUserCreateInput,
    grants: StaffPermissionInput[],
    tx?: PrismaTransaction
  ): Promise<VendorMembershipRecord> {
    try {
      const created = await this.getClient(tx).create({
        data: {
          ...data,
          ...(grants.length > 0
            ? {
                staffPermissions: {
                  create: grants.map((g) => ({
                    permissionKey: g.permissionKey,
                    granted: g.granted,
                  })),
                },
              }
            : {}),
        },
        include: INCLUDE,
      });
      return created as VendorMembershipRecord;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('This user is already a member of this vendor');
      }
      throw error;
    }
  }

  async update(
    id: bigint,
    data: MembershipUpdateData,
    tx?: PrismaTransaction
  ): Promise<VendorMembershipRecord> {
    const updated = await this.getClient(tx).update({
      where: { id },
      data,
      include: INCLUDE,
    });
    return updated as VendorMembershipRecord;
  }

  async replacePermissions(
    id: bigint,
    grants: StaffPermissionInput[],
    tx?: PrismaTransaction
  ): Promise<void> {
    const client = tx ?? prisma;
    await client.staffPermission.deleteMany({ where: { vendorUserId: id } });
    if (grants.length > 0) {
      await client.staffPermission.createMany({
        data: grants.map((g) => ({
          vendorUserId: id,
          permissionKey: g.permissionKey,
          granted: g.granted,
        })),
        skipDuplicates: true,
      });
    }
  }

  async countActiveStaff(vendorId: bigint, tx?: PrismaTransaction): Promise<number> {
    return this.getClient(tx).count({
      where: {
        vendorId,
        deletedAt: null,
        status: { not: VendorUserStatus.REMOVED },
        role: { name: { not: 'vendor_owner' } },
      },
    });
  }
}
