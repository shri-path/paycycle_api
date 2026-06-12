/**
 * Dashboard routes — composition root.
 * Mounted at /api/v1/vendors (nested under vendor scope).
 */
import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import { authenticateToken } from '@/modules/auth/auth.middleware';
import { validate } from '@/infrastructure/middlewares/validate';
import { identifyUserRole } from '@/infrastructure/middlewares/rbac/role-context';
import { requireOwnerRole } from '@/infrastructure/middlewares/rbac/require-owner';

// Repositories / services
import { DashboardReadRepository } from './database/dashboard-read.repository';
import { VendorSettingsRepository } from '../vendor-settings/database/vendor-settings.repository';
import { OutstandingAgingCalculator } from './services/outstanding-aging.calculator';
import { FinancialSummaryCalculator } from './services/financial-summary.calculator';
import { SupplyForecastCalculator } from './services/supply-forecast.calculator';

// Query handlers
import { GetOwnerDashboardQuery } from './queries/get-owner-dashboard/get-owner-dashboard.query';
import { GetStaffDashboardQuery } from './queries/get-staff-dashboard/get-staff-dashboard.query';
import { GetSupplyForecastQuery } from './queries/get-supply-forecast/get-supply-forecast.query';
import { GetOutstandingAgingQuery } from './queries/get-outstanding-aging/get-outstanding-aging.query';

// Controller + validators
import { DashboardController } from './dashboard.controller';
import {
  vendorIdParamSchema,
  staffIdParamSchema,
  ownerDashboardQuerySchema,
  supplyForecastQuerySchema,
  outstandingAgingQuerySchema,
} from './dashboard.validator';

// === Composition Root ===
const readRepo = new DashboardReadRepository();
const settingsRepo = new VendorSettingsRepository();
const agingCalc = new OutstandingAgingCalculator(readRepo);
const financialCalc = new FinancialSummaryCalculator(readRepo, agingCalc);
const forecastCalc = new SupplyForecastCalculator(readRepo);

const getOwnerDashboardQry = new GetOwnerDashboardQuery(
  readRepo,
  settingsRepo,
  financialCalc,
  forecastCalc
);
const getStaffDashboardQry = new GetStaffDashboardQuery(readRepo);
const getSupplyForecastQry = new GetSupplyForecastQuery(forecastCalc);
const getOutstandingAgingQry = new GetOutstandingAgingQuery(agingCalc);

const controller = new DashboardController(
  getOwnerDashboardQry,
  getStaffDashboardQry,
  getSupplyForecastQry,
  getOutstandingAgingQry
);

const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    void fn(req, res, next);
  };

// === Router ===
const dashboardRouter = Router({ mergeParams: true });

/**
 * GET /api/v1/vendors/:vendorId/dashboard/owner
 */
dashboardRouter.get(
  '/:vendorId/dashboard/owner',
  authenticateToken,
  validate(vendorIdParamSchema, 'params'),
  validate(ownerDashboardQuerySchema, 'query'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.getOwnerDashboard)
);

/**
 * GET /api/v1/vendors/:vendorId/dashboard/staff/:staffId
 */
dashboardRouter.get(
  '/:vendorId/dashboard/staff/:staffId',
  authenticateToken,
  validate(staffIdParamSchema, 'params'),
  identifyUserRole('vendorId'),
  asyncHandler(controller.getStaffDashboard)
);

/**
 * GET /api/v1/vendors/:vendorId/supply-forecast
 */
dashboardRouter.get(
  '/:vendorId/supply-forecast',
  authenticateToken,
  validate(vendorIdParamSchema, 'params'),
  validate(supplyForecastQuerySchema, 'query'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.getSupplyForecast)
);

/**
 * GET /api/v1/vendors/:vendorId/outstanding-aging
 */
dashboardRouter.get(
  '/:vendorId/outstanding-aging',
  authenticateToken,
  validate(vendorIdParamSchema, 'params'),
  validate(outstandingAgingQuerySchema, 'query'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.getOutstandingAging)
);

export default dashboardRouter;
