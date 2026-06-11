import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { logger } from '@/infrastructure/logger/logger';
import { validate } from '@/infrastructure/middlewares/validate';
import { TooManyRequestsError } from '@/common/errors/app-error';
import { AuditLogger } from '@/common/audit/audit-logger';
import { authenticateToken } from '@/modules/auth/auth.middleware';
import { identifyUserRole } from '@/infrastructure/middlewares/rbac/role-context';
import { requireOwnerRole } from '@/infrastructure/middlewares/rbac/require-owner';

import { SupplyListController } from './supply-list.controller';
import { SupplyListRepository } from './database/supply-list.repository';
import { SubscriptionRepository } from './database/subscription.repository';
import { StaffDirectoryAdapter } from './adapters/staff-directory.adapter';
import { CustomerDirectoryAdapter } from './adapters/customer-directory.adapter';
import { DeliveryStatsZeroStubAdapter } from './adapters/delivery-stats-zero-stub.adapter';
import { CreateSupplyListService } from './commands/create-supply-list/create-supply-list.service';
import { UpdateSupplyListService } from './commands/update-supply-list/update-supply-list.service';
import { ArchiveSupplyListService } from './commands/archive-supply-list/archive-supply-list.service';
import { AssignStaffService } from './commands/assign-staff/assign-staff.service';
import { UnassignStaffService } from './commands/unassign-staff/unassign-staff.service';
import { AddCustomersService } from './commands/add-customers/add-customers.service';
import { UpdateSubscriptionService } from './commands/update-subscription/update-subscription.service';
import { EndSubscriptionService } from './commands/end-subscription/end-subscription.service';
import { ListSupplyListsService } from './queries/list-supply-lists/list-supply-lists.service';
import { GetSupplyListService } from './queries/get-supply-list/get-supply-list.service';
import { ListListCustomersService } from './queries/list-list-customers/list-list-customers.service';
import { ListAvailableCustomersService } from './queries/list-available-customers/list-available-customers.service';
import {
  vendorIdParamSchema,
  listIdParamSchema,
  listStaffParamSchema,
  subscriptionParamSchema,
  listSupplyListsQuerySchema,
  listCustomersQuerySchema,
  availableCustomersQuerySchema,
  createSupplyListSchema,
  updateSupplyListSchema,
  assignStaffSchema,
  addCustomersSchema,
  updateSubscriptionSchema,
} from './supply-list.validator';

const isTest = process.env['NODE_ENV'] === 'test';

// === Composition Root ===
const supplyListRepository = new SupplyListRepository();
const subscriptionRepository = new SubscriptionRepository();
const staffDirectory = new StaffDirectoryAdapter();
const customerDirectory = new CustomerDirectoryAdapter();
// Stub until US-006 swaps the real DeliveryStats adapter here.
const deliveryStats = new DeliveryStatsZeroStubAdapter();
const auditLogger = new AuditLogger(logger);

const createService = new CreateSupplyListService(
  supplyListRepository,
  staffDirectory,
  deliveryStats,
  auditLogger,
  logger
);
const updateService = new UpdateSupplyListService(
  supplyListRepository,
  deliveryStats,
  auditLogger,
  logger
);
const archiveService = new ArchiveSupplyListService(supplyListRepository, auditLogger, logger);
const assignStaffService = new AssignStaffService(
  supplyListRepository,
  staffDirectory,
  deliveryStats,
  auditLogger,
  logger
);
const unassignStaffService = new UnassignStaffService(
  supplyListRepository,
  deliveryStats,
  auditLogger,
  logger
);
const addCustomersService = new AddCustomersService(
  supplyListRepository,
  subscriptionRepository,
  customerDirectory,
  auditLogger,
  logger
);
const updateSubscriptionService = new UpdateSubscriptionService(
  supplyListRepository,
  subscriptionRepository,
  customerDirectory,
  auditLogger,
  logger
);
const endSubscriptionService = new EndSubscriptionService(
  supplyListRepository,
  subscriptionRepository,
  auditLogger,
  logger
);
const listService = new ListSupplyListsService(supplyListRepository, deliveryStats, logger);
const getService = new GetSupplyListService(supplyListRepository, deliveryStats, logger);
const listCustomersService = new ListListCustomersService(
  supplyListRepository,
  subscriptionRepository,
  customerDirectory,
  logger
);
const availableCustomersService = new ListAvailableCustomersService(
  supplyListRepository,
  subscriptionRepository,
  customerDirectory,
  logger
);

