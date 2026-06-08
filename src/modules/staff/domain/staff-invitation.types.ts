import { StaffInvitationStatus } from '@prisma/client';

export interface StaffInvitationProps {
  vendorId: bigint;
  vendorUserId: bigint;
  invitedByUserId: bigint;
  phone: string;
  tokenHash: string;
  status: StaffInvitationStatus;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
}

export interface CreateInvitationProps {
  vendorId: bigint;
  vendorUserId: bigint;
  invitedByUserId: bigint;
  phone: string;
}

export interface ReconstituteInvitationData {
  id: bigint;
  createdAt: Date;
  updatedAt: Date;
  props: StaffInvitationProps;
}

/** Invitation lifetime in milliseconds (7 days — story security requirement). */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
