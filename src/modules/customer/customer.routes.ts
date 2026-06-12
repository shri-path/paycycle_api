import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { logger } from '@/infrastructure/logger/logger';
import { validate } from '@/infrastructure/middlewares/validate';
import { TooManyRequestsError } from '@/common/errors/app-error';
import { authenticateToken } from '@/modules/auth/auth.middleware';
import { identifyUserRole } from '@/infrastructure/middlewares/rbac/role-context';
import { requireOwnerRole } from '@/infrastructure/middlewares/rbac/require-owner';

import { CustomerController } from './customer.controller';
import { CustomerRepository } from './database/customer.repository';
import { DeliveryBillingAdapter } from './adapters/delivery-billing.adapter';
import { PlanRepository } from '@/modules/subscription/database/plan.repository';
import { SubscriptionRepository } from '@/modules/subscription/database/subscription.repository';
import { UsageQueryService } from '@/modules/subscription/services/usage-query.service';
import { enforceSubscriptionLimit } from '@/infrastructure/middlewares/subscription/enforce-subscription-limit';
import { CreateCustomerCommand } from './commands/create-customer/create-customer.command';
import { UpdateCustomerCommand } from './commands/update-customer/update-customer.command';
import { DeactivateCustomerCommand } from './commands/deactivate-customer/deactivate-customer.command';
import { UpdateCreditLimitCommand } from './commands/update-credit-limit/update-credit-limit.command';
import { RecordPaymentCommand } from './commands/record-payment/record-payment.command';
import { AddSubscriptionCommand } from './commands/add-subscription/add-subscription.command';
import { RemoveSubscriptionCommand } from './commands/remove-subscription/remove-subscription.command';
import { ListCustomersQuery } from './queries/list-customers/list-customers.query';
import { GetCustomerQuery } from './queries/get-customer/get-customer.query';
import { GetCustomerBillQuery } from './queries/get-customer-bill/get-customer-bill.query';
import { GetCustomerCalendarQuery } from './queries/get-customer-calendar/get-customer-calendar.query';
import { ListPaymentsQuery } from './queries/list-payments/list-payments.query';
import {
  vendorIdParamSchema,
  customerParamsSchema,
  monthParamsSchema,
  subscriptionParamsSchema,
  createCustomerSchema,
  updateCustomerSchema,
  recordPaymentSchema,
  updateCreditLimitSchema,
  addSubscriptionSchema,
  listCustomersQuerySchema,
  listPaymentsQuerySchema,
} from './customer.validator';

const isTest = process.env['NODE_ENV'] === 'test';

// === Composition Root ===
const repository = new CustomerRepository();
const billingAdapter = new DeliveryBillingAdapter();

// Subscription limit enforcement (US-009)
const subscriptionPlanRepo = new PlanRepository();
const vendorSubscriptionRepo = new SubscriptionRepository();
const usageQueryService = new UsageQueryService();
const customerLimitMiddleware = enforceSubscriptionLimit(
  'customers',
  vendorSubscriptionRepo,
  subscriptionPlanRepo,
  usageQueryService
);

const createCustomerCmd = new CreateCustomerCommand(repository, billingAdapter, logger);
const updateCustomerCmd = new UpdateCustomerCommand(repository, billingAdapter, logger);
const deactivateCustomerCmd = new DeactivateCustomerCommand(repository, logger);
const updateCreditLimitCmd = new UpdateCreditLimitCommand(repository, billingAdapter, logger);
const recordPaymentCmd = new RecordPaymentCommand(repository, logger);
const addSubscriptionCmd = new AddSubscriptionCommand(repository, logger);
const removeSubscriptionCmd = new RemoveSubscriptionCommand(repository, logger);

const listCustomersQry = new ListCustomersQuery(repository, billingAdapter);
const getCustomerQry = new GetCustomerQuery(repository, billingAdapter);
const getCustomerBillQry = new GetCustomerBillQuery(repository, billingAdapter);
const getCustomerCalendarQry = new GetCustomerCalendarQuery(repository, billingAdapter);
const listPaymentsQry = new ListPaymentsQuery(repository);

