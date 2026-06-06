import { User, Prisma } from '@prisma/client';
import { prisma, PrismaTransaction } from '@/infrastructure/database/prisma.client';
import { ConflictError } from '@/common/errors/app-error';
import { IUserRepository } from './user.repository.port';

export class UserRepository implements IUserRepository {
  private getClient(tx?: PrismaTransaction) {
    return (tx ?? prisma).user;
  }

  async findByPhone(phone: string, tx?: PrismaTransaction): Promise<User | null> {
    return this.getClient(tx).findFirst({
      where: { phone, deletedAt: null },
    });
  }

  async findById(id: bigint, tx?: PrismaTransaction): Promise<User | null> {
    return this.getClient(tx).findFirst({
      where: { id, deletedAt: null },
    });
  }

  async insert(data: Prisma.UserCreateInput, tx?: PrismaTransaction): Promise<User> {
    try {
      return await this.getClient(tx).create({ data });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('Phone number is already registered');
      }
      throw error;
    }
  }

  async update(id: bigint, data: Prisma.UserUpdateInput, tx?: PrismaTransaction): Promise<User> {
    return this.getClient(tx).update({
      where: { id },
      data,
    });
  }
}
