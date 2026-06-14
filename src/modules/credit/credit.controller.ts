import { Request, Response, NextFunction } from 'express';
import { sendSuccess, sendCreated, sendListResponse } from '@/common/api-wrapper/response.util';
import { SetCreditSettingsCommand } from './commands/set-credit-settings/set-credit-settings.command';
import { EnablePrepaidCommand } from './commands/enable-prepaid/enable-prepaid.command';
import { SendBulkRemindersCommand } from './commands/send-bulk-reminders/send-bulk-reminders.command';
import { SendSingleReminderCommand } from './commands/send-single-reminder/send-single-reminder.command';
import { UpdateReminderConfigCommand } from './commands/update-reminder-config/update-reminder-config.command';
import { GetCollectionsDashboardQuery } from './queries/get-collections-dashboard/get-collections-dashboard.query';
import { GetPriorityListQuery } from './queries/get-priority-list/get-priority-list.query';
import { GetCollectionAnalyticsQuery } from './queries/get-collection-analytics/get-collection-analytics.query';
import { GetOutstandingAgingQuery } from './queries/get-outstanding-aging/get-outstanding-aging.query';
import { GetReminderHistoryQuery } from './queries/get-reminder-history/get-reminder-history.query';
import { GetReminderConfigQuery } from './queries/get-reminder-config/get-reminder-config.query';
import { CreditTypeEnum, CreditBreachActionEnum } from './domain/credit.types';

/**
 * CreditController — all handlers are arrow functions.
 * vendorId always comes from req.roleContext (JWT-validated path context).
 */
export class CreditController {
  constructor(
    private readonly setCreditSettingsCmd: SetCreditSettingsCommand,
    private readonly enablePrepaidCmd: EnablePrepaidCommand,
    private readonly sendBulkRemindersCmd: SendBulkRemindersCommand,
    private readonly sendSingleReminderCmd: SendSingleReminderCommand,
    private readonly updateReminderConfigCmd: UpdateReminderConfigCommand,
    private readonly getDashboardQry: GetCollectionsDashboardQuery,
    private readonly getPriorityListQry: GetPriorityListQuery,
    private readonly getAnalyticsQry: GetCollectionAnalyticsQuery,
    private readonly getAgingQry: GetOutstandingAgingQuery,
    private readonly getReminderHistoryQry: GetReminderHistoryQuery,
    private readonly getReminderConfigQry: GetReminderConfigQuery
  ) {}

