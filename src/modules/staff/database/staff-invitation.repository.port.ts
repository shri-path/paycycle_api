import { Prisma, StaffInvitation, StaffInvitationStatus } from '@prisma/client';
import { PrismaTransaction } from '@/infrastructure/database/prisma.client';

export type StaffInvitationRecord = StaffInvitation;

export interface InvitationUpdateData {
  status?: StaffInvitationStatus;
  acceptedAt?: Date | null;
  revokedAt?: Date | null;
}

export interface IStaffInvitationRepository {
  insert(
    data: Prisma.StaffInvitationCreateInput,
    tx?: PrismaTransaction
  ): Promise<StaffInvitationRecord>;
  findByTokenHash(hash: string, tx?: PrismaTransaction): Promise<StaffInvitationRecord | null>;
  findPendingByMembership(
    vendorUserId: bigint,
    tx?: PrismaTransaction
  ): Promise<StaffInvitationRecord | null>;
  update(
    id: bigint,
    data: InvitationUpdateData,
    tx?: PrismaTransaction
  ): Promise<StaffInvitationRecord>;
  /** Revoke all PENDING invitations for a membership (e.g. on re-invite/remove). */
  revokePendingByMembership(vendorUserId: bigint, tx?: PrismaTransaction): Promise<void>;
}
