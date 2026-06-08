export interface SignupRequestDto {
  phone: string;
  password: string;
  vendorName: string;
  ip?: string | null;
  userAgent?: string | null;
}
