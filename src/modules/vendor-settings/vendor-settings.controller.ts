/**
 * VendorSettingsController — HTTP handlers for vendor settings endpoints.
 * All handlers are arrow functions. No business logic.
 */
import { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '@/common/api-wrapper/response.util';
import { GetVendorSettingsQuery } from './queries/get-vendor-settings/get-vendor-settings.query';
import { UpdateVendorSettingsCommand } from './commands/update-vendor-settings/update-vendor-settings.command';
import { VendorSettingsPatch } from './domain/vendor-settings.types';

export class VendorSettingsController {
  constructor(
    private readonly getSettingsQry: GetVendorSettingsQuery,
    private readonly updateSettingsCmd: UpdateVendorSettingsCommand
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
   *     responses:
   *       200:
   *         description: Updated settings object
   *       400:
   *         description: Validation error (empty body / unknown keys / bad time)
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

      const patch: VendorSettingsPatch = req.body as VendorSettingsPatch;

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
}
