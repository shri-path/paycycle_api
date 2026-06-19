/**
 * Referral routes — composition root.
 * Mounted at /api/v1/vendors (router uses mergeParams: true).
 */
import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { logger } from '@/infrastructure/logger/logger';
import { validate } from '@/infrastructure/middlewares/validate';
import { TooManyRequestsError } from '@/common/errors/app-error';
import { authenticateToken } from '@/modules/auth/auth.middleware';
import { identifyUserRole } from '@/infrastructure/middlewares/rbac/role-context';
import { requireOwnerRole } from '@/infrastructure/middlewares/rbac/require-owner';

// Repositories & Adapters
import { ReferralRepository } from './database/referral.repository';
import { CustomerCountAdapter } from './database/customer-count.adapter';
import { StubSubscriptionCreditAdapter } from './database/subscription-credit.adapter';
import { StubInviteMessageAdapter } from './database/invite-message.adapter';
import { dashboardCache } from './database/dashboard-cache.instance';

// Commands
import { CreateVendorReferralCommand } from './commands/create-vendor-referral/create-vendor-referral.command';
import { EarnCreditCommand } from './commands/earn-credit/earn-credit.command';
import { RedeemCreditCommand } from './commands/redeem-credit/redeem-credit.command';
import { BulkInviteCommand } from './commands/bulk-invite/bulk-invite.command';

// Queries
import { GetDashboardQuery } from './queries/get-dashboard/get-dashboard.query';
import { ListVendorReferralsQuery } from './queries/list-vendor-referrals/list-vendor-referrals.query';
import { GetCreditBalanceQuery } from './queries/get-credit-balance/get-credit-balance.query';
import { ListCreditTransactionsQuery } from './queries/list-transactions/list-transactions.query';
import { NearbyVendorsQuery } from './queries/nearby-vendors/nearby-vendors.query';
import { LeaderboardQuery } from './queries/leaderboard/leaderboard.query';
import { CustomerReferralsQuery } from './queries/customer-referrals/customer-referrals.query';

// Controller & Validators
import { ReferralController } from './referral.controller';
import {
  vendorIdParamSchema,
  createVendorReferralSchema,
  listVendorReferralsQuerySchema,
  listTransactionsQuerySchema,
  redeemCreditSchema,
  bulkInviteSchema,
  nearbyVendorsQuerySchema,
  leaderboardQuerySchema,
  paginationQuerySchema,
} from './referral.validator';

// Facade (exported for other modules)
import { ReferralFacade } from './referral.facade';

const isTest = process.env['NODE_ENV'] === 'test';

// === Composition Root ===
const repository = new ReferralRepository();
const customerCountAdapter = new CustomerCountAdapter();
const subscriptionCreditAdapter = new StubSubscriptionCreditAdapter();
const inviteMessageAdapter = new StubInviteMessageAdapter();

const createReferralCmd = new CreateVendorReferralCommand(repository, logger);
export const earnCreditCmd = new EarnCreditCommand(repository, dashboardCache, logger);
const redeemCreditCmd = new RedeemCreditCommand(
  repository,
  subscriptionCreditAdapter,
  dashboardCache,
  logger
);
const bulkInviteCmd = new BulkInviteCommand(repository, inviteMessageAdapter, logger);

const getDashboardQry = new GetDashboardQuery(
  repository,
  customerCountAdapter,
  dashboardCache,
  logger
);
const listReferralsQry = new ListVendorReferralsQuery(repository, customerCountAdapter, logger);
const getCreditBalanceQry = new GetCreditBalanceQuery(repository, logger);
const listTransactionsQry = new ListCreditTransactionsQuery(repository, logger);
const nearbyVendorsQry = new NearbyVendorsQuery(repository, logger);
const leaderboardQry = new LeaderboardQuery(repository, logger);
const customerReferralsQry = new CustomerReferralsQuery(repository, logger);

