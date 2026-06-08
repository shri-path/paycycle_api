import { z } from 'zod';

// Reusable field helpers
const phoneField = z
  .string()
  .trim()
  .regex(/^\+?[1-9][0-9]{7,14}$/, 'Invalid phone number format');

const strongPasswordField = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(100, 'Password must be at most 100 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one digit')
  .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character');

const passwordField = z
  .string()
  .min(1, 'Password is required')
  .max(100, 'Password must be at most 100 characters');

// Signup schema
export const signupSchema = z
  .object({
    phone: phoneField,
    password: strongPasswordField,
    vendorName: z
      .string()
      .trim()
      .min(1, 'Vendor name is required')
      .max(150, 'Vendor name must be at most 150 characters'),
  })
  .strict();

export type SignupInput = z.infer<typeof signupSchema>;

// Login schema
export const loginSchema = z
  .object({
    phone: phoneField,
    password: passwordField,
    deviceId: z.string().max(100).optional(),
    deviceName: z.string().max(200).optional(),
  })
  .strict();

export type LoginInput = z.infer<typeof loginSchema>;

// Refresh token schema
export const refreshTokenSchema = z
  .object({
    refreshToken: z.string().min(1, 'Refresh token is required'),
  })
  .strict();

export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;

// Forgot password schema
export const forgotPasswordSchema = z
  .object({
    phone: phoneField,
  })
  .strict();

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

// Reset password schema
export const resetPasswordSchema = z
  .object({
    phone: phoneField,
    resetToken: z.string().min(1, 'Reset token is required'),
    otpCode: z.string().regex(/^[0-9]{6}$/, 'OTP must be exactly 6 digits'),
    newPassword: strongPasswordField,
  })
  .strict();

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

// Logout schema
export const logoutSchema = z
  .object({
    refreshToken: z.string().min(1, 'Refresh token is required'),
  })
  .strict();

export type LogoutInput = z.infer<typeof logoutSchema>;
