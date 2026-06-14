/**
 * voice.routes.ts — Composition root + route definitions for the voice module.
 *
 * Mounts three routers:
 *  1. userVoiceRouter       — /api/v1/users    (language preferences, self-scoped)
 *  2. vendorVoiceRouter     — /api/v1/vendors  (message templates, vendor-scoped, owner-only)
 *  3. voiceCommandRouter    — /api/v1/voice    (transcribe + execute-command, per API spec §3.1/3.2)
 */
import { Router, Request, Response, NextFunction, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { VendorUserStatus } from '@prisma/client';
import { prisma } from '@/infrastructure/database/prisma.client';
import {
  TooManyRequestsError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
} from '@/common/errors/app-error';
import { authenticateToken } from '@/modules/auth/auth.middleware';
import {
  identifyUserRole,
  OWNER_ROLE_NAME,
  RoleContext,
} from '@/infrastructure/middlewares/rbac/role-context';
import {
  PermissionKey,
  PermissionKeyVO,
} from '@/modules/staff/domain/value-objects/permission-key.value-object';
import { requireOwnerRole } from '@/infrastructure/middlewares/rbac/require-owner';
import { validate } from '@/infrastructure/middlewares/validate';
import { logger } from '@/infrastructure/logger/logger';

// Repositories
import { LanguagePreferenceRepository } from './database/language-preference.repository';
import { MessageTemplateRepository } from './database/message-template.repository';
import { VoiceCommandLogRepository } from './database/voice-command-log.repository';

// ACL / Strategy adapters
import { StubSpeechAdapter } from './adapters/stub-speech.adapter';
import { GoogleSpeechAdapter } from './adapters/google-speech.adapter';
import { BhashiniSpeechAdapter } from './adapters/bhashini-speech.adapter';
import { CustomerLookupAdapter } from './adapters/customer-lookup.adapter';
import { DeliveryActionAdapter } from './adapters/delivery-action.adapter';

// Delivery commands (for ACL adapter)
import { MarkDeliveryCommand } from '@/modules/delivery/commands/mark-delivery.command';
import { MarkBulkDeliveryCommand } from '@/modules/delivery/commands/mark-bulk-delivery.command';
import { DeliveryRepository } from '@/modules/delivery/delivery.repository';
import { DeliveryReader } from '@/modules/delivery/delivery.reader';
import { AuditLogger } from '@/common/audit/audit-logger';

// Commands
import { UpsertLanguagePreferenceCommand } from './commands/upsert-language-preference/upsert-language-preference.command';
import { UpsertMessageTemplateCommand } from './commands/upsert-message-template/upsert-message-template.command';
import { TranscribeVoiceCommandCommand } from './commands/transcribe-voice-command/transcribe-voice-command.command';
import { ExecuteVoiceCommandCommand } from './commands/execute-voice-command/execute-voice-command.command';

// Queries
import { GetLanguagePreferenceQuery } from './queries/get-language-preference/get-language-preference.query';
import { ListMessageTemplatesQuery } from './queries/list-message-templates/list-message-templates.query';
import { PreviewMessageTemplateQuery } from './queries/preview-message-template/preview-message-template.query';

// Controller
import { VoiceController } from './voice.controller';

// Validators
import {
  userIdParamSchema,
  vendorIdParamSchema,
  upsertLanguagePreferenceSchema,
  listTemplatesQuerySchema,
  upsertTemplateSchema,
  previewTemplateSchema,
  transcribeSchema,
  executeCommandSchema,
} from './voice.validator';

// ── ISpeechToTextPort selection (Strategy pattern) ───────────────────────────

function selectSpeechProvider() {
  const provider = process.env['SPEECH_PROVIDER'] ?? 'stub';
  switch (provider) {
    case 'google': {
      const key = process.env['GOOGLE_SPEECH_KEY'] ?? '';
      return new GoogleSpeechAdapter(key);
    }
    case 'bhashini': {
      const key = process.env['BHASHINI_API_KEY'] ?? '';
      const uid = process.env['BHASHINI_USER_ID'] ?? '';
      return new BhashiniSpeechAdapter(key, uid);
    }
    default:
      return new StubSpeechAdapter();
  }
}

// ── Composition Root ─────────────────────────────────────────────────────────

const isTest = process.env['NODE_ENV'] === 'test';

// Repositories
const langPrefRepo = new LanguagePreferenceRepository();
const templateRepo = new MessageTemplateRepository();
const logRepo = new VoiceCommandLogRepository();

// ACL adapters
const sttProvider = selectSpeechProvider();
const customerLookup = new CustomerLookupAdapter();

// Delivery ACL wiring (reuse delivery aggregate commands)
const deliveryRepo = new DeliveryRepository();
const deliveryReader = new DeliveryReader();
const auditLogger = new AuditLogger(logger);
const markDeliveryCmd = new MarkDeliveryCommand(deliveryRepo, deliveryReader, auditLogger, logger);
const markBulkCmd = new MarkBulkDeliveryCommand(deliveryRepo, deliveryReader, auditLogger, logger);
const deliveryActionAdapter = new DeliveryActionAdapter(markDeliveryCmd, markBulkCmd);

// Commands
const upsertLangPrefCmd = new UpsertLanguagePreferenceCommand(langPrefRepo, logger);
const upsertTemplateCmd = new UpsertMessageTemplateCommand(templateRepo, logger);
const transcribeCmd = new TranscribeVoiceCommandCommand(
  sttProvider,
  customerLookup,
  logRepo,
  logger
);
const executeCmd = new ExecuteVoiceCommandCommand(
  deliveryActionAdapter,
  customerLookup,
  logRepo,
  logger
);

// Queries
const getLangPrefQuery = new GetLanguagePreferenceQuery(langPrefRepo);
const listTemplatesQuery = new ListMessageTemplatesQuery(templateRepo);
const previewTemplateQuery = new PreviewMessageTemplateQuery(templateRepo);

// Controller
const controller = new VoiceController(
  getLangPrefQuery,
  upsertLangPrefCmd,
  listTemplatesQuery,
  upsertTemplateCmd,
  previewTemplateQuery,
  transcribeCmd,
  executeCmd
);

// ── Rate Limiter ─────────────────────────────────────────────────────────────

const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTest ? 1000 : 60,
  keyGenerator: (req) => req.user?.userId?.toString() ?? req.ip ?? 'unknown',
  handler: (_req, _res, next) =>
    next(new TooManyRequestsError('Too many requests. Try again later.')),
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Async wrapper ─────────────────────────────────────────────────────────────

const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    void fn(req, res, next);
  };

