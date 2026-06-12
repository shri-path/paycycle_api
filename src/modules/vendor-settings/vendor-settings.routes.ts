/**
 * VendorSettings routes — composition root.
 * Mounted at /api/v1/vendors (nested under vendor scope).
 */
import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticateToken } from '@/modules/auth/auth.middleware';
import { validate } from '@/infrastructure/middlewares/validate';
import { identifyUserRole } from '@/infrastructure/middlewares/rbac/role-context';
import { requireOwnerRole } from '@/infrastructure/middlewares/rbac/require-owner';
import { TooManyRequestsError } from '@/common/errors/app-error';

// Repositories
import { VendorSettingsRepository } from './database/vendor-settings.repository';

// Query / Command handlers
import { GetVendorSettingsQuery } from './queries/get-vendor-settings/get-vendor-settings.query';
import { UpdateVendorSettingsCommand } from './commands/update-vendor-settings/update-vendor-settings.command';

// Controller + validators
import { VendorSettingsController } from './vendor-settings.controller';
import { vendorIdParamSchema, updateVendorSettingsSchema } from './vendor-settings.validator';

const isTest = process.env['NODE_ENV'] === 'test';

// === Composition Root ===
const settingsRepo = new VendorSettingsRepository();
const getSettingsQry = new GetVendorSettingsQuery(settingsRepo);
const updateSettingsCmd = new UpdateVendorSettingsCommand(settingsRepo);

const controller = new VendorSettingsController(getSettingsQry, updateSettingsCmd);

// === Rate Limiter ===
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTest ? 1000 : 50,
  keyGenerator: (req) => req.user?.userId?.toString() ?? req.ip ?? 'unknown',
  handler: (_req, _res, next) =>
    next(new TooManyRequestsError('Too many requests. Try again later.')),
  standardHeaders: true,
  legacyHeaders: false,
});

const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    void fn(req, res, next);
  };

// === Router ===
const vendorSettingsRouter = Router({ mergeParams: true });

/**
 * GET /api/v1/vendors/:vendorId/settings
 */
vendorSettingsRouter.get(
  '/:vendorId/settings',
  authenticateToken,
  validate(vendorIdParamSchema, 'params'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.getSettings)
);

/**
 * PATCH /api/v1/vendors/:vendorId/settings
 */
vendorSettingsRouter.patch(
  '/:vendorId/settings',
  authenticateToken,
  writeLimiter,
  validate(vendorIdParamSchema, 'params'),
  validate(updateVendorSettingsSchema, 'body'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.updateSettings)
);

export default vendorSettingsRouter;
