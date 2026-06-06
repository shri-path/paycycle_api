import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { logger } from '@/infrastructure/logger/logger';
import { validate } from '@/infrastructure/middlewares/validate';
import { TooManyRequestsError } from '@/common/errors/app-error';

// In test environment, allow effectively unlimited requests per window
const isTest = process.env['NODE_ENV'] === 'test';
import {
  signupSchema,
  loginSchema,
  refreshTokenSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  logoutSchema,
} from './auth.validator';
import { authenticateToken } from './auth.middleware';
import { AuthController } from './auth.controller';
import { UserRepository } from './database/user.repository';
import { VendorRepository } from './database/vendor.repository';
import {
  SessionRepository,
  VendorUserRepository,
  PasswordResetTokenRepository,
} from './database/session.repository';
import { SmsStubAdapter } from './adapters/sms-stub.adapter';
import { SmsNotificationPort } from './ports/sms-notification.port';
import { SignupService } from './commands/signup/signup.service';
import { LoginService } from './commands/login/login.service';
import { RefreshTokenService } from './commands/refresh-token/refresh-token.service';
import { ForgotPasswordService } from './commands/forgot-password/forgot-password.service';
import { ResetPasswordService } from './commands/reset-password/reset-password.service';
import { LogoutService } from './commands/logout/logout.service';

// === Rate limiters ===
// In test environment use very high limits so integration tests are not rate-limited
const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: isTest ? 1000 : 3,
  keyGenerator: (req) => req.ip ?? 'unknown',
  handler: (_req, _res, next) =>
    next(new TooManyRequestsError('Too many signup attempts. Try again in an hour.')),
  standardHeaders: true,
  legacyHeaders: false,
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: isTest ? 1000 : 5,
  keyGenerator: (req) => (req.body as { phone?: string })?.phone ?? req.ip ?? 'unknown',
  handler: (_req, _res, next) =>
    next(new TooManyRequestsError('Too many login attempts. Try again in 15 minutes.')),
  standardHeaders: true,
  legacyHeaders: false,
});

const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: isTest ? 1000 : 10,
  keyGenerator: (req) => req.ip ?? 'unknown',
  handler: (_req, _res, next) =>
    next(new TooManyRequestsError('Too many refresh attempts. Try again in 15 minutes.')),
  standardHeaders: true,
  legacyHeaders: false,
});

const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: isTest ? 1000 : 3,
  keyGenerator: (req) => (req.body as { phone?: string })?.phone ?? req.ip ?? 'unknown',
  handler: (_req, _res, next) =>
    next(new TooManyRequestsError('Too many OTP requests. Try again in an hour.')),
  standardHeaders: true,
  legacyHeaders: false,
});

// === Composition Root ===
const smsService: SmsNotificationPort = new SmsStubAdapter(logger);

const userRepository = new UserRepository();
const vendorRepository = new VendorRepository();
const sessionRepository = new SessionRepository();
const vendorUserRepository = new VendorUserRepository();
const resetTokenRepository = new PasswordResetTokenRepository();

const signupService = new SignupService(
  userRepository,
  vendorRepository,
  sessionRepository,
  logger
);

const loginService = new LoginService(
  userRepository,
  sessionRepository,
  vendorUserRepository,
  logger
);

const refreshTokenService = new RefreshTokenService(sessionRepository, logger);

const forgotPasswordService = new ForgotPasswordService(
  userRepository,
  resetTokenRepository,
  smsService,
  logger
);

const resetPasswordService = new ResetPasswordService(
  userRepository,
  resetTokenRepository,
  sessionRepository,
  logger
);

const logoutService = new LogoutService(sessionRepository, logger);

const controller = new AuthController(
  signupService,
  loginService,
  refreshTokenService,
  forgotPasswordService,
  resetPasswordService,
  logoutService
);

/** Wraps an async Express handler so it returns void (satisfies RequestHandler type) */
const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    void fn(req, res, next);
  };

// === Routes ===
const router = Router();

// Middleware chain: [rateLimiter] → [authenticateToken if protected] → validate → controller
router.post(
  '/signup',
  signupLimiter,
  validate(signupSchema, 'body'),
  asyncHandler(controller.signup)
);
router.post('/login', loginLimiter, validate(loginSchema, 'body'), asyncHandler(controller.login));
router.post(
  '/refresh',
  refreshLimiter,
  validate(refreshTokenSchema, 'body'),
  asyncHandler(controller.refresh)
);
router.post(
  '/forgot-password',
  forgotPasswordLimiter,
  validate(forgotPasswordSchema, 'body'),
  asyncHandler(controller.forgotPassword)
);
router.post(
  '/reset-password',
  validate(resetPasswordSchema, 'body'),
  asyncHandler(controller.resetPassword)
);
router.post(
  '/logout',
  authenticateToken,
  validate(logoutSchema, 'body'),
  asyncHandler(controller.logout)
);

export default router;
