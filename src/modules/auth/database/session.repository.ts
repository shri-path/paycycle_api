import { UserSession, Prisma } from '@prisma/client';
import { prisma, PrismaTransaction } from '@/infrastructure/database/prisma.client';

export interface VendorContext {
  vendorId: bigint;
  roleName: string;
  vendorName: string;
}

export class SessionRepository {
  private getClient(tx?: PrismaTransaction) {
    return (tx ?? prisma).userSession;
  }

  async create(data: Prisma.UserSessionCreateInput, tx?: PrismaTransaction): Promise<UserSession> {
    return this.getClient(tx).create({ data });
  }

  async findByRefreshToken(token: string): Promise<UserSession | null> {
    return prisma.userSession.findFirst({
      where: {
        refreshToken: token,
        revokedAt: null,
      },
    });
  }

  async revoke(id: bigint, tx?: PrismaTransaction): Promise<void> {
    await this.getClient(tx).update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAll(userId: bigint, tx?: PrismaTransaction): Promise<void> {
    await (tx ?? prisma).userSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

export interface VendorClaim {
  vendorId: bigint;
  roleName: string;
  permissions: string[];
}

export class VendorUserRepository {
  async findActiveContextsByUserId(userId: bigint): Promise<VendorContext[]> {
    const rows = await prisma.vendorUser.findMany({
      where: { userId, status: 'ACTIVE', deletedAt: null },
      include: {
        vendor: { select: { name: true } },
        role: { select: { name: true } },
      },
    });

    return rows.map((row) => ({
      vendorId: row.vendorId,
      roleName: row.role.name,
      vendorName: row.vendor.name,
    }));
  }

  /**
   * US-002 (OQ-2): per-vendor role + granted permission keys for JWT embedding.
   * Owners report no grant keys (they are all-allow); staff report granted keys only.
   */
  async findVendorClaimsByUserId(userId: bigint): Promise<VendorClaim[]> {
    const rows = await prisma.vendorUser.findMany({
      where: { userId, status: 'ACTIVE', deletedAt: null },
      include: {
        role: { select: { name: true } },
        staffPermissions: { where: { granted: true }, select: { permissionKey: true } },
      },
    });

    return rows.map((row) => ({
      vendorId: row.vendorId,
      roleName: row.role.name,
      permissions: row.staffPermissions.map((p) => p.permissionKey),
    }));
  }
}

export class PasswordResetTokenRepository {
  async create(data: {
    userId: bigint;
    resetToken: string;
    otpCode: string;
    expiresAt: Date;
  }): Promise<void> {
    await prisma.passwordResetToken.create({
      data: {
        userId: data.userId,
        resetToken: data.resetToken,
        otpCode: data.otpCode,
        expiresAt: data.expiresAt,
      },
    });
  }

  async findValid(params: {
    resetToken: string;
    otpCode: string;
  }): Promise<{ id: bigint; userId: bigint } | null> {
    const record = await prisma.passwordResetToken.findFirst({
      where: {
        resetToken: params.resetToken,
        otpCode: params.otpCode,
        isUsed: false,
        expiresAt: { gt: new Date() },
      },
      select: { id: true, userId: true },
    });
    return record;
  }

  async markUsed(id: bigint, tx?: PrismaTransaction): Promise<void> {
    await (tx ?? prisma).passwordResetToken.update({
      where: { id },
      data: { isUsed: true, usedAt: new Date() },
    });
  }
}