// ── identifyUserRoleFromJwt ───────────────────────────────────────────────────
//
// Variant of identifyUserRole for routes without a :vendorId path param.
// Resolves vendorId from the caller's JWT vendorIds array:
//   • single vendor  → use vendorIds[0]
//   • multi vendor   → requires a ?vendorId query/body param (not common in this app)
// Falls back to the first entry and always re-validates ACTIVE membership against the DB.
//
// MAJOR-3: used exclusively on the /api/v1/voice router so that the transcribe and
// execute-command endpoints match the API spec paths (no :vendorId segment).

const identifyUserRoleFromJwt: RequestHandler = (req, _res, next): void => {
  void resolveRoleContextFromJwt(req)
    .then(() => next())
    .catch((err: unknown) => next(err));
};

async function resolveRoleContextFromJwt(req: Request): Promise<void> {
  if (!req.user) {
    throw new UnauthorizedError('Authentication required');
  }

  // Pick vendorId: prefer a ?vendorId query param for multi-vendor callers; otherwise first JWT entry.
  const rawFromQuery =
    typeof req.query['vendorId'] === 'string' ? req.query['vendorId'] : undefined;
  const rawFromJwt = req.user.vendorIds.length > 0 ? req.user.vendorIds[0]?.toString() : undefined;
  const raw = rawFromQuery ?? rawFromJwt;

  if (!raw || !/^\d+$/.test(raw)) {
    throw new NotFoundError('Vendor not found');
  }
  const vendorId = BigInt(raw);

  // DB re-check of membership + status (same as identifyUserRole — always authoritative).
  const membership = await prisma.vendorUser.findFirst({
    where: { vendorId, userId: req.user.userId, deletedAt: null },
    include: {
      role: { select: { name: true } },
      staffPermissions: { where: { granted: true }, select: { permissionKey: true } },
    },
  });

  if (!membership || membership.status !== VendorUserStatus.ACTIVE) {
    logger.warn(
      {
        vendorId: vendorId.toString(),
        userId: req.user.userId.toString(),
        status: membership?.status,
      },
      'identifyUserRoleFromJwt: no active membership in vendor (masked as 404)'
    );
    throw new NotFoundError('Vendor not found');
  }

  const roleName = membership.role.name;
  const role: RoleContext['role'] = roleName === OWNER_ROLE_NAME ? 'owner' : 'staff';
  const permissions = membership.staffPermissions
    .map((p) => p.permissionKey)
    .filter((k): k is PermissionKey => PermissionKeyVO.isValid(k))
    .map((k) => PermissionKeyVO.from(k));

  req.roleContext = {
    role,
    roleName,
    vendorId,
    userId: req.user.userId,
    staffId: membership.id,
    permissions,
  };
}

