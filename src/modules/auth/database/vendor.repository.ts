import { Vendor, Prisma } from '@prisma/client';
import { prisma, PrismaTransaction } from '@/infrastructure/database/prisma.client';
import { ConflictError } from '@/common/errors/app-error';
import { IVendorRepository } from './vendor.repository.port';

export class VendorRepository implements IVendorRepository {
  private getClient(tx?: PrismaTransaction) {
    return (tx ?? prisma).vendor;
  }

  async insert(data: Prisma.VendorCreateInput, tx?: PrismaTransaction): Promise<Vendor> {
    try {
      return await this.getClient(tx).create({ data });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('Vendor with this referral code already exists');
      }
      throw error;
    }
  }

  async findById(id: bigint): Promise<Vendor | null> {
    return prisma.vendor.findFirst({
      where: { id, deletedAt: null },
    });
  }
}
