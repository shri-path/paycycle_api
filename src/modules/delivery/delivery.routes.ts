import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { logger } from '@/infrastructure/logger/logger';
import { validate } from '@/infrastructure/middlewares/validate';
import { TooManyRequestsError } from '@/common/errors/app-error';
import { AuditLogger } from '@/common/audit/audit-logger';
import { authenticateToken } from '@/modules/auth/auth.middleware';
import { identifyUserRole } from '@/infrastructure/middlewares/rbac/role-context';
import { requireOwnerRole } from '@/infrastructure/middlewares/rbac/require-owner';

import { DeliveryController } from './delivery.controller';
import { DeliveryService } from './delivery.service';
import { DeliveryRepository } from './delivery.repository';
import { DeliveryReader } from './delivery.reader';
import { registerDeliveryCron } from './delivery.cron';
import {
  vendorIdParamSchema,
  deliveryIdParamSchema,
  leaveIdParamSchema,
  listIdParamSchema,
  dateParamSchema,
  todayQuerySchema,
  listDeliveriesQuerySchema,
  leavesQuerySchema,
  calendarQuerySchema,
  markDeliverySchema,
  markBulkSchema,
  addExtraChargeSchema,
  createLeaveSchema,
  generateSchema,
} from './delivery.validator';

const isTest = process.env['NODE_ENV'] === 'test';

// === Composition Root ===
const repository = new DeliveryRepository();
const reader = new DeliveryReader();
const auditLogger = new AuditLogger(logger);
const service = new DeliveryService(repository, reader, auditLogger, logger);
const controller = new DeliveryController(service);

// Register cron jobs once at module load (guarded off in test + behind ENABLE_CRON).
if (!isTest) {
  registerDeliveryCron(service, reader, logger);
}

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

// 1. GET /deliveries/today — member (owner all, staff assigned)
router.get(
  '/:vendorId/deliveries/today',
  authenticateToken,
  validate(vendorIdParamSchema, 'params'),
  validate(todayQuerySchema, 'query'),
  identifyUserRole('vendorId'),
  asyncHandler(controller.today)
);

// 9. GET /deliveries/calendar — owner only
router.get(
  '/:vendorId/deliveries/calendar',
  authenticateToken,
  validate(vendorIdParamSchema, 'params'),
  validate(calendarQuerySchema, 'query'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.calendar)
);

// 10. GET /deliveries/date/:date — owner only
router.get(
  '/:vendorId/deliveries/date/:date',
  authenticateToken,
  validate(dateParamSchema, 'params'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.dateDetail)
);

// 11. POST /deliveries/generate — owner only
router.post(
  '/:vendorId/deliveries/generate',
  authenticateToken,
  writeLimiter,
  validate(vendorIdParamSchema, 'params'),
  validate(generateSchema, 'body'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.generate)
);

// 4. POST /deliveries/mark-bulk — owner or staff w/ grant (service enforces)
router.post(
  '/:vendorId/deliveries/mark-bulk',
  authenticateToken,
  writeLimiter,
  validate(vendorIdParamSchema, 'params'),
  validate(markBulkSchema, 'body'),
  identifyUserRole('vendorId'),
  asyncHandler(controller.markBulk)
);

// 3. PATCH /deliveries/:deliveryId/mark — owner or staff w/ grant (service enforces)
router.patch(
  '/:vendorId/deliveries/:deliveryId/mark',
  authenticateToken,
  writeLimiter,
  validate(deliveryIdParamSchema, 'params'),
  validate(markDeliverySchema, 'body'),
  identifyUserRole('vendorId'),
  asyncHandler(controller.mark)
);

// 2. GET /supply-lists/:listId/deliveries — member (staff must be assigned)
router.get(
  '/:vendorId/supply-lists/:listId/deliveries',
  authenticateToken,
  validate(listIdParamSchema, 'params'),
  validate(listDeliveriesQuerySchema, 'query'),
  identifyUserRole('vendorId'),
  asyncHandler(controller.listDeliveries)
);

// 5. POST /extra-charges — owner or staff w/ grant (service enforces)
router.post(
  '/:vendorId/extra-charges',
  authenticateToken,
  writeLimiter,
  validate(vendorIdParamSchema, 'params'),
  validate(addExtraChargeSchema, 'body'),
  identifyUserRole('vendorId'),
  asyncHandler(controller.addExtraCharge)
);

// 6. POST /leaves — owner or staff w/ grant (service enforces)
router.post(
  '/:vendorId/leaves',
  authenticateToken,
  writeLimiter,
  validate(vendorIdParamSchema, 'params'),
  validate(createLeaveSchema, 'body'),
  identifyUserRole('vendorId'),
  asyncHandler(controller.createLeave)
);

// 7. GET /leaves — member (staff scoped)
router.get(
  '/:vendorId/leaves',
  authenticateToken,
  validate(vendorIdParamSchema, 'params'),
  validate(leavesQuerySchema, 'query'),
  identifyUserRole('vendorId'),
  asyncHandler(controller.listLeaves)
);

// 8. DELETE /leaves/:leaveId — owner or staff w/ grant (service enforces)
router.delete(
  '/:vendorId/leaves/:leaveId',
  authenticateToken,
  writeLimiter,
  validate(leaveIdParamSchema, 'params'),
  identifyUserRole('vendorId'),
  asyncHandler(controller.cancelLeave)
);

export default router;
