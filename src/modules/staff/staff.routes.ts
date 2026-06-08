import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { logger } from '@/infrastructure/logger/logger';
import { validate } from '@/infrastructure/middlewares/validate';
import { TooManyRequestsError } from '@/common/errors/app-error';
import { AuditLogger } from '@/common/audit/audit-logger';
import { authenticateToken } from '@/modules/auth/auth.middleware';
import { identifyUserRole } from '@/infrastructure/middlewares/rbac/role-context';
import { requireOwnerRole } from '@/infrastructure/middlewares/rbac/require-owner';
import { PermissionService } from '@/infrastructure/middlewares/rbac/permission.service';
import { UserRepository } from '@/modules/auth/database/user.repository';
import {
  SessionRepository,
  VendorUserRepository,
} from '@/modules/auth/database/session.repository';

import { StaffController } from './staff.controller';
import { VendorMembershipRepository } from './database/vendor-membership.repository';
import { StaffInvitationRepository } from './database/staff-invitation.repository';
import { ListAssignmentStubAdapter } from './adapters/list-assignment-stub.adapter';
import { SubscriptionLimitStubAdapter } from './adapters/subscription-limit-stub.adapter';
import { SessionRevocationHandler } from './handlers/session-revocation.handler';
import { InviteStaffService } from './commands/invite-staff/invite-staff.service';
import { UpdateStaffService } from './commands/update-staff/update-staff.service';
import { RemoveStaffService } from './commands/remove-staff/remove-staff.service';
import { AcceptInviteService } from './commands/accept-invite/accept-invite.service';
import { ListStaffService } from './queries/list-staff/list-staff.service';
import { GetStaffService } from './queries/get-staff/get-staff.service';
import { GetMyRoleService } from './queries/get-my-role/get-my-role.service';
import {
  inviteStaffSchema,
  updateStaffSchema,
  listStaffQuerySchema,
  vendorIdParamSchema,
  staffIdParamSchema,
} from './staff.validator';

const isTest = process.env['NODE_ENV'] === 'test';

// === Composition Root ===
const membershipRepository = new VendorMembershipRepository();
const invitationRepository = new StaffInvitationRepository();
const userRepository = new UserRepository();
const sessionRepository = new SessionRepository();
const vendorUserRepository = new VendorUserRepository();

const listAssignmentPort = new ListAssignmentStubAdapter(logger);
const subscriptionLimitPort = new SubscriptionLimitStubAdapter(membershipRepository);
const auditLogger = new AuditLogger(logger);
const sessionRevocation = new SessionRevocationHandler(sessionRepository, logger);

export const permissionService = new PermissionService(listAssignmentPort);

const inviteStaffService = new InviteStaffService(
  membershipRepository,
  invitationRepository,
  userRepository,
  subscriptionLimitPort,
  auditLogger,
  logger
);
const updateStaffService = new UpdateStaffService(
  membershipRepository,
  sessionRevocation,
  auditLogger,
  logger
);
const removeStaffService = new RemoveStaffService(
  membershipRepository,
  invitationRepository,
  listAssignmentPort,
  sessionRevocation,
  auditLogger,
  logger
);
const listStaffService = new ListStaffService(membershipRepository, listAssignmentPort, logger);
const getStaffService = new GetStaffService(membershipRepository, listAssignmentPort, logger);
const getMyRoleService = new GetMyRoleService(membershipRepository, logger);

/** Exported for the auth router (POST /auth/accept-invite — OQ-4). */
export const acceptInviteService = new AcceptInviteService(
  membershipRepository,
  invitationRepository,
  userRepository,
  sessionRepository,
  vendorUserRepository,
  auditLogger,
  logger
);

const controller = new StaffController(
  inviteStaffService,
  updateStaffService,
  removeStaffService,
  listStaffService,
  getStaffService,
  getMyRoleService
);

// === Rate limiter for invite (per-owner) ===
const inviteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: isTest ? 1000 : 30,
  keyGenerator: (req) => req.user?.userId?.toString() ?? req.ip ?? 'unknown',
  handler: (_req, _res, next) =>
    next(new TooManyRequestsError('Too many staff invites. Try again later.')),
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

// GET /vendors/:vendorId/role — any active member
router.get(
  '/:vendorId/role',
  authenticateToken,
  validate(vendorIdParamSchema, 'params'),
  identifyUserRole('vendorId'),
  asyncHandler(controller.getMyRole)
);

// GET /vendors/:vendorId/staff — owner only
router.get(
  '/:vendorId/staff',
  authenticateToken,
  validate(vendorIdParamSchema, 'params'),
  validate(listStaffQuerySchema, 'query'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.list)
);

// POST /vendors/:vendorId/staff/invite — owner only
router.post(
  '/:vendorId/staff/invite',
  authenticateToken,
  inviteLimiter,
  validate(vendorIdParamSchema, 'params'),
  validate(inviteStaffSchema, 'body'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.invite)
);

// GET /vendors/:vendorId/staff/:staffId — owner only
router.get(
  '/:vendorId/staff/:staffId',
  authenticateToken,
  validate(staffIdParamSchema, 'params'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.get)
);

// PATCH /vendors/:vendorId/staff/:staffId — owner only
router.patch(
  '/:vendorId/staff/:staffId',
  authenticateToken,
  validate(staffIdParamSchema, 'params'),
  validate(updateStaffSchema, 'body'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.update)
);

// DELETE /vendors/:vendorId/staff/:staffId — owner only
router.delete(
  '/:vendorId/staff/:staffId',
  authenticateToken,
  validate(staffIdParamSchema, 'params'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.remove)
);

export default router;
