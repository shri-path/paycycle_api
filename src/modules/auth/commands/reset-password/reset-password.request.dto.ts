export interface ResetPasswordRequestDto {
  phone: string;
  otpCode: string;
  newPassword: string;
}
