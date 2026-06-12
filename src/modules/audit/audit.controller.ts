import { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '@/common/api-wrapper/response.util';
import { NotFoundError } from '@/common/errors/app-error';
import { RoleContext } from '@/infrastructure/middlewares/rbac/role-context';
import { ListAuditLogsQuery } from './queries/list-audit-logs.query';
import { GetConflictsQuery } from './queries/get-conflicts.query';
import { GetStaffSummaryQuery } from './queries/get-staff-summary.query';
import { GetMyActivityQuery } from './queries/get-my-activity.query';
import { ExportAuditLogsCommand } from './commands/export-audit-logs.command';
import { ExportAuditLogsInput } from './audit.validator';
import { AuditLogFilters } from './audit.types';

export interface AuditHandlers {
  list: ListAuditLogsQuery;
  conflicts: GetConflictsQuery;
  staffSummary: GetStaffSummaryQuery;
  myActivity: GetMyActivityQuery;
  export: ExportAuditLogsCommand;
}

function parseDate(raw: string | undefined): Date | undefined {
  return raw ? new Date(`${raw}T00:00:00Z`) : undefined;
}

/**
 * Audit & accountability HTTP handlers. vendorId/userId/role come from
 * req.roleContext (resolved by identifyUserRole) — never from the request body.
 */
export class AuditController {
  constructor(private readonly handlers: AuditHandlers) {}

  /**
   * @openapi
   * /vendors/{vendorId}/audit-logs:
   *   get:
   *     tags: [Audit]
   *     summary: Activity timeline with filters (owner all, staff own-only)
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - { in: path, name: vendorId, required: true, schema: { type: string } }
   *       - { in: query, name: staffId, schema: { type: string } }
   *       - { in: query, name: customerId, schema: { type: string } }
   *       - { in: query, name: actionType, schema: { type: string } }
   *       - { in: query, name: entityType, schema: { type: string } }
   *       - { in: query, name: startDate, schema: { type: string, example: '2026-04-01' } }
   *       - { in: query, name: endDate, schema: { type: string, example: '2026-04-30' } }
   *       - { in: query, name: page, schema: { type: integer } }
   *       - { in: query, name: limit, schema: { type: integer, maximum: 100 } }
   *     responses:
   *       200: { description: Paginated audit logs with filter facets }
   *       401: { description: Unauthenticated }
   *       404: { description: Vendor not found (masked) }
   */
  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ctx = this.ctx(req);
      const q = req.query as Record<string, string | undefined>;
      const startDate = parseDate(q['startDate']);
      const endDate = parseDate(q['endDate']);
      const filters: AuditLogFilters = {
        ...(q['staffId'] ? { staffId: BigInt(q['staffId']) } : {}),
        ...(q['customerId'] ? { customerId: BigInt(q['customerId']) } : {}),
        ...(q['actionType'] ? { actionType: q['actionType'] } : {}),
        ...(q['entityType'] ? { entityType: q['entityType'] } : {}),
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
        ...(q['page'] ? { page: Number(q['page']) } : {}),
        ...(q['limit'] ? { limit: Number(q['limit']) } : {}),
      };
      const result = await this.handlers.list.execute(ctx, filters);
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/audit-logs/conflicts:
   *   get:
   *     tags: [Audit]
   *     summary: Delivery action conflicts (owner only)
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - { in: path, name: vendorId, required: true, schema: { type: string } }
   *     responses:
   *       200: { description: List of staff-vs-override conflicts }
   *       403: { description: Owner only }
   *       404: { description: Vendor not found (masked) }
   */
  conflicts = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ctx = this.ctx(req);
      const result = await this.handlers.conflicts.execute(ctx);
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/audit-logs/staff-summary:
   *   get:
   *     tags: [Audit]
   *     summary: Per-staff activity aggregation (owner only)
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - { in: path, name: vendorId, required: true, schema: { type: string } }
   *       - { in: query, name: staffId, schema: { type: string } }
   *       - { in: query, name: startDate, schema: { type: string } }
   *       - { in: query, name: endDate, schema: { type: string } }
   *     responses:
   *       200: { description: Staff activity summary }
   *       403: { description: Owner only }
   *       404: { description: Vendor not found (masked) }
   */
  staffSummary = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ctx = this.ctx(req);
      const q = req.query as Record<string, string | undefined>;
      const startDate = parseDate(q['startDate']);
      const endDate = parseDate(q['endDate']);
      const result = await this.handlers.staffSummary.execute(ctx, {
        ...(q['staffId'] ? { staffId: BigInt(q['staffId']) } : {}),
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
      });
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/audit-logs/export:
   *   post:
   *     tags: [Audit]
   *     summary: Export filtered audit logs as CSV (owner only)
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - { in: path, name: vendorId, required: true, schema: { type: string } }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [format]
   *             properties:
   *               format: { type: string, enum: [csv] }
   *               staffId: { type: string }
   *               actionType: { type: string }
   *               startDate: { type: string }
   *               endDate: { type: string }
   *     responses:
   *       200: { description: CSV file download }
   *       400: { description: Unsupported format / bad date }
   *       403: { description: Owner only }
   *       404: { description: Vendor not found (masked) }
   */
  export = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ctx = this.ctx(req);
      const body = req.body as ExportAuditLogsInput;
      const startDate = parseDate(body.startDate);
      const endDate = parseDate(body.endDate);
      const result = await this.handlers.export.execute(ctx, {
        ...(body.staffId ? { staffId: BigInt(body.staffId) } : {}),
        ...(body.actionType ? { actionType: body.actionType } : {}),
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
      });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      res.status(200).send(result.csv);
    } catch (error) {
      next(error);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/audit-logs/my-activity:
   *   get:
   *     tags: [Audit]
   *     summary: The caller's own recent activity and counts
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - { in: path, name: vendorId, required: true, schema: { type: string } }
   *     responses:
   *       200: { description: Self activity with today/week/month counts }
   *       404: { description: Vendor not found (masked) }
   */
  myActivity = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ctx = this.ctx(req);
      const result = await this.handlers.myActivity.execute(ctx);
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  private ctx(req: Request): RoleContext {
    if (!req.roleContext) {
      throw new NotFoundError('Vendor not found');
    }
    return req.roleContext;
  }
}
