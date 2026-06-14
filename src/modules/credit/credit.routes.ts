import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { logger } from '@/infrastructure/logger/logger';
import { validate } from '@/infrastructure/middlewares/validate';
import { TooManyRequestsError } from '@/common/errors/app-error';
import { authenticateToken } from '@/modules/auth/auth.middleware';
import { identifyUserRole } from '@/infrastructure/middlewares/rbac/role-context';
import { requireOwnerRole } from '@/infrastructure/middlewares/rbac/require-owner';

import { CreditController } from './credit.controller';
import { CreditSettingsRepository } from './database/credit-settings.repository';
import { ReminderConfigRepository } from './database/reminder-config.repository';
import { PaymentReminderRepository } from './database/payment-reminder.repository';
import { CreditBalanceAdapter } from './adapters/credit-balance.adapter';
import { CreditCustomerAdapter } from './adapters/credit-customer.adapter';
import { DeliveryControlAdapter } from './adapters/delivery-control.adapter';
import { ReminderNotificationLogAdapter } from './adapters/reminder-notification-log.adapter';
import { SetCreditSettingsCommand } from './commands/set-credit-settings/set-credit-settings.command';
import { EnablePrepaidCommand } from './commands/enable-prepaid/enable-prepaid.command';
import { SendBulkRemindersCommand } from './commands/send-bulk-reminders/send-bulk-reminders.command';
import { SendSingleReminderCommand } from './commands/send-single-reminder/send-single-reminder.command';
import { UpdateReminderConfigCommand } from './commands/update-reminder-config/update-reminder-config.command';
import { GetCollectionsDashboardQuery } from './queries/get-collections-dashboard/get-collections-dashboard.query';
import { GetPriorityListQuery } from './queries/get-priority-list/get-priority-list.query';
import { GetCollectionAnalyticsQuery } from './queries/get-collection-analytics/get-collection-analytics.query';
import { GetOutstandingAgingQuery } from './queries/get-outstanding-aging/get-outstanding-aging.query';
import { GetReminderHistoryQuery } from './queries/get-reminder-history/get-reminder-history.query';
import { GetReminderConfigQuery } from './queries/get-reminder-config/get-reminder-config.query';
import {
  vendorIdParamSchema,
  customerParamsSchema,
  setCreditSettingsSchema,
  enablePrepaidSchema,
  singleReminderSchema,
  sendBulkSchema,
  updateReminderConfigSchema,
  prioritySortQuerySchema,
  analyticsQuerySchema,
  reminderHistoryQuerySchema,
} from './credit.validator';

const isTest = process.env['NODE_ENV'] === 'test';

// === Composition Root =========================================================

const settingsRepo = new CreditSettingsRepository();
const reminderConfigRepo = new ReminderConfigRepository();
const reminderRepo = new PaymentReminderRepository();
const balanceAdapter = new CreditBalanceAdapter();
const customerAdapter = new CreditCustomerAdapter();
const deliveryControl = new DeliveryControlAdapter();
const notificationAdapter = new ReminderNotificationLogAdapter();

const setCreditSettingsCmd = new SetCreditSettingsCommand(
  settingsRepo,
  balanceAdapter,
  customerAdapter,
  deliveryControl,
  logger
);
const enablePrepaidCmd = new EnablePrepaidCommand(
  settingsRepo,
  balanceAdapter,
  customerAdapter,
  logger
);
const sendBulkRemindersCmd = new SendBulkRemindersCommand(
  reminderRepo,
  reminderConfigRepo,
  balanceAdapter,
  customerAdapter,
  notificationAdapter,
  logger
);
const sendSingleReminderCmd = new SendSingleReminderCommand(
  reminderRepo,
  reminderConfigRepo,
  balanceAdapter,
  customerAdapter,
  notificationAdapter,
  logger
);
const updateReminderConfigCmd = new UpdateReminderConfigCommand(reminderConfigRepo, logger);

const getDashboardQry = new GetCollectionsDashboardQuery(balanceAdapter, customerAdapter);
const getPriorityListQry = new GetPriorityListQuery(balanceAdapter, customerAdapter, settingsRepo);
const getAnalyticsQry = new GetCollectionAnalyticsQuery(balanceAdapter, customerAdapter);
const getAgingQry = new GetOutstandingAgingQuery(balanceAdapter, customerAdapter);
const getReminderHistoryQry = new GetReminderHistoryQuery(reminderRepo, customerAdapter);
const getReminderConfigQry = new GetReminderConfigQuery(reminderConfigRepo);

