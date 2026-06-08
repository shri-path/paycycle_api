export interface UserDto {
  id: bigint;
  phone: string;
  name: string | null;
  email: string | null;
  preferredLanguage: string;
  createdAt: Date;
  updatedAt: Date;
}