const controller = new ReferralController(
  createReferralCmd,
  redeemCreditCmd,
  bulkInviteCmd,
  getDashboardQry,
  listReferralsQry,
  getCreditBalanceQry,
  listTransactionsQry,
  nearbyVendorsQry,
  leaderboardQry,
  customerReferralsQry
);

// Export facade for other modules (auth/signup flow)
export const referralFacade = new ReferralFacade(repository, dashboardCache, logger);

// === Rate Limiters ===
const referralCreateLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24h
  max: isTest ? 1000 : 10,
  keyGenerator: (req) => {
    const vendorId = (req.params as Record<string, string>)['vendorId'] ?? 'unknown';
    return `referral:create:${vendorId}`;
  },
  handler: (_req, _res, next) =>
    next(new TooManyRequestsError('Referral creation rate limit exceeded (10/day)')),
  standardHeaders: true,
  legacyHeaders: false,
});

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

// === Router: mounted at /api/v1/vendors ===
export const referralRouter = Router({ mergeParams: true });

// POST /api/v1/vendors/:vendorId/referrals/vendor
referralRouter.post(
  '/:vendorId/referrals/vendor',
  authenticateToken,
  referralCreateLimiter,
  validate(vendorIdParamSchema, 'params'),
  validate(createVendorReferralSchema, 'body'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.createVendorReferral)
);

// GET /api/v1/vendors/:vendorId/referrals/dashboard
referralRouter.get(
  '/:vendorId/referrals/dashboard',
  authenticateToken,
  validate(vendorIdParamSchema, 'params'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.getDashboard)
);

// GET /api/v1/vendors/:vendorId/referrals/vendor
referralRouter.get(
  '/:vendorId/referrals/vendor',
  authenticateToken,
  validate(vendorIdParamSchema, 'params'),
  validate(listVendorReferralsQuerySchema, 'query'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.listVendorReferrals)
);

// GET /api/v1/vendors/:vendorId/referrals/leaderboard
referralRouter.get(
  '/:vendorId/referrals/leaderboard',
  authenticateToken,
  validate(vendorIdParamSchema, 'params'),
  validate(leaderboardQuerySchema, 'query'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.getLeaderboard)
);

// GET /api/v1/vendors/:vendorId/customer-referrals
referralRouter.get(
  '/:vendorId/customer-referrals',
  authenticateToken,
  validate(vendorIdParamSchema, 'params'),
  validate(paginationQuerySchema, 'query'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.getCustomerReferrals)
);

// POST /api/v1/vendors/:vendorId/customers/bulk-invite
referralRouter.post(
  '/:vendorId/customers/bulk-invite',
  authenticateToken,
  writeLimiter,
  validate(vendorIdParamSchema, 'params'),
  validate(bulkInviteSchema, 'body'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.bulkInvite)
);

// GET /api/v1/vendors/:vendorId/credits
referralRouter.get(
  '/:vendorId/credits',
  authenticateToken,
  validate(vendorIdParamSchema, 'params'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.getCreditBalance)
);

// GET /api/v1/vendors/:vendorId/credits/transactions
referralRouter.get(
  '/:vendorId/credits/transactions',
  authenticateToken,
  validate(vendorIdParamSchema, 'params'),
  validate(listTransactionsQuerySchema, 'query'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.listCreditTransactions)
);

// POST /api/v1/vendors/:vendorId/credits/redeem
referralRouter.post(
  '/:vendorId/credits/redeem',
  authenticateToken,
  writeLimiter,
  validate(vendorIdParamSchema, 'params'),
  validate(redeemCreditSchema, 'body'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.redeemCredit)
);

// GET /api/v1/vendors/:vendorId/nearby-vendors
referralRouter.get(
  '/:vendorId/nearby-vendors',
  authenticateToken,
  validate(vendorIdParamSchema, 'params'),
  validate(nearbyVendorsQuerySchema, 'query'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.nearbyVendors)
);