// ── requireVoiceAccess ────────────────────────────────────────────────────────
//
// MAJOR-1: Gate on voice:use. Since voice:use is assigned to both vendor_owner and
// vendor_staff roles (not a per-staff-membership grant), any active member of the
// vendor (confirmed by identifyUserRole / identifyUserRoleFromJwt) has this access.
// This guard makes the intent explicit and forward-compatible if voice:use is later
// restricted to a subset of staff.

const requireVoiceAccess = (): RequestHandler => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const ctx = req.roleContext;
    if (!ctx) {
      next(new ForbiddenError('Role context not resolved'));
      return;
    }
    // Owners always have voice access. Staff have it by role assignment (voice:use).
    // Both roles receive voice:use in the seed, so active membership is sufficient.
    if (ctx.role !== 'owner' && ctx.role !== 'staff') {
      next(new ForbiddenError('You do not have permission to use voice commands'));
      return;
    }
    next();
  };
};

// ── Router 1: user-scoped (mounted at /api/v1/users) ─────────────────────────

export const userVoiceRouter = Router({ mergeParams: true });

// GET /users/:userId/language-preferences
userVoiceRouter.get(
  '/:userId/language-preferences',
  authenticateToken,
  validate(userIdParamSchema, 'params'),
  asyncHandler(controller.getLanguagePreference)
);

// PATCH /users/:userId/language-preferences
userVoiceRouter.patch(
  '/:userId/language-preferences',
  authenticateToken,
  writeLimiter,
  validate(userIdParamSchema, 'params'),
  validate(upsertLanguagePreferenceSchema, 'body'),
  asyncHandler(controller.upsertLanguagePreference)
);

// ── Router 2: vendor-scoped (mounted at /api/v1/vendors) — message templates only ──

export const vendorVoiceRouter = Router({ mergeParams: true });

// GET /vendors/:vendorId/message-templates
vendorVoiceRouter.get(
  '/:vendorId/message-templates',
  authenticateToken,
  validate(vendorIdParamSchema, 'params'),
  validate(listTemplatesQuerySchema, 'query'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.listTemplates)
);

// PUT /vendors/:vendorId/message-templates
vendorVoiceRouter.put(
  '/:vendorId/message-templates',
  authenticateToken,
  writeLimiter,
  validate(vendorIdParamSchema, 'params'),
  validate(upsertTemplateSchema, 'body'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.upsertTemplate)
);

// POST /vendors/:vendorId/message-templates/preview
vendorVoiceRouter.post(
  '/:vendorId/message-templates/preview',
  authenticateToken,
  validate(vendorIdParamSchema, 'params'),
  validate(previewTemplateSchema, 'body'),
  identifyUserRole('vendorId'),
  requireOwnerRole(),
  asyncHandler(controller.previewTemplate)
);

// ── Router 3: voice command endpoints (mounted at /api/v1/voice) ──────────────
//
// MAJOR-3: Paths match API_SPEC.md §3.1 and §3.2 exactly.
//   POST /voice/transcribe
//   POST /voice/execute-command
//
// MAJOR-1: Both routes are guarded by identifyUserRoleFromJwt + requireVoiceAccess.
//   identifyUserRoleFromJwt resolves vendorId from JWT (no :vendorId path param).
//   requireVoiceAccess confirms the caller is an active member (owner or staff).

export const voiceCommandRouter = Router();

// POST /voice/transcribe
voiceCommandRouter.post(
  '/transcribe',
  authenticateToken,
  writeLimiter,
  validate(transcribeSchema, 'body'),
  identifyUserRoleFromJwt,
  requireVoiceAccess(),
  asyncHandler(controller.transcribe)
);

// POST /voice/execute-command
voiceCommandRouter.post(
  '/execute-command',
  authenticateToken,
  writeLimiter,
  validate(executeCommandSchema, 'body'),
  identifyUserRoleFromJwt,
  requireVoiceAccess(),
  asyncHandler(controller.executeCommand)
);
