/**
 * VendorSettingsController — HTTP handlers for vendor settings endpoints.
 * All handlers are arrow functions. No business logic.
 */
import { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '@/common/api-wrapper/response.util';
import { GetVendorSettingsQuery } from './queries/get-vendor-settings/get-vendor-settings.query';
import { UpdateVendorSettingsCommand } from './commands/update-vendor-settings/update-vendor-settings.command';
import { UpdateNotificationPreferencesCommand } from './commands/update-notification-preferences/update-notification-preferences.command';
import { VendorSettingsPatch } from './domain/vendor-settings.types';

export class VendorSettingsController {
  constructor(
    private readonly getSettingsQry: GetVendorSettingsQuery,
    private readonly updateSettingsCmd: UpdateVendorSettingsCommand,
    private readonly updateNotifPrefsCmd: UpdateNotificationPreferencesCommand
  ) {}

  /**
   * @openapi
   * /vendors/{vendorId}/settings:
   *   get:
   *     tags: [VendorSettings]
   *     summary: Get vendor automation settings (returns defaults if not yet saved)
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: vendorId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: Current vendor settings
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Forbidden (staff)
   *       404:
   *         description: Not a member of this vendor
   */
  getSettings = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const vendorId = req.roleContext!.vendorId;
      const result = await this.getSettingsQry.execute(vendorId);
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/settings:
   *   patch:
   *     tags: [VendorSettings]
   *     summary: Update vendor automation settings (upserts on first call)
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
   *             minProperties: 1
   *             properties:
   *               autoMarkEnabled: { type: boolean }
   *               autoSendBillsEnabled: { type: boolean }
   *               autoSendBillsTime: { type: string, example: "20:00" }
   *               notificationPreferences: { type: object }
   *               defaultCreditLimit: { type: number, nullable: true }
   *               defaultCreditPeriodDays: { type: integer, nullable: true }
   *               bulkOperationConcurrencyLimit: { type: integer }
   *     responses:
   *       200:
   *         description: Updated settings object
   *       400:
   *         description: Validation error
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Forbidden (staff)
   *       404:
   *         description: Not a member of this vendor
   */
  updateSettings = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const vendorId = req.roleContext!.vendorId;
      const userId = req.roleContext!.userId;
      const correlationId = (req as Request & { id?: string }).id;

      const body = req.body as {
        autoMarkEnabled?: boolean;
        autoSendBillsEnabled?: boolean;
        autoSendBillsTime?: string;
        notificationPreferences?: Record<string, unknown>;
        defaultCreditLimit?: number | null;
        defaultCreditPeriodDays?: number | null;
        bulkOperationConcurrencyLimit?: number;
      };

      const patch: VendorSettingsPatch = {};
      if (body.autoMarkEnabled !== undefined) patch.autoMarkEnabled = body.autoMarkEnabled;
      if (body.autoSendBillsEnabled !== undefined)
        patch.autoSendBillsEnabled = body.autoSendBillsEnabled;
      if (body.autoSendBillsTime !== undefined) patch.autoSendBillsTime = body.autoSendBillsTime;
      if (body.notificationPreferences !== undefined)
        patch.notificationPreferences = body.notificationPreferences;
      if (body.defaultCreditPeriodDays !== undefined)
        patch.defaultCreditPeriodDays = body.defaultCreditPeriodDays;
      if (body.bulkOperationConcurrencyLimit !== undefined)
        patch.bulkOperationConcurrencyLimit = body.bulkOperationConcurrencyLimit;
      // Convert number credit limit to decimal string for domain
      if ('defaultCreditLimit' in body) {
        patch.defaultCreditLimit =
          body.defaultCreditLimit !== null && body.defaultCreditLimit !== undefined
            ? body.defaultCreditLimit.toFixed(2)
            : null;
      }

      const result = await this.updateSettingsCmd.execute({
        vendorId,
        patch,
        performedByUserId: userId,
        correlationId,
      });
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/notification-preferences:
   *   patch:
   *     tags: [VendorSettings]
   *     summary: Replace notification preferences blob
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
   *             required: [notificationPreferences]
   *             properties:
   *               notificationPreferences:
   *                 type: object
   *     responses:
   *       200:
   *         description: Updated settings object
   *       400:
   *         description: Validation error
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Forbidden (staff)
   *       404:
   *         description: Not a member of this vendor
   */
  updateNotificationPreferences = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const vendorId = req.roleContext!.vendorId;
      const userId = req.roleContext!.userId;
      const correlationId = (req as Request & { id?: string }).id;

      const { notificationPreferences } = req.body as {
        notificationPreferences: Record<string, unknown>;
      };

      const result = await this.updateNotifPrefsCmd.execute({
        vendorId,
        notificationPreferences,
        performedByUserId: userId,
        correlationId,
      });
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  };
}
