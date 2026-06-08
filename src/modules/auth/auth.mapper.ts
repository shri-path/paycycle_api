import { User as PrismaUser, Vendor as PrismaVendor, Prisma } from '@prisma/client';
import { UserEntity } from './domain/user.entity';
import { VendorEntity } from './domain/vendor.entity';
import { PhoneNumber } from './domain/value-objects/phone-number.value-object';
import { HashedPassword } from './domain/value-objects/hashed-password.value-object';
import { UserDto, VendorContextDto } from './auth.types';

export class UserMapper {
  static toPersistence(entity: UserEntity): Prisma.UserCreateInput {
    const props = entity.getProps();
    return {
      phone: props.phone.unpack(),
      passwordHash: props.passwordHash.unpack(),
      name: props.name ?? null,
      email: props.email ?? null,
      profilePhotoUrl: props.profilePhotoUrl ?? null,
      preferredLanguage: props.preferredLanguage,
    };
  }

  static toDomain(record: PrismaUser): UserEntity {
    return UserEntity.reconstitute({
      id: record.id,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      props: {
        phone: PhoneNumber.create(record.phone),
        passwordHash: HashedPassword.create(record.passwordHash),
        name: record.name,
        email: record.email,
        profilePhotoUrl: record.profilePhotoUrl,
        preferredLanguage: record.preferredLanguage,
        lastLoginAt: record.lastLoginAt,
        deletedAt: record.deletedAt,
      },
    });
  }

  static toResponse(entity: UserEntity): UserDto {
    const props = entity.getProps();
    return {
      id: props.id.toString(),
      phone: props.phone.unpack(),
      name: props.name ?? null,
      email: props.email ?? null,
      profilePhotoUrl: props.profilePhotoUrl ?? null,
      preferredLanguage: props.preferredLanguage,
      lastLoginAt: props.lastLoginAt?.toISOString() ?? null,
      createdAt: props.createdAt.toISOString(),
      updatedAt: props.updatedAt.toISOString(),
      // NEVER include: passwordHash, deletedAt
    };
  }
}

export class VendorMapper {
  static toPersistence(entity: VendorEntity): Prisma.VendorCreateInput {
    const props = entity.getProps();
    return {
      name: props.name,
      phone: props.phone ?? null,
      category: props.category ?? null,
      autoMarkEnabled: props.autoMarkEnabled,
      autoSendBills: props.autoSendBills,
      autoSendTime: props.autoSendTime ?? '20:00',
    };
  }

  static toDomain(record: PrismaVendor): VendorEntity {
    return VendorEntity.reconstitute({
      id: record.id,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      props: {
        name: record.name,
        phone: record.phone,
        category: record.category,
        referralCode: record.referralCode,
        referredByVendorId: record.referredByVendorId,
        autoMarkEnabled: record.autoMarkEnabled,
        autoSendBills: record.autoSendBills,
        autoSendTime: record.autoSendTime,
        upiId: record.upiId,
        bankDetails: record.bankDetails,
        deletedAt: record.deletedAt,
      },
    });
  }

  static toResponse(entity: VendorEntity, role: string): VendorContextDto {
    const props = entity.getProps();
    return {
      vendorId: props.id.toString(),
      vendorName: props.name,
      role,
    };
  }
}