  /**
   * @openapi
   * /vendors/{vendorId}/collections/dashboard:
   *   get:
   *     tags: [Credit Control]
   *     summary: Outstanding overview, aging buckets, this-month progress
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: vendorId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Dashboard data }
   *       403: { description: Forbidden }
   */
  getDashboard = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const vendorId = req.roleContext!.vendorId;
      const result = await this.getDashboardQry.execute(vendorId);
      sendSuccess(res, result);
    } catch (e) {
      next(e);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/collections/priority-list:
   *   get:
   *     tags: [Credit Control]
   *     summary: Customers grouped by collection priority
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: vendorId
   *         required: true
   *         schema: { type: string }
   *       - in: query
   *         name: sort
   *         schema:
   *           type: string
   *           enum: [oldest_first, amount_desc, utilization_desc, score_asc]
   *     responses:
   *       200: { description: Priority list }
   */
  getPriorityList = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const vendorId = req.roleContext!.vendorId;
      const sort = (req.query['sort'] as string | undefined) ?? 'oldest_first';
      const result = await this.getPriorityListQry.execute(vendorId, sort as 'oldest_first');
      sendSuccess(res, result);
    } catch (e) {
      next(e);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/collections/analytics:
   *   get:
   *     tags: [Credit Control]
   *     summary: Monthly collection analytics
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: vendorId
   *         required: true
   *         schema: { type: string }
   *       - in: query
   *         name: month
   *         schema: { type: string, pattern: '^\d{4}-\d{2}$' }
   *     responses:
   *       200: { description: Analytics }
   */
  getAnalytics = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const vendorId = req.roleContext!.vendorId;
      const month = req.query['month'] as string | undefined;
      const result = await this.getAnalyticsQry.execute(vendorId, month);
      sendSuccess(res, result);
    } catch (e) {
      next(e);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/collections/aging:
   *   get:
   *     tags: [Credit Control]
   *     summary: Standalone aging breakdown
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: vendorId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Aging data }
   */
  getAging = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const vendorId = req.roleContext!.vendorId;
      const result = await this.getAgingQry.execute(vendorId);
      sendSuccess(res, result);
    } catch (e) {
      next(e);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/customers/{customerId}/credit-settings:
   *   patch:
   *     tags: [Credit Control]
   *     summary: Set customer credit policy
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Credit settings updated }
   *       404: { description: Customer not found }
   */
  setCreditSettings = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const vendorId = req.roleContext!.vendorId;
      const customerId = BigInt(req.params['customerId']!);
      const body = req.body as {
        creditType?: string;
        creditLimit?: number;
        warningThreshold?: number;
        actionOnBreach?: string;
        minimumBalanceWarning?: number | null;
      };
      const result = await this.setCreditSettingsCmd.execute({
        customerId,
        vendorId,
        ...(body.creditType !== undefined ? { creditType: body.creditType as CreditTypeEnum } : {}),
        ...(body.creditLimit !== undefined ? { creditLimit: body.creditLimit } : {}),
        ...(body.warningThreshold !== undefined ? { warningThreshold: body.warningThreshold } : {}),
        ...(body.actionOnBreach !== undefined
          ? { actionOnBreach: body.actionOnBreach as CreditBreachActionEnum }
          : {}),
        ...(body.minimumBalanceWarning !== undefined
          ? { minimumBalanceWarning: body.minimumBalanceWarning }
          : {}),
      });
      sendSuccess(res, result);
    } catch (e) {
      next(e);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/customers/{customerId}/enable-prepaid:
   *   post:
   *     tags: [Credit Control]
   *     summary: Switch customer to prepaid mode
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Prepaid switch result }
   *       409: { description: Already prepaid }
   */
  enablePrepaid = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const vendorId = req.roleContext!.vendorId;
      const customerId = BigInt(req.params['customerId']!);
      const body = req.body as {
        clearOutstandingFirst: boolean;
        minimumBalanceWarning?: number;
        message?: string;
      };
      const result = await this.enablePrepaidCmd.execute({
        customerId,
        vendorId,
        clearOutstandingFirst: body.clearOutstandingFirst ?? true,
        ...(body.minimumBalanceWarning !== undefined
          ? { minimumBalanceWarning: body.minimumBalanceWarning }
          : {}),
        ...(body.message !== undefined ? { message: body.message } : {}),
      });
      if (result.switched) {
        sendSuccess(res, {
          customerId: result.customerId,
          creditType: result.creditType,
          minimumBalanceWarning: result.minimumBalanceWarning,
          clearOutstandingRequired: false,
        });
      } else {
        sendSuccess(res, {
          customerId: result.customerId,
          creditType: result.creditType,
          clearOutstandingRequired: true,
          outstanding: result.outstanding,
        });
      }
    } catch (e) {
      next(e);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/customers/{customerId}/reminders:
   *   post:
   *     tags: [Credit Control]
   *     summary: Send a single payment reminder
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       201: { description: Reminder sent }
   */
  sendSingleReminder = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const vendorId = req.roleContext!.vendorId;
      const customerId = BigInt(req.params['customerId']!);
      const body = req.body as { customMessage?: string };
      const result = await this.sendSingleReminderCmd.execute({
        customerId,
        vendorId,
        ...(body.customMessage !== undefined ? { customMessage: body.customMessage } : {}),
      });
      sendCreated(res, result);
    } catch (e) {
      next(e);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/customers/{customerId}/reminders:
   *   get:
   *     tags: [Credit Control]
   *     summary: Reminder history for one customer
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Reminder history }
   */
  getReminderHistory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const vendorId = req.roleContext!.vendorId;
      const customerId = BigInt(req.params['customerId']!);
      const q = req.query as Record<string, string>;
      const page = Number(q['page'] ?? 1);
      const limit = Number(q['limit'] ?? 20);
      const result = await this.getReminderHistoryQry.execute(customerId, vendorId, page, limit);
      sendListResponse(res, result.data.reminders, result.meta);
    } catch (e) {
      next(e);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/reminders/send-bulk:
   *   post:
   *     tags: [Credit Control]
   *     summary: Send bulk payment reminders
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Bulk send result }
   */
  sendBulkReminders = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const vendorId = req.roleContext!.vendorId;
      const body = req.body as {
        target: 'all_overdue' | 'selected';
        customerIds?: string[];
        customMessage?: string;
      };
      const result = await this.sendBulkRemindersCmd.execute({
        vendorId,
        target: body.target,
        ...(body.customerIds !== undefined
          ? { customerIds: body.customerIds.map((id) => BigInt(id)) }
          : {}),
        ...(body.customMessage !== undefined ? { customMessage: body.customMessage } : {}),
      });
      sendSuccess(res, result);
    } catch (e) {
      next(e);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/reminder-config:
   *   get:
   *     tags: [Credit Control]
   *     summary: Get vendor reminder config (system defaults if none saved)
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Reminder config }
   */
  getReminderConfig = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const vendorId = req.roleContext!.vendorId;
      const result = await this.getReminderConfigQry.execute(vendorId);
      sendSuccess(res, result);
    } catch (e) {
      next(e);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/reminder-config:
   *   patch:
   *     tags: [Credit Control]
   *     summary: Update vendor reminder config
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Reminder config updated }
   */
  updateReminderConfig = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const vendorId = req.roleContext!.vendorId;
      const body = req.body as {
        autoRemindersEnabled?: boolean;
        schedule3Days?: boolean;
        schedule15Days?: boolean;
        schedule30Days?: boolean;
        reminderTemplate?: string | null;
        excludedCustomerIds?: string[];
      };
      const result = await this.updateReminderConfigCmd.execute({
        vendorId,
        ...(body.autoRemindersEnabled !== undefined
          ? { autoRemindersEnabled: body.autoRemindersEnabled }
          : {}),
        ...(body.schedule3Days !== undefined ? { schedule3Days: body.schedule3Days } : {}),
        ...(body.schedule15Days !== undefined ? { schedule15Days: body.schedule15Days } : {}),
        ...(body.schedule30Days !== undefined ? { schedule30Days: body.schedule30Days } : {}),
        ...(body.reminderTemplate !== undefined ? { reminderTemplate: body.reminderTemplate } : {}),
        ...(body.excludedCustomerIds !== undefined
          ? { excludedCustomerIds: body.excludedCustomerIds.map(Number) }
          : {}),
      });
      sendSuccess(res, result);
    } catch (e) {
      next(e);
    }
  };
}
