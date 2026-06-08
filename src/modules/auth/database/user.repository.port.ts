import { User, Prisma } from '@prisma/client';
import { PrismaTransaction } from '@/infrastructure/database/prisma.client';

export interface IUserRepository {
  findByPhone(phone: string, tx?: PrismaTransaction): Promise<User | null>;
  findById(id: bigint, tx?: PrismaTransaction): Promise<User | null>;
  insert(data: Prisma.UserCreateInput, tx?: PrismaTransaction): Promise<User>;
  update(id: bigint, data: Prisma.UserUpdateInput, tx?: PrismaTransaction): Promise<User>;
}
