/**
 * SubscriptionController — HTTP handlers for the Subscription & Pricing module.
 * All handlers are arrow functions. vendorId is taken from req.roleContext.
 */
import { Request, Response, NextFunction } from 'express';
import { sendSuccess, sendListResponse } from '@/common/api-wrapper/response.util';
import { ListPlansQuery } from './queries/list-plans/list-plans.query';
import { GetVendorSubscriptionQuery } from './queries/get-vendor-subscription/get-vendor-subscription.query';
import { ListInvoicesQuery } from './queries/list-invoices/list-invoices.query';
import { ListSubscriptionHistoryQuery } from './queries/list-subscription-history/list-subscription-history.query';
import { UpgradeSubscriptionCommand } from './commands/upgrade-subscription/upgrade-subscription.command';
import { RenewSubscriptionCommand } from './commands/renew-subscription/renew-subscription.command';
import { CancelSubscriptionCommand } from './commands/cancel-subscription/cancel-subscription.command';
import { SetAutoRenewalCommand } from './commands/set-auto-renewal/set-auto-renewal.command';
import { BillingCycleEnum } from './domain/subscription.types';

export class SubscriptionController {
  constructor(
    private readonly listPlansQry: ListPlansQuery,
    private readonly getVendorSubscriptionQry: GetVendorSubscriptionQuery,
    private readonly listInvoicesQry: ListInvoicesQuery,
    private readonly listHistoryQry: ListSubscriptionHistoryQuery,
    private readonly upgradeCmd: UpgradeSubscriptionCommand,
    private readonly renewCmd: RenewSubscriptionCommand,
    private readonly cancelCmd: CancelSubscriptionCommand,
    private readonly setAutoRenewalCmd: SetAutoRenewalCommand
  ) {}

  /**
   * @openapi
   * /subscription-plans:
   *   get:
   *     tags: [Subscription]
   *     summary: List all active subscription plans
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200:
   *         description: List of active plans ordered by tier
   *       401:
   *         description: Unauthorized
   */
  listPlans = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.listPlansQry.execute();
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/subscription:
   *   get:
   *     tags: [Subscription]
   *     summary: Get current subscription plan + live usage + utilization
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: vendorId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: Subscription view with usage data
   *       401:
   *         description: Unauthorized
   *       404:
   *         description: Vendor not found or no subscription
   */
  getSubscription = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const vendorId = req.roleContext!.vendorId;
      const result = await this.getVendorSubscriptionQry.execute(vendorId);
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/subscription/upgrade:
   *   post:
   *     tags: [Subscription]
   *     summary: Upgrade to a higher-tier plan (pro-rata charged)
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
   *             required: [newPlanId, billingCycle]
   *             properties:
   *               newPlanId: { type: string }
   *               billingCycle: { type: string, enum: [MONTHLY, YEARLY] }
   *     responses:
   *       200:
   *         description: Upgrade successful with invoice
   *       400:
   *         description: Validation error
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Forbidden (not owner)
   *       404:
   *         description: Not found
   *       422:
   *         description: Same or lower tier
   */
  upgrade = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const vendorId = req.roleContext!.vendorId;
      const userId = req.roleContext!.userId;
      const { newPlanId, billingCycle } = req.body as { newPlanId: string; billingCycle: string };

      const result = await this.upgradeCmd.execute({
        vendorId,
        newPlanId: BigInt(newPlanId),
        billingCycle: billingCycle as BillingCycleEnum,
        performedByUserId: userId,
      });
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/subscription/renew:
   *   post:
   *     tags: [Subscription]
   *     summary: Manually renew subscription for another billing period
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
   *             required: [billingCycle]
   *             properties:
   *               billingCycle: { type: string, enum: [MONTHLY, YEARLY] }
   *     responses:
   *       200:
   *         description: Renewal successful with invoice
   *       400:
   *         description: Validation error
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Forbidden (not owner)
   *       404:
   *         description: Not found
   */
  renew = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const vendorId = req.roleContext!.vendorId;
      const userId = req.roleContext!.userId;
      const { billingCycle } = req.body as { billingCycle: string };

      const result = await this.renewCmd.execute({
        vendorId,
        billingCycle: billingCycle as BillingCycleEnum,
        performedByUserId: userId,
      });
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/subscription/cancel:
   *   post:
   *     tags: [Subscription]
   *     summary: Cancel subscription (stays active until nextBillingDate)
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: vendorId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: Cancellation confirmed
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Forbidden (not owner)
   *       404:
   *         description: Not found
   *       422:
   *         description: Already cancelled
   */
  cancel = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const vendorId = req.roleContext!.vendorId;
      const userId = req.roleContext!.userId;

      const result = await this.cancelCmd.execute({
        vendorId,
        performedByUserId: userId,
      });
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/subscription/auto-renewal:
   *   patch:
   *     tags: [Subscription]
   *     summary: Toggle auto-renewal on/off
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
   *             required: [autoRenewal]
   *             properties:
   *               autoRenewal: { type: boolean }
   *     responses:
   *       200:
   *         description: Auto-renewal updated
   *       400:
   *         description: Validation error
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Forbidden (not owner)
   *       404:
   *         description: Not found
   */
  toggleAutoRenewal = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const vendorId = req.roleContext!.vendorId;
      const { autoRenewal } = req.body as { autoRenewal: boolean };

      const result = await this.setAutoRenewalCmd.execute({ vendorId, autoRenewal });
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/subscription/invoices:
   *   get:
   *     tags: [Subscription]
   *     summary: List billing invoices (paginated, reverse chronological)
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: vendorId
   *         required: true
   *         schema: { type: string }
   *       - in: query
   *         name: page
   *         schema: { type: integer, default: 1 }
   *       - in: query
   *         name: limit
   *         schema: { type: integer, default: 20, maximum: 50 }
   *     responses:
   *       200:
   *         description: Paginated list of invoices
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Forbidden (not owner)
   *       404:
   *         description: Not found
   */
  listInvoices = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const vendorId = req.roleContext!.vendorId;
      const page = Number(req.query['page'] ?? 1);
      const limit = Number(req.query['limit'] ?? 20);

      const { rows, total } = await this.listInvoicesQry.execute(vendorId, page, limit);
      const totalPages = Math.ceil(total / limit);
      sendListResponse(res, rows, { page, limit, total, totalPages });
    } catch (err) {
      next(err);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/subscription/history:
   *   get:
   *     tags: [Subscription]
   *     summary: List subscription event history (paginated)
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: vendorId
   *         required: true
   *         schema: { type: string }
   *       - in: query
   *         name: page
   *         schema: { type: integer, default: 1 }
   *       - in: query
   *         name: limit
   *         schema: { type: integer, default: 20, maximum: 50 }
   *     responses:
   *       200:
   *         description: Paginated list of history events
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Forbidden (not owner)
   *       404:
   *         description: Not found
   */
  listHistory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const vendorId = req.roleContext!.vendorId;
      const page = Number(req.query['page'] ?? 1);
      const limit = Number(req.query['limit'] ?? 20);

      const { rows, total } = await this.listHistoryQry.execute(vendorId, page, limit);
      const totalPages = Math.ceil(total / limit);
      sendListResponse(res, rows, { page, limit, total, totalPages });
    } catch (err) {
      next(err);
    }
  };
}
