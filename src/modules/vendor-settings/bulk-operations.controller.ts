/**
 * BulkOperationsController — HTTP handlers for bulk operation endpoints.
 * All handlers are arrow functions. No business logic.
 */
import { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '@/common/api-wrapper/response.util';
import { BulkMarkLeaveCommand } from './commands/bulk-mark-leave/bulk-mark-leave.command';
import { BulkAdjustRateCommand } from './commands/bulk-adjust-rate/bulk-adjust-rate.command';
import { BulkSendRemindersCommand } from './commands/bulk-send-reminders/bulk-send-reminders.command';
import { GetBulkOperationQuery } from './queries/get-bulk-operation/get-bulk-operation.query';

export class BulkOperationsController {
  constructor(
    private readonly bulkMarkLeaveCmd: BulkMarkLeaveCommand,
    private readonly bulkAdjustRateCmd: BulkAdjustRateCommand,
    private readonly bulkSendRemindersCmd: BulkSendRemindersCommand,
    private readonly getBulkOpQry: GetBulkOperationQuery
  ) {}

  /**
   * @openapi
   * /vendors/{vendorId}/bulk-operations/mark-leave:
   *   post:
   *     tags: [BulkOperations]
   *     summary: Mark leave for subscriptions on a given date
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: vendorId
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               subscriptionIds: { type: array, items: { type: string } }
   *               all: { type: boolean }
   *               date: { type: string, example: "2026-06-20" }
   *               reason: { type: string }
   *     responses:
   *       200:
   *         description: Operation completed synchronously
   *       202:
   *         description: Operation accepted for async processing
   *       400:
   *         description: Validation error (both/neither target mode)
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Forbidden (staff)
   *       413:
   *         description: Too many target ids (max 500)
   *       422:
   *         description: Past date
   */
  markLeave = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const vendorId = req.roleContext!.vendorId;
      const userId = req.roleContext!.userId;
      const correlationId = (req as Request & { id?: string }).id;

      const body = req.body as {
        subscriptionIds?: string[];
        all?: boolean;
        date: string;
        reason?: string;
      };

      const result = await this.bulkMarkLeaveCmd.execute({
        vendorId,
        subscriptionIds: body.subscriptionIds?.map((id) => BigInt(id)),
        all: body.all,
        date: body.date,
        reason: body.reason,
        performedByUserId: userId,
        correlationId,
      });

      if (result.asyncProcessing) {
        res.status(202).json({
          success: true,
          data: { operationId: result.operationId, status: result.status },
        });
      } else {
        sendSuccess(res, result);
      }
    } catch (err) {
      next(err);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/bulk-operations/adjust-rate:
   *   post:
   *     tags: [BulkOperations]
   *     summary: Adjust per-unit rate for subscriptions
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: vendorId
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               subscriptionIds: { type: array, items: { type: string } }
   *               all: { type: boolean }
   *               newRate: { type: number }
   *               effectiveDate: { type: string, example: "2026-07-01" }
   *               notifyCustomers: { type: boolean }
   *     responses:
   *       200:
   *         description: Operation completed
   *       202:
   *         description: Operation accepted for async processing
   *       400:
   *         description: Validation error
   *       422:
   *         description: Past effectiveDate
   */
  adjustRate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const vendorId = req.roleContext!.vendorId;
      const userId = req.roleContext!.userId;
      const correlationId = (req as Request & { id?: string }).id;

      const body = req.body as {
        subscriptionIds?: string[];
        all?: boolean;
        newRate: number;
        effectiveDate: string;
        notifyCustomers?: boolean;
      };

      const result = await this.bulkAdjustRateCmd.execute({
        vendorId,
        subscriptionIds: body.subscriptionIds?.map((id) => BigInt(id)),
        all: body.all,
        newRate: body.newRate,
        effectiveDate: body.effectiveDate,
        notifyCustomers: body.notifyCustomers,
        performedByUserId: userId,
        correlationId,
      });

      if (result.asyncProcessing) {
        res.status(202).json({
          success: true,
          data: { operationId: result.operationId, status: result.status },
        });
      } else {
        sendSuccess(res, result);
      }
    } catch (err) {
      next(err);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/bulk-operations/send-reminders:
   *   post:
   *     tags: [BulkOperations]
   *     summary: Send payment reminders to customers
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: vendorId
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               customerIds: { type: array, items: { type: string } }
   *               all: { type: boolean }
   *               messageTemplate: { type: string }
   *     responses:
   *       200:
   *         description: Reminders sent
   *       202:
   *         description: Operation accepted for async processing
   *       400:
   *         description: Validation error
   */
  sendReminders = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const vendorId = req.roleContext!.vendorId;
      const userId = req.roleContext!.userId;
      const correlationId = (req as Request & { id?: string }).id;

      const body = req.body as {
        customerIds?: string[];
        all?: boolean;
        messageTemplate?: string;
      };

      const result = await this.bulkSendRemindersCmd.execute({
        vendorId,
        customerIds: body.customerIds?.map((id) => BigInt(id)),
        all: body.all,
        messageTemplate: body.messageTemplate,
        performedByUserId: userId,
        correlationId,
      });

      if (result.asyncProcessing) {
        res.status(202).json({
          success: true,
          data: { operationId: result.operationId, status: result.status },
        });
      } else {
        sendSuccess(res, result);
      }
    } catch (err) {
      next(err);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/bulk-operations/{operationId}:
   *   get:
   *     tags: [BulkOperations]
   *     summary: Poll bulk operation status
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: vendorId
   *         required: true
   *         schema: { type: string }
   *       - in: path
   *         name: operationId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: Operation status
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Forbidden (staff)
   *       404:
   *         description: Operation not found or belongs to another vendor
   */
  getOperation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const vendorId = req.roleContext!.vendorId;
      const { operationId } = req.params as { operationId: string };

      const result = await this.getBulkOpQry.execute(BigInt(operationId), vendorId);
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  };
}
