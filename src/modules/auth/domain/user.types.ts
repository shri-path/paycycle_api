import { PhoneNumber } from './value-objects/phone-number.value-object';
import { HashedPassword } from './value-objects/hashed-password.value-object';

export interface UserProps {
  phone: PhoneNumber;
  passwordHash: HashedPassword;
  name: string | null;
  email: string | null;
  profilePhotoUrl: string | null;
  preferredLanguage: string;
  lastLoginAt: Date | null;
  deletedAt: Date | null;
}

export interface CreateUserProps {
  phone: PhoneNumber;
  passwordHash: HashedPassword;
  preferredLanguage?: string; // defaults to 'en'
}

export interface ReconstituteUserData {
  id: bigint;
  createdAt: Date;
  updatedAt: Date;
  props: UserProps;
}
