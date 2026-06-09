import { Prisma, StaffInvitationStatus } from '@prisma/client';
import { prisma, PrismaTransaction } from '@/infrastructure/database/prisma.client';
import { ConflictError } from '@/common/errors/app-error';
import {
  IStaffInvitationRepository,
  StaffInvitationRecord,
  InvitationUpdateData,
} from './staff-invitation.repository.port';

export class StaffInvitationRepository implements IStaffInvitationRepository {
  private getClient(tx?: PrismaTransaction) {
    return (tx ?? prisma).staffInvitation;
  }

  async insert(
    data: Prisma.StaffInvitationCreateInput,
    tx?: PrismaTransaction
  ): Promise<StaffInvitationRecord> {
    try {
      return await this.getClient(tx).create({ data });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('Invitation already exists');
      }
      throw error;
    }
  }

  async findByTokenHash(
    hash: string,
    tx?: PrismaTransaction
  ): Promise<StaffInvitationRecord | null> {
    return this.getClient(tx).findUnique({ where: { tokenHash: hash } });
  }

  async findPendingByMembership(
    vendorUserId: bigint,
    tx?: PrismaTransaction
  ): Promise<StaffInvitationRecord | null> {
    return this.getClient(tx).findFirst({
      where: { vendorUserId, status: StaffInvitationStatus.PENDING },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findLatestByMembership(
    vendorUserId: bigint,
    tx?: PrismaTransaction
  ): Promise<StaffInvitationRecord | null> {
    return this.getClient(tx).findFirst({
      where: { vendorUserId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(
    id: bigint,
    data: InvitationUpdateData,
    tx?: PrismaTransaction
  ): Promise<StaffInvitationRecord> {
    return this.getClient(tx).update({ where: { id }, data });
  }

  async revokePendingByMembership(vendorUserId: bigint, tx?: PrismaTransaction): Promise<void> {
    await this.getClient(tx).updateMany({
      where: { vendorUserId, status: StaffInvitationStatus.PENDING },
      data: { status: StaffInvitationStatus.REVOKED, revokedAt: new Date() },
    });
  }
}