const controller = new SupplyListController(
  createService,
  updateService,
  archiveService,
  assignStaffService,
  unassignStaffService,
  addCustomersService,
  updateSubscriptionService,
  endSubscriptionService,
  listService,
  getService,
  listCustomersService,
  availableCustomersService
);

// Per-owner write rate limiter (consistent with staff routes).
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

// === Routes — mounted at /api/v1/vendors ===
const router = Router({ mergeParams: true });

// GET /supply-lists — any active member (owner all / staff assigned)
router.get(
  '/:vendorId/supply-lists',
  authenticateToken,
  validate(vendorIdParamSchema, 'params'),
  validate(listSupplyListsQuerySchema, 'query'),
  identifyUserRole('vendorId'),
  asyncHandler(controller.list)
);

// POST /supply-lists — owner only
router.post(
  '/:vendorId/supply-lists',
  authenticateToken,
  writeLimiter,
  validate(vendorIdParamSchema, 'params'),
  validate(createSupplyListSchema, 'body'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.create)
);

// GET /supply-lists/:listId — owner or assigned staff (service 404-masks)
router.get(
  '/:vendorId/supply-lists/:listId',
  authenticateToken,
  validate(listIdParamSchema, 'params'),
  identifyUserRole('vendorId'),
  asyncHandler(controller.get)
);

// PATCH /supply-lists/:listId — owner only
router.patch(
  '/:vendorId/supply-lists/:listId',
  authenticateToken,
  writeLimiter,
  validate(listIdParamSchema, 'params'),
  validate(updateSupplyListSchema, 'body'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.update)
);

// DELETE /supply-lists/:listId — owner only (archive)
router.delete(
  '/:vendorId/supply-lists/:listId',
  authenticateToken,
  writeLimiter,
  validate(listIdParamSchema, 'params'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.archive)
);

// POST /supply-lists/:listId/staff — owner only
router.post(
  '/:vendorId/supply-lists/:listId/staff',
  authenticateToken,
  writeLimiter,
  validate(listIdParamSchema, 'params'),
  validate(assignStaffSchema, 'body'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.assignStaff)
);

// DELETE /supply-lists/:listId/staff/:staffId — owner only
router.delete(
  '/:vendorId/supply-lists/:listId/staff/:staffId',
  authenticateToken,
  writeLimiter,
  validate(listStaffParamSchema, 'params'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.unassignStaff)
);

// GET /supply-lists/:listId/customers — owner or assigned staff
router.get(
  '/:vendorId/supply-lists/:listId/customers',
  authenticateToken,
  validate(listIdParamSchema, 'params'),
  validate(listCustomersQuerySchema, 'query'),
  identifyUserRole('vendorId'),
  asyncHandler(controller.listCustomers)
);

// GET /supply-lists/:listId/available-customers — owner only
router.get(
  '/:vendorId/supply-lists/:listId/available-customers',
  authenticateToken,
  validate(listIdParamSchema, 'params'),
  validate(availableCustomersQuerySchema, 'query'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.availableCustomers)
);

// POST /supply-lists/:listId/customers — owner only
router.post(
  '/:vendorId/supply-lists/:listId/customers',
  authenticateToken,
  writeLimiter,
  validate(listIdParamSchema, 'params'),
  validate(addCustomersSchema, 'body'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.addCustomers)
);

// PATCH /supply-lists/:listId/customers/:subscriptionId — owner only
router.patch(
  '/:vendorId/supply-lists/:listId/customers/:subscriptionId',
  authenticateToken,
  writeLimiter,
  validate(subscriptionParamSchema, 'params'),
  validate(updateSubscriptionSchema, 'body'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.updateSubscription)
);

// DELETE /supply-lists/:listId/customers/:subscriptionId — owner only
router.delete(
  '/:vendorId/supply-lists/:listId/customers/:subscriptionId',
  authenticateToken,
  writeLimiter,
  validate(subscriptionParamSchema, 'params'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.endSubscription)
);

export default router;
