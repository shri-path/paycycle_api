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
import { SupplyListAssignmentReadAdapter } from '@/modules/supply-list/adapters/supply-list-assignment-read.adapter';
import { SupplyListAssignmentWriteAdapter } from '@/modules/supply-list/adapters/supply-list-assignment-write.adapter';
import { SubscriptionLimitStubAdapter } from './adapters/subscription-limit-stub.adapter';
import { StaffNotificationLogAdapter } from './adapters/staff-notification-log.adapter';
import { SessionRevocationHandler } from './handlers/session-revocation.handler';
import { InviteStaffService } from './commands/invite-staff/invite-staff.service';
import { UpdateStaffService } from './commands/update-staff/update-staff.service';
import { RemoveStaffService } from './commands/remove-staff/remove-staff.service';
import { AcceptInviteService } from './commands/accept-invite/accept-invite.service';
import { ResendInviteService } from './commands/resend-invite/resend-invite.service';
import { UpdatePermissionsService } from './commands/update-permissions/update-permissions.service';
import { AssignListService } from './commands/assign-list/assign-list.service';
import { UnassignListService } from './commands/unassign-list/unassign-list.service';
import { ListStaffService } from './queries/list-staff/list-staff.service';
import { GetStaffService } from './queries/get-staff/get-staff.service';
import { GetMyRoleService } from './queries/get-my-role/get-my-role.service';
import {
  inviteStaffSchema,
  updateStaffSchema,
  resendInviteSchema,
  updatePermissionsSchema,
  assignListSchema,
  listStaffQuerySchema,
  vendorIdParamSchema,
  staffIdParamSchema,
  listIdParamSchema,
} from './staff.validator';

const isTest = process.env['NODE_ENV'] === 'test';

// === Composition Root ===
const membershipRepository = new VendorMembershipRepository();
const invitationRepository = new StaffInvitationRepository();
const userRepository = new UserRepository();
const sessionRepository = new SessionRepository();
const vendorUserRepository = new VendorUserRepository();

// US-005 (OQ-6): real adapters over supply_list_staff replace the fail-closed
// stubs. assign-list/unassign-list now perform real writes; StaffRemoved →
// unassignAll really clears assignments.
const listAssignmentPort = new SupplyListAssignmentReadAdapter();
const listAssignmentWritePort = new SupplyListAssignmentWriteAdapter();
const subscriptionLimitPort = new SubscriptionLimitStubAdapter(membershipRepository);
const notificationPort = new StaffNotificationLogAdapter(logger);
const auditLogger = new AuditLogger(logger);
const sessionRevocation = new SessionRevocationHandler(sessionRepository, logger);

export const permissionService = new PermissionService(listAssignmentPort);

const inviteStaffService = new InviteStaffService(
  membershipRepository,
  invitationRepository,
  userRepository,
  subscriptionLimitPort,
  notificationPort,
  auditLogger,
  logger
);
const updateStaffService = new UpdateStaffService(
  membershipRepository,
  userRepository,
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
const resendInviteService = new ResendInviteService(
  membershipRepository,
  invitationRepository,
  notificationPort,
  auditLogger,
  logger
);
const updatePermissionsService = new UpdatePermissionsService(
  membershipRepository,
  auditLogger,
  logger
);
const assignListService = new AssignListService(
  membershipRepository,
  listAssignmentWritePort,
  logger
);
const unassignListService = new UnassignListService(
  membershipRepository,
  listAssignmentWritePort,
  logger
);
const listStaffService = new ListStaffService(
  membershipRepository,
  listAssignmentPort,
  subscriptionLimitPort,
  logger
);
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
  resendInviteService,
  updatePermissionsService,
  assignListService,
  unassignListService,
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

// POST /vendors/:vendorId/staff/:staffId/resend-invitation — owner only
router.post(
  '/:vendorId/staff/:staffId/resend-invitation',
  authenticateToken,
  inviteLimiter,
  validate(staffIdParamSchema, 'params'),
  validate(resendInviteSchema, 'body'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.resend)
);

// PATCH /vendors/:vendorId/staff/:staffId/permissions — owner only
router.patch(
  '/:vendorId/staff/:staffId/permissions',
  authenticateToken,
  validate(staffIdParamSchema, 'params'),
  validate(updatePermissionsSchema, 'body'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.updatePermissions)
);

// POST /vendors/:vendorId/staff/:staffId/assign-list — owner only (gated until US-005)
router.post(
  '/:vendorId/staff/:staffId/assign-list',
  authenticateToken,
  validate(staffIdParamSchema, 'params'),
  validate(assignListSchema, 'body'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.assignList)
);

// DELETE /vendors/:vendorId/staff/:staffId/unassign-list/:listId — owner only (gated until US-005)
router.delete(
  '/:vendorId/staff/:staffId/unassign-list/:listId',
  authenticateToken,
  validate(listIdParamSchema, 'params'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.unassignList)
);

export default router;
