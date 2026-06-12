import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import { validate } from '@/infrastructure/middlewares/validate';
import { authenticateToken } from '@/modules/auth/auth.middleware';
import { identifyUserRole } from '@/infrastructure/middlewares/rbac/role-context';
import { requireOwnerRole } from '@/infrastructure/middlewares/rbac/require-owner';

import { AuditController } from './audit.controller';
import { AuditRepository } from './audit.repository';
import { AuditReader } from './audit.reader';
import { ListAuditLogsQuery } from './queries/list-audit-logs.query';
import { GetConflictsQuery } from './queries/get-conflicts.query';
import { GetStaffSummaryQuery } from './queries/get-staff-summary.query';
import { GetMyActivityQuery } from './queries/get-my-activity.query';
import { ExportAuditLogsCommand } from './commands/export-audit-logs.command';
import {
  vendorIdParamSchema,
  listAuditLogsQuerySchema,
  staffSummaryQuerySchema,
  conflictsQuerySchema,
  exportAuditLogsBodySchema,
} from './audit.validator';

// === Composition Root ===
const repository = new AuditRepository();
const reader = new AuditReader();

const controller = new AuditController({
  list: new ListAuditLogsQuery(repository, reader),
  conflicts: new GetConflictsQuery(repository, reader),
  staffSummary: new GetStaffSummaryQuery(repository, reader),
  myActivity: new GetMyActivityQuery(repository, reader),
  export: new ExportAuditLogsCommand(repository, reader),
});

const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    void fn(req, res, next);
  };

// === Routes — mounted at /api/v1/vendors ===
const router = Router({ mergeParams: true });

// 2. GET /audit-logs/conflicts — owner only
router.get(
  '/:vendorId/audit-logs/conflicts',
  authenticateToken,
  validate(vendorIdParamSchema, 'params'),
  validate(conflictsQuerySchema, 'query'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.conflicts)
);

// 3. GET /audit-logs/staff-summary — owner only
router.get(
  '/:vendorId/audit-logs/staff-summary',
  authenticateToken,
  validate(vendorIdParamSchema, 'params'),
  validate(staffSummaryQuerySchema, 'query'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.staffSummary)
);

// 5. GET /audit-logs/my-activity — owner or staff (self-scoped)
router.get(
  '/:vendorId/audit-logs/my-activity',
  authenticateToken,
  validate(vendorIdParamSchema, 'params'),
  identifyUserRole('vendorId'),
  asyncHandler(controller.myActivity)
);

// 4. POST /audit-logs/export — owner only
router.post(
  '/:vendorId/audit-logs/export',
  authenticateToken,
  validate(vendorIdParamSchema, 'params'),
  validate(exportAuditLogsBodySchema, 'body'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.export)
);

// 1. GET /audit-logs — owner (all) / staff (own only)
router.get(
  '/:vendorId/audit-logs',
  authenticateToken,
  validate(vendorIdParamSchema, 'params'),
  validate(listAuditLogsQuerySchema, 'query'),
  identifyUserRole('vendorId'),
  asyncHandler(controller.list)
);

export default router;
