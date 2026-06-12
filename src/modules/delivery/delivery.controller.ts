import { Request, Response, NextFunction } from 'express';
import { DailySupplyStatus } from '@prisma/client';
import { sendSuccess, sendCreated } from '@/common/api-wrapper/response.util';
import { NotFoundError } from '@/common/errors/app-error';
import { RoleContext } from '@/infrastructure/middlewares/rbac/role-context';
import { DeliveryService, appToday } from './delivery.service';
import {
  AddExtraChargeInput,
  CreateLeaveInput,
  GenerateInput,
  MarkBulkInput,
  MarkDeliveryInput,
} from './delivery.validator';

/**
 * Delivery tracking HTTP handlers. vendorId/actorUserId/role come from
 * req.roleContext (resolved by identifyUserRole) — never from the request body.
 */
export class DeliveryController {
  constructor(private readonly service: DeliveryService) {}

  /**
   * @openapi
   * /vendors/{vendorId}/deliveries/today:
   *   get:
   *     tags: [Deliveries]
   *     summary: List today's deliveries summarized by supply list with conflicts
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - { in: path, name: vendorId, required: true, schema: { type: string } }
   *       - { in: query, name: date, schema: { type: string, example: '2026-04-12' } }
   *       - { in: query, name: listId, schema: { type: string } }
   *       - { in: query, name: staffId, schema: { type: string } }
   *     responses:
   *       200: { description: Today summary with per-list breakdown and conflicts }
   *       401: { description: Unauthenticated }
   *       404: { description: Vendor not found (masked) }
   */
  today = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ctx = this.ctx(req);
      const q = req.query as Record<string, string | undefined>;
      const result = await this.service.getToday(ctx, {
        ...(q['date'] ? { date: q['date'] } : {}),
        ...(q['listId'] ? { listId: BigInt(q['listId']) } : {}),
      });
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/supply-lists/{listId}/deliveries:
   *   get:
   *     tags: [Deliveries]
   *     summary: List per-customer deliveries for a list on a date
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - { in: path, name: vendorId, required: true, schema: { type: string } }
   *       - { in: path, name: listId, required: true, schema: { type: string } }
   *       - { in: query, name: date, schema: { type: string } }
   *       - { in: query, name: status, schema: { type: string, enum: [PENDING, DELIVERED, LEAVE, AUTO_MARKED, CANCELLED] } }
   *       - { in: query, name: search, schema: { type: string } }
   *     responses:
   *       200: { description: Per-customer delivery cards with progress }
   *       404: { description: List not found or staff not assigned (masked) }
   */
  listDeliveries = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ctx = this.ctx(req);
      const listId = this.parseId(req.params['listId'], 'Supply list not found');
      const q = req.query as Record<string, string | undefined>;
      const result = await this.service.getListDeliveries(ctx, listId, {
        ...(q['date'] ? { date: q['date'] } : {}),
        ...(q['status'] ? { status: q['status'] as DailySupplyStatus } : {}),
        ...(q['search'] ? { search: q['search'] } : {}),
      });
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/deliveries/{deliveryId}/mark:
   *   patch:
   *     tags: [Deliveries]
   *     summary: Mark a delivery as delivered or leave
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - { in: path, name: vendorId, required: true, schema: { type: string } }
   *       - { in: path, name: deliveryId, required: true, schema: { type: string } }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [status]
   *             properties:
   *               status: { type: string, enum: [DELIVERED, LEAVE] }
   *               quantity: { type: number, minimum: 0 }
   *     responses:
   *       200: { description: Updated delivery with conflict flag }
   *       400: { description: Validation error }
   *       403: { description: Staff missing grant }
   *       404: { description: Delivery not found (masked) }
   *       422: { description: Invalid status transition }
   */
  mark = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ctx = this.ctx(req);
      const deliveryId = this.parseId(req.params['deliveryId'], 'Delivery not found');
      const body = req.body as MarkDeliveryInput;
      const result = await this.service.markDelivery(
        ctx,
        deliveryId,
        {
          status: body.status,
          ...(body.quantity !== undefined ? { quantity: body.quantity } : {}),
        },
        this.meta(req)
      );
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/deliveries/mark-bulk:
   *   post:
   *     tags: [Deliveries]
   *     summary: Bulk-mark all pending deliveries in a list for a date
   *     security: [{ bearerAuth: [] }]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [supplyListId, date, status]
   *             properties:
   *               supplyListId: { type: string }
   *               date: { type: string, example: '2026-04-12' }
   *               status: { type: string, enum: [DELIVERED] }
   *               excludeDeliveryIds: { type: array, items: { type: string } }
   *     responses:
   *       200: { description: Count of updated and skipped deliveries }
   *       403: { description: Staff missing grant }
   *       404: { description: List not found / staff not assigned (masked) }
   */
  markBulk = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ctx = this.ctx(req);
      const body = req.body as MarkBulkInput;
      const result = await this.service.markBulk(
        ctx,
        {
          supplyListId: BigInt(body.supplyListId),
          date: new Date(`${body.date}T00:00:00Z`),
          excludeDeliveryIds: (body.excludeDeliveryIds ?? []).map((id) => BigInt(id)),
        },
        this.meta(req)
      );
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/extra-charges:
   *   post:
   *     tags: [Extra Charges]
   *     summary: Add an extra charge to a daily supply
   *     security: [{ bearerAuth: [] }]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [dailySupplyId, amount, comment]
   *             properties:
   *               dailySupplyId: { type: string }
   *               amount: { type: number, description: 'non-zero; negative = discount' }
   *               comment: { type: string, maxLength: 500 }
   *     responses:
   *       201: { description: Created extra charge }
   *       403: { description: Staff missing grant }
   *       404: { description: Daily supply not found (masked) }
   *       422: { description: Charge on a leave/cancelled supply }
   */
  addExtraCharge = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ctx = this.ctx(req);
      const body = req.body as AddExtraChargeInput;
      const result = await this.service.addExtraCharge(
        ctx,
        { dailySupplyId: BigInt(body.dailySupplyId), amount: body.amount, comment: body.comment },
        this.meta(req)
      );
      sendCreated(res, result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/leaves:
   *   post:
   *     tags: [Leaves]
   *     summary: Record a planned leave across one or more lists
   *     security: [{ bearerAuth: [] }]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [customerId, supplyListIds, startDate, endDate]
   *             properties:
   *               customerId: { type: string }
   *               supplyListIds: { type: array, items: { type: string } }
   *               startDate: { type: string, example: '2026-04-15' }
   *               endDate: { type: string, example: '2026-04-17' }
   *               reason: { type: string }
   *     responses:
   *       201: { description: Created leaves and affected deliveries count }
   *       403: { description: Staff missing grant }
   *       422: { description: No active subscription on a list }
   */
  createLeave = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ctx = this.ctx(req);
      const body = req.body as CreateLeaveInput;
      const result = await this.service.createLeave(
        ctx,
        {
          customerId: BigInt(body.customerId),
          supplyListIds: body.supplyListIds.map((id) => BigInt(id)),
          startDate: new Date(`${body.startDate}T00:00:00Z`),
          endDate: new Date(`${body.endDate}T00:00:00Z`),
          reason: body.reason ?? null,
        },
        this.meta(req)
      );
      sendCreated(res, result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/leaves:
   *   get:
   *     tags: [Leaves]
   *     summary: List today's and upcoming leaves
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - { in: query, name: status, schema: { type: string, enum: [today, upcoming] } }
   *       - { in: query, name: staffId, schema: { type: string } }
   *     responses:
   *       200: { description: Today and upcoming leaves }
   */
  listLeaves = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ctx = this.ctx(req);
      const q = req.query as Record<string, string | undefined>;
      const result = await this.service.getLeaves(ctx, {
        ...(q['status'] ? { status: q['status'] as 'today' | 'upcoming' } : {}),
      });
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/leaves/{leaveId}:
   *   delete:
   *     tags: [Leaves]
   *     summary: Cancel a future leave
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - { in: path, name: leaveId, required: true, schema: { type: string } }
   *     responses:
   *       200: { description: Count of reverted deliveries }
   *       403: { description: Staff missing grant }
   *       404: { description: Leave not found or not future (masked) }
   */
  cancelLeave = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ctx = this.ctx(req);
      const leaveId = this.parseId(req.params['leaveId'], 'Leave not found');
      const result = await this.service.cancelLeave(ctx, leaveId, this.meta(req));
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/deliveries/calendar:
   *   get:
   *     tags: [Deliveries]
   *     summary: Month calendar of delivery status by day (owner)
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - { in: query, name: month, required: true, schema: { type: string, example: '2026-04' } }
   *       - { in: query, name: listId, schema: { type: string } }
   *       - { in: query, name: customerId, schema: { type: string } }
   *     responses:
   *       200: { description: Calendar days keyed by date }
   *       403: { description: Owner only }
   */
  calendar = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ctx = this.ctx(req);
      const q = req.query as Record<string, string | undefined>;
      const result = await this.service.getCalendar(ctx, {
        month: q['month'] as string,
        ...(q['listId'] ? { listId: BigInt(q['listId']) } : {}),
      });
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/deliveries/date/{date}:
   *   get:
   *     tags: [Deliveries]
   *     summary: Day detail breakdown by list, charges, leaves (owner)
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - { in: path, name: date, required: true, schema: { type: string, example: '2026-04-07' } }
   *     responses:
   *       200: { description: Day detail }
   *       403: { description: Owner only }
   */
  dateDetail = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ctx = this.ctx(req);
      const date = req.params['date'] as string;
      const result = await this.service.getDateDetail(ctx, date);
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/deliveries/generate:
   *   post:
   *     tags: [Deliveries]
   *     summary: Manually generate daily supplies for a date (owner)
   *     security: [{ bearerAuth: [] }]
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               date: { type: string, example: '2026-04-12' }
   *     responses:
   *       202: { description: Generation summary }
   *       403: { description: Owner only }
   */
  generate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ctx = this.ctx(req);
      const body = req.body as GenerateInput;
      const date = body.date ? new Date(`${body.date}T00:00:00Z`) : appToday();
      const result = await this.service.generate(ctx, date, this.meta(req));
      sendSuccess(res, result, 202);
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

  private meta(req: Request): { ip: string | null; userAgent: string | null } {
    return { ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null };
  }

  private parseId(raw: string | undefined, notFoundMessage: string): bigint {
    if (!raw || !/^\d+$/.test(raw)) {
      throw new NotFoundError(notFoundMessage);
    }
    return BigInt(raw);
  }
}
