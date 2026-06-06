export interface ResetPasswordRequestDto {
  phone: string;
  resetToken: string;
  otpCode: string;
  newPassword: string;
}
