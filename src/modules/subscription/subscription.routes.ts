/**
 * Subscription routes — composition root.
 * Two routers exported:
 *   subscriptionPlansRouter → mounted at /api/v1 (no vendor prefix)
 *   subscriptionRouter      → mounted at /api/v1/vendors
 */
import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { logger } from '@/infrastructure/logger/logger';
import { validate } from '@/infrastructure/middlewares/validate';
import { TooManyRequestsError } from '@/common/errors/app-error';
import { authenticateToken } from '@/modules/auth/auth.middleware';
import { identifyUserRole } from '@/infrastructure/middlewares/rbac/role-context';
import { requireOwnerRole } from '@/infrastructure/middlewares/rbac/require-owner';

// Repositories / adapters
import { PlanRepository } from './database/plan.repository';
import { SubscriptionRepository } from './database/subscription.repository';
import { UsageQueryService } from './services/usage-query.service';
import { StubPaymentGateway } from './services/payment/stub-payment-gateway';

// Commands
import { AssignStarterPlanCommand } from './commands/assign-starter-plan/assign-starter-plan.command';
import { UpgradeSubscriptionCommand } from './commands/upgrade-subscription/upgrade-subscription.command';
import { RenewSubscriptionCommand } from './commands/renew-subscription/renew-subscription.command';
import { CancelSubscriptionCommand } from './commands/cancel-subscription/cancel-subscription.command';
import { SetAutoRenewalCommand } from './commands/set-auto-renewal/set-auto-renewal.command';

// Queries
import { ListPlansQuery } from './queries/list-plans/list-plans.query';
import { GetVendorSubscriptionQuery } from './queries/get-vendor-subscription/get-vendor-subscription.query';
import { ListInvoicesQuery } from './queries/list-invoices/list-invoices.query';
import { ListSubscriptionHistoryQuery } from './queries/list-subscription-history/list-subscription-history.query';

// Controller + validators
import { SubscriptionController } from './subscription.controller';
import {
  vendorIdParamSchema,
  upgradeSchema,
  renewSchema,
  autoRenewalSchema,
  paginationQuerySchema,
} from './subscription.validator';

const isTest = process.env['NODE_ENV'] === 'test';

// === Composition Root ===
const planRepo = new PlanRepository();
const subscriptionRepo = new SubscriptionRepository();
const usageService = new UsageQueryService();
const paymentGateway = new StubPaymentGateway();

export const assignStarterPlanCommand = new AssignStarterPlanCommand(
  subscriptionRepo,
  planRepo,
  logger
);

const upgradeCmd = new UpgradeSubscriptionCommand(
  subscriptionRepo,
  planRepo,
  paymentGateway,
  logger
);
const renewCmd = new RenewSubscriptionCommand(subscriptionRepo, planRepo, paymentGateway, logger);
const cancelCmd = new CancelSubscriptionCommand(subscriptionRepo, logger);
const setAutoRenewalCmd = new SetAutoRenewalCommand(subscriptionRepo, logger);

const listPlansQry = new ListPlansQuery(planRepo);
const getVendorSubscriptionQry = new GetVendorSubscriptionQuery(
  subscriptionRepo,
  planRepo,
  usageService
);
const listInvoicesQry = new ListInvoicesQuery(subscriptionRepo);
const listHistoryQry = new ListSubscriptionHistoryQuery(subscriptionRepo, planRepo);

const controller = new SubscriptionController(
  listPlansQry,
  getVendorSubscriptionQry,
  listInvoicesQry,
  listHistoryQry,
  upgradeCmd,
  renewCmd,
  cancelCmd,
  setAutoRenewalCmd
);

// === Rate Limiters ===
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

// === Router 1: Plan Catalog (not vendor-scoped) ===
// Mounted at /api/v1 → path becomes /api/v1/subscription-plans
export const subscriptionPlansRouter = Router();

/**
 * GET /api/v1/subscription-plans
 */
subscriptionPlansRouter.get(
  '/subscription-plans',
  authenticateToken,
  asyncHandler(controller.listPlans)
);

// === Router 2: Vendor subscription (nested under /api/v1/vendors) ===
export const subscriptionRouter = Router({ mergeParams: true });

/**
 * GET /api/v1/vendors/:vendorId/subscription
 */
subscriptionRouter.get(
  '/:vendorId/subscription',
  authenticateToken,
  validate(vendorIdParamSchema, 'params'),
  identifyUserRole('vendorId'),
  asyncHandler(controller.getSubscription)
);

/**
 * POST /api/v1/vendors/:vendorId/subscription/upgrade
 */
subscriptionRouter.post(
  '/:vendorId/subscription/upgrade',
  authenticateToken,
  writeLimiter,
  validate(vendorIdParamSchema, 'params'),
  validate(upgradeSchema, 'body'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.upgrade)
);

/**
 * POST /api/v1/vendors/:vendorId/subscription/renew
 */
subscriptionRouter.post(
  '/:vendorId/subscription/renew',
  authenticateToken,
  writeLimiter,
  validate(vendorIdParamSchema, 'params'),
  validate(renewSchema, 'body'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.renew)
);

/**
 * POST /api/v1/vendors/:vendorId/subscription/cancel
 */
subscriptionRouter.post(
  '/:vendorId/subscription/cancel',
  authenticateToken,
  writeLimiter,
  validate(vendorIdParamSchema, 'params'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.cancel)
);

/**
 * PATCH /api/v1/vendors/:vendorId/subscription/auto-renewal
 */
subscriptionRouter.patch(
  '/:vendorId/subscription/auto-renewal',
  authenticateToken,
  writeLimiter,
  validate(vendorIdParamSchema, 'params'),
  validate(autoRenewalSchema, 'body'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.toggleAutoRenewal)
);

/**
 * GET /api/v1/vendors/:vendorId/subscription/invoices
 */
subscriptionRouter.get(
  '/:vendorId/subscription/invoices',
  authenticateToken,
  validate(vendorIdParamSchema, 'params'),
  validate(paginationQuerySchema, 'query'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.listInvoices)
);

/**
 * GET /api/v1/vendors/:vendorId/subscription/history
 */
subscriptionRouter.get(
  '/:vendorId/subscription/history',
  authenticateToken,
  validate(vendorIdParamSchema, 'params'),
  validate(paginationQuerySchema, 'query'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.listHistory)
);
