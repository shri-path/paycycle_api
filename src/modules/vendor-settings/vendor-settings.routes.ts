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
import { BulkOperationRepository } from './database/bulk-operation.repository';

// Adapters
import { BulkLeaveWriterAdapter } from './adapters/bulk-leave-writer.adapter';
import { BulkRateWriterAdapter } from './adapters/bulk-rate-writer.adapter';
import { ReminderTargetAdapter } from './adapters/reminder-target.adapter';
import { BillNotificationLogAdapter } from './adapters/bill-notification-log.adapter';

// Query / Command handlers
import { GetVendorSettingsQuery } from './queries/get-vendor-settings/get-vendor-settings.query';
import { GetBulkOperationQuery } from './queries/get-bulk-operation/get-bulk-operation.query';
import { UpdateVendorSettingsCommand } from './commands/update-vendor-settings/update-vendor-settings.command';
import { UpdateNotificationPreferencesCommand } from './commands/update-notification-preferences/update-notification-preferences.command';
import { BulkMarkLeaveCommand } from './commands/bulk-mark-leave/bulk-mark-leave.command';
import { BulkAdjustRateCommand } from './commands/bulk-adjust-rate/bulk-adjust-rate.command';
import { BulkSendRemindersCommand } from './commands/bulk-send-reminders/bulk-send-reminders.command';

// Controllers + validators
import { VendorSettingsController } from './vendor-settings.controller';
import { BulkOperationsController } from './bulk-operations.controller';
import {
  vendorIdParamSchema,
  operationIdParamSchema,
  updateVendorSettingsSchema,
  updateNotificationPreferencesSchema,
  bulkMarkLeaveSchema,
  bulkAdjustRateSchema,
  bulkSendRemindersSchema,
} from './vendor-settings.validator';

const isTest = process.env['NODE_ENV'] === 'test';

// === Composition Root ===
const settingsRepo = new VendorSettingsRepository();
const bulkOpRepo = new BulkOperationRepository();

const leaveWriterAdapter = new BulkLeaveWriterAdapter();
const rateWriterAdapter = new BulkRateWriterAdapter();
const reminderTargetAdapter = new ReminderTargetAdapter();
const billNotificationAdapter = new BillNotificationLogAdapter();

const getSettingsQry = new GetVendorSettingsQuery(settingsRepo);
const getBulkOpQry = new GetBulkOperationQuery(bulkOpRepo);

const updateSettingsCmd = new UpdateVendorSettingsCommand(settingsRepo);
const updateNotifPrefsCmd = new UpdateNotificationPreferencesCommand(settingsRepo);
const bulkMarkLeaveCmd = new BulkMarkLeaveCommand(settingsRepo, bulkOpRepo, leaveWriterAdapter);
const bulkAdjustRateCmd = new BulkAdjustRateCommand(
  settingsRepo,
  bulkOpRepo,
  rateWriterAdapter,
  billNotificationAdapter
);
const bulkSendRemindersCmd = new BulkSendRemindersCommand(
  settingsRepo,
  bulkOpRepo,
  reminderTargetAdapter,
  billNotificationAdapter
);

const settingsController = new VendorSettingsController(
  getSettingsQry,
  updateSettingsCmd,
  updateNotifPrefsCmd
);
const bulkController = new BulkOperationsController(
  bulkMarkLeaveCmd,
  bulkAdjustRateCmd,
  bulkSendRemindersCmd,
  getBulkOpQry
);

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
  asyncHandler(settingsController.getSettings)
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
  asyncHandler(settingsController.updateSettings)
);

/**
 * PATCH /api/v1/vendors/:vendorId/notification-preferences
 */
vendorSettingsRouter.patch(
  '/:vendorId/notification-preferences',
  authenticateToken,
  writeLimiter,
  validate(vendorIdParamSchema, 'params'),
  validate(updateNotificationPreferencesSchema, 'body'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(settingsController.updateNotificationPreferences)
);

/**
 * POST /api/v1/vendors/:vendorId/bulk-operations/mark-leave
 */
vendorSettingsRouter.post(
  '/:vendorId/bulk-operations/mark-leave',
  authenticateToken,
  writeLimiter,
  validate(vendorIdParamSchema, 'params'),
  validate(bulkMarkLeaveSchema, 'body'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(bulkController.markLeave)
);

/**
 * POST /api/v1/vendors/:vendorId/bulk-operations/adjust-rate
 */
vendorSettingsRouter.post(
  '/:vendorId/bulk-operations/adjust-rate',
  authenticateToken,
  writeLimiter,
  validate(vendorIdParamSchema, 'params'),
  validate(bulkAdjustRateSchema, 'body'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(bulkController.adjustRate)
);

/**
 * POST /api/v1/vendors/:vendorId/bulk-operations/send-reminders
 */
vendorSettingsRouter.post(
  '/:vendorId/bulk-operations/send-reminders',
  authenticateToken,
  writeLimiter,
  validate(vendorIdParamSchema, 'params'),
  validate(bulkSendRemindersSchema, 'body'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(bulkController.sendReminders)
);

/**
 * GET /api/v1/vendors/:vendorId/bulk-operations/:operationId
 */
vendorSettingsRouter.get(
  '/:vendorId/bulk-operations/:operationId',
  authenticateToken,
  validate(operationIdParamSchema, 'params'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(bulkController.getOperation)
);

export default vendorSettingsRouter;
