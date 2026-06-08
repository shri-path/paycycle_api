// Response DTOs for auth module

export interface UserDto {
  id: string; // BigInt as string
  phone: string;
  name: string | null;
  email: string | null;
  profilePhotoUrl: string | null;
  preferredLanguage: string;
  lastLoginAt: string | null; // ISO 8601
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  // NEVER: passwordHash, deletedAt
}

export interface TokenDto {
  accessToken: string;
  refreshToken: string;
}

export interface VendorContextDto {
  vendorId: string; // BigInt as string
  vendorName: string;
  role: string; // 'vendor_owner' | 'vendor_staff'
}

export interface SignupResponseDto {
  user: UserDto;
  tokens: TokenDto;
  vendorContext: VendorContextDto;
}

export interface LoginResponseDto {
  user: UserDto;
  tokens: TokenDto;
  vendorContexts: VendorContextDto[];
}

export interface RefreshResponseDto {
  accessToken: string;
  refreshToken: string;
}