const controller = new CreditController(
  setCreditSettingsCmd,
  enablePrepaidCmd,
  sendBulkRemindersCmd,
  sendSingleReminderCmd,
  updateReminderConfigCmd,
  getDashboardQry,
  getPriorityListQry,
  getAnalyticsQry,
  getAgingQry,
  getReminderHistoryQry,
  getReminderConfigQry
);

// === Rate Limiter =============================================================

const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTest ? 1000 : 100,
  keyGenerator: (req) => req.user?.userId?.toString() ?? req.ip ?? 'unknown',
  handler: (_req, _res, next) =>
    next(new TooManyRequestsError('Too many requests. Try again later.')),
  standardHeaders: true,
  legacyHeaders: false,
});

// === Async wrapper ============================================================

const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    void fn(req, res, next);
  };

// === Router — mounted at /api/v1/vendors =====================================

const router = Router({ mergeParams: true });

// ── Collections (vendor-level read models) ────────────────────────────────────

// GET /vendors/:vendorId/collections/dashboard
router.get(
  '/:vendorId/collections/dashboard',
  authenticateToken,
  validate(vendorIdParamSchema, 'params'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.getDashboard)
);

// GET /vendors/:vendorId/collections/priority-list
router.get(
  '/:vendorId/collections/priority-list',
  authenticateToken,
  validate(vendorIdParamSchema, 'params'),
  validate(prioritySortQuerySchema, 'query'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.getPriorityList)
);

// GET /vendors/:vendorId/collections/analytics
router.get(
  '/:vendorId/collections/analytics',
  authenticateToken,
  validate(vendorIdParamSchema, 'params'),
  validate(analyticsQuerySchema, 'query'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.getAnalytics)
);

// GET /vendors/:vendorId/collections/aging
router.get(
  '/:vendorId/collections/aging',
  authenticateToken,
  validate(vendorIdParamSchema, 'params'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.getAging)
);

// ── Customer credit settings ──────────────────────────────────────────────────

// PATCH /vendors/:vendorId/customers/:customerId/credit-settings
router.patch(
  '/:vendorId/customers/:customerId/credit-settings',
  authenticateToken,
  writeLimiter,
  validate(customerParamsSchema, 'params'),
  validate(setCreditSettingsSchema, 'body'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.setCreditSettings)
);

// POST /vendors/:vendorId/customers/:customerId/enable-prepaid
router.post(
  '/:vendorId/customers/:customerId/enable-prepaid',
  authenticateToken,
  writeLimiter,
  validate(customerParamsSchema, 'params'),
  validate(enablePrepaidSchema, 'body'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.enablePrepaid)
);

// POST /vendors/:vendorId/customers/:customerId/reminders
router.post(
  '/:vendorId/customers/:customerId/reminders',
  authenticateToken,
  writeLimiter,
  validate(customerParamsSchema, 'params'),
  validate(singleReminderSchema, 'body'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.sendSingleReminder)
);

// GET /vendors/:vendorId/customers/:customerId/reminders
router.get(
  '/:vendorId/customers/:customerId/reminders',
  authenticateToken,
  validate(customerParamsSchema, 'params'),
  validate(reminderHistoryQuerySchema, 'query'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.getReminderHistory)
);

// ── Bulk reminder ─────────────────────────────────────────────────────────────

// POST /vendors/:vendorId/reminders/send-bulk
router.post(
  '/:vendorId/reminders/send-bulk',
  authenticateToken,
  writeLimiter,
  validate(vendorIdParamSchema, 'params'),
  validate(sendBulkSchema, 'body'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.sendBulkReminders)
);

// ── Reminder config ───────────────────────────────────────────────────────────

// GET /vendors/:vendorId/reminder-config
router.get(
  '/:vendorId/reminder-config',
  authenticateToken,
  validate(vendorIdParamSchema, 'params'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.getReminderConfig)
);

// PATCH /vendors/:vendorId/reminder-config
router.patch(
  '/:vendorId/reminder-config',
  authenticateToken,
  writeLimiter,
  validate(vendorIdParamSchema, 'params'),
  validate(updateReminderConfigSchema, 'body'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.updateReminderConfig)
);

export default router;
