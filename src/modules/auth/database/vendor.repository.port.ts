import { Vendor, Prisma } from '@prisma/client';
import { PrismaTransaction } from '@/infrastructure/database/prisma.client';

export interface IVendorRepository {
  insert(data: Prisma.VendorCreateInput, tx?: PrismaTransaction): Promise<Vendor>;
  findById(id: bigint): Promise<Vendor | null>;
}
