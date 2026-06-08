export interface LoginRequestDto {
  phone: string;
  password: string;
  ip?: string | null;
  userAgent?: string | null;
  deviceId?: string | null;
}
