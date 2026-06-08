export interface RefreshTokenRequestDto {
  refreshToken: string;
  ip?: string | null;
  userAgent?: string | null;
}
