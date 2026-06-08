export interface SmsNotificationPort {
  /**
   * Send an OTP to the given phone number.
   * Implementations must not throw — they log and resolve silently on failure.
   */
  sendOtp(phone: string, otp: string): Promise<void>;
}