const controller = new CustomerController(
  createCustomerCmd,
  updateCustomerCmd,
  deactivateCustomerCmd,
  updateCreditLimitCmd,
  recordPaymentCmd,
  addSubscriptionCmd,
  removeSubscriptionCmd,
  listCustomersQry,
  getCustomerQry,
  getCustomerBillQry,
  getCustomerCalendarQry,
  listPaymentsQry
);

// === Rate Limiters ===
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTest ? 1000 : 100,
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

// GET /vendors/:vendorId/customers — owner or staff
router.get(
  '/:vendorId/customers',
  authenticateToken,
  validate(vendorIdParamSchema, 'params'),
  validate(listCustomersQuerySchema, 'query'),
  identifyUserRole('vendorId'),
  asyncHandler(controller.listCustomers)
);

// POST /vendors/:vendorId/customers — owner only
router.post(
  '/:vendorId/customers',
  authenticateToken,
  writeLimiter,
  validate(vendorIdParamSchema, 'params'),
  validate(createCustomerSchema, 'body'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  customerLimitMiddleware,
  asyncHandler(controller.createCustomer)
);

// GET /vendors/:vendorId/customers/:customerId — owner or staff
router.get(
  '/:vendorId/customers/:customerId',
  authenticateToken,
  validate(customerParamsSchema, 'params'),
  identifyUserRole('vendorId'),
  asyncHandler(controller.getCustomer)
);

// PATCH /vendors/:vendorId/customers/:customerId — owner only
router.patch(
  '/:vendorId/customers/:customerId',
  authenticateToken,
  writeLimiter,
  validate(customerParamsSchema, 'params'),
  validate(updateCustomerSchema, 'body'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.updateCustomer)
);

// DELETE /vendors/:vendorId/customers/:customerId — owner only
router.delete(
  '/:vendorId/customers/:customerId',
  authenticateToken,
  validate(customerParamsSchema, 'params'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.deactivateCustomer)
);

// GET /vendors/:vendorId/customers/:customerId/bill/:month — owner only
router.get(
  '/:vendorId/customers/:customerId/bill/:month',
  authenticateToken,
  validate(monthParamsSchema, 'params'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.getCustomerBill)
);

// POST /vendors/:vendorId/customers/:customerId/payments — owner only
router.post(
  '/:vendorId/customers/:customerId/payments',
  authenticateToken,
  writeLimiter,
  validate(customerParamsSchema, 'params'),
  validate(recordPaymentSchema, 'body'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.recordPayment)
);

// GET /vendors/:vendorId/customers/:customerId/payments — owner only
router.get(
  '/:vendorId/customers/:customerId/payments',
  authenticateToken,
  validate(customerParamsSchema, 'params'),
  validate(listPaymentsQuerySchema, 'query'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.listPayments)
);

// PATCH /vendors/:vendorId/customers/:customerId/credit-limit — owner only
router.patch(
  '/:vendorId/customers/:customerId/credit-limit',
  authenticateToken,
  validate(customerParamsSchema, 'params'),
  validate(updateCreditLimitSchema, 'body'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.updateCreditLimit)
);

// GET /vendors/:vendorId/customers/:customerId/calendar/:month — owner or staff
router.get(
  '/:vendorId/customers/:customerId/calendar/:month',
  authenticateToken,
  validate(monthParamsSchema, 'params'),
  identifyUserRole('vendorId'),
  asyncHandler(controller.getCustomerCalendar)
);

// POST /vendors/:vendorId/customers/:customerId/subscriptions — owner only
router.post(
  '/:vendorId/customers/:customerId/subscriptions',
  authenticateToken,
  writeLimiter,
  validate(customerParamsSchema, 'params'),
  validate(addSubscriptionSchema, 'body'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.addSubscription)
);

// DELETE /vendors/:vendorId/customers/:customerId/subscriptions/:subscriptionId — owner only
router.delete(
  '/:vendorId/customers/:customerId/subscriptions/:subscriptionId',
  authenticateToken,
  validate(subscriptionParamsSchema, 'params'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.removeSubscription)
);

export default router;
