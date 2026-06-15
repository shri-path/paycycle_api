/**
 * ReferralController — HTTP handlers for Referral Engine endpoints.
 * All handlers are arrow functions. vendorId is taken from req.roleContext.
 */
import { Request, Response, NextFunction } from 'express';
import { sendSuccess, sendCreated, sendListResponse } from '@/common/api-wrapper/response.util';
import { CreateVendorReferralCommand } from './commands/create-vendor-referral/create-vendor-referral.command';
import { RedeemCreditCommand } from './commands/redeem-credit/redeem-credit.command';
import {
  BulkInviteCommand,
  BulkInviteTargetType,
} from './commands/bulk-invite/bulk-invite.command';
import { GetDashboardQuery } from './queries/get-dashboard/get-dashboard.query';
import { ListVendorReferralsQuery } from './queries/list-vendor-referrals/list-vendor-referrals.query';
import { GetCreditBalanceQuery } from './queries/get-credit-balance/get-credit-balance.query';
import { ListCreditTransactionsQuery } from './queries/list-transactions/list-transactions.query';
import { NearbyVendorsQuery } from './queries/nearby-vendors/nearby-vendors.query';
import { LeaderboardQuery } from './queries/leaderboard/leaderboard.query';
import { CustomerReferralsQuery } from './queries/customer-referrals/customer-referrals.query';
import {
  ReferralVendorStatus,
  CreditTransactionType,
  LeaderboardPeriodType,
} from './domain/vendor-referral.types';
import type { RedemptionType } from './commands/redeem-credit/redeem-credit.command';

export class ReferralController {
  constructor(
    private readonly createReferralCmd: CreateVendorReferralCommand,
    private readonly redeemCreditCmd: RedeemCreditCommand,
    private readonly bulkInviteCmd: BulkInviteCommand,
    private readonly getDashboardQry: GetDashboardQuery,
    private readonly listReferralsQry: ListVendorReferralsQuery,
    private readonly getCreditBalanceQry: GetCreditBalanceQuery,
    private readonly listTransactionsQry: ListCreditTransactionsQuery,
    private readonly nearbyVendorsQry: NearbyVendorsQuery,
    private readonly leaderboardQry: LeaderboardQuery,
    private readonly customerReferralsQry: CustomerReferralsQuery
  ) {}

  /**
   * @openapi
   * /vendors/{vendorId}/referrals/vendor:
   *   post:
   *     tags: [Referral]
   *     summary: Create a vendor-to-vendor referral (rate limited 10/day)
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
   *             required: [phoneNumber]
   *             properties:
   *               vendorName: { type: string, maxLength: 100 }
   *               phoneNumber: { type: string }
   *     responses:
   *       201:
   *         description: Referral created with shareable code and message
   *       400:
   *         description: Validation error
   *       403:
   *         description: Self-referral blocked
   *       404:
   *         description: Not found
   *       409:
   *         description: Duplicate referral
   *       429:
   *         description: Rate limit exceeded (10/day)
   */
  createVendorReferral = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const vendorId = req.roleContext!.vendorId;
      const body = req.body as { vendorName?: string; phoneNumber: string };

      const result = await this.createReferralCmd.execute({
        referrerVendorId: vendorId,
        vendorName: body.vendorName ?? 'Vendor',
        refereePhone: body.phoneNumber,
        ...(body.vendorName !== undefined ? { refereeName: body.vendorName } : {}),
      });

      sendCreated(res, result);
    } catch (err) {
      next(err);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/referrals/dashboard:
   *   get:
   *     tags: [Referral]
   *     summary: Full referral dashboard with earnings, milestones, and customer growth
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: vendorId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: Dashboard data
   *       404:
   *         description: Not found
   */
  getDashboard = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const vendorId = req.roleContext!.vendorId;
      const result = await this.getDashboardQry.execute(vendorId);
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/referrals/vendor:
   *   get:
   *     tags: [Referral]
   *     summary: Paginated list of vendor referrals
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
   *       - in: query
   *         name: status
   *         schema: { type: string, enum: [PENDING, SIGNED_UP, QUALIFIED, REWARDED] }
   *     responses:
   *       200:
   *         description: Paginated referral list
   *       404:
   *         description: Not found
   */
  listVendorReferrals = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const vendorId = req.roleContext!.vendorId;
      const page = Number(req.query['page'] ?? 1);
      const limit = Number(req.query['limit'] ?? 20);
      const status = req.query['status'] as ReferralVendorStatus | undefined;

      const { rows, total } = await this.listReferralsQry.execute({
        vendorId,
        page,
        limit,
        ...(status !== undefined ? { status } : {}),
      });
      const totalPages = Math.ceil(total / limit);
      sendListResponse(res, rows, { page, limit, total, totalPages });
    } catch (err) {
      next(err);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/customer-referrals:
   *   get:
   *     tags: [Referral]
   *     summary: Customer referral summary, top referrers, recent additions
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: vendorId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: Customer referral data
   *       404:
   *         description: Not found
   */
  getCustomerReferrals = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const vendorId = req.roleContext!.vendorId;
      const page = Number(req.query['page'] ?? 1);
      const limit = Number(req.query['limit'] ?? 20);

      const result = await this.customerReferralsQry.execute({ vendorId, page, limit });
      const { total, ...data } = result;
      const totalPages = Math.ceil(total / limit);

      res.status(200).json({
        success: true,
        data: {
          summary: data.summary,
          topReferrers: data.topReferrers,
          recentAdditions: data.recentAdditions,
        },
        meta: { page, limit, total, totalPages },
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/customers/bulk-invite:
   *   post:
   *     tags: [Referral]
   *     summary: Send bulk WhatsApp invites to customers not on PayCycle
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
   *             required: [targetType]
   *             properties:
   *               targetType: { type: string, enum: [all_not_on_paycycle, specific] }
   *               customerIds: { type: array, items: { type: string } }
   *               messageLanguage: { type: string }
   *               customMessage: { type: string }
   *               autoResend: { type: boolean }
   *               maxAttempts: { type: integer, minimum: 1, maximum: 3 }
   *     responses:
   *       200:
   *         description: Invite results
   *       400:
   *         description: Validation error
   *       404:
   *         description: Not found
   */
  bulkInvite = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const vendorId = req.roleContext!.vendorId;
      const body = req.body as {
        targetType: BulkInviteTargetType;
        customerIds?: string[];
        messageLanguage?: string;
        customMessage?: string;
        autoResend?: boolean;
        maxAttempts?: number;
      };

      const result = await this.bulkInviteCmd.execute({
        vendorId,
        targetType: body.targetType,
        ...(body.customerIds !== undefined
          ? { customerIds: body.customerIds.map((id) => BigInt(id)) }
          : {}),
        ...(body.messageLanguage !== undefined ? { messageLanguage: body.messageLanguage } : {}),
        ...(body.customMessage !== undefined ? { customMessage: body.customMessage } : {}),
        ...(body.autoResend !== undefined ? { autoResend: body.autoResend } : {}),
        ...(body.maxAttempts !== undefined ? { maxAttempts: body.maxAttempts } : {}),
      });

      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/credits:
   *   get:
   *     tags: [Referral]
   *     summary: Credit balance summary
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: vendorId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: Credit balance
   *       404:
   *         description: Not found
   */
  getCreditBalance = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const vendorId = req.roleContext!.vendorId;
      const result = await this.getCreditBalanceQry.execute(vendorId);
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/credits/transactions:
   *   get:
   *     tags: [Referral]
   *     summary: Paginated immutable credit ledger
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: vendorId
   *         required: true
   *         schema: { type: string }
   *       - in: query
   *         name: type
   *         schema: { type: string, enum: [EARNED, USED, EXPIRED, ADJUSTMENT] }
   *     responses:
   *       200:
   *         description: Credit ledger
   *       404:
   *         description: Not found
   */
  listCreditTransactions = async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const vendorId = req.roleContext!.vendorId;
      const page = Number(req.query['page'] ?? 1);
      const limit = Number(req.query['limit'] ?? 20);
      const type = req.query['type'] as CreditTransactionType | undefined;

      const { rows, total } = await this.listTransactionsQry.execute({
        vendorId,
        page,
        limit,
        ...(type !== undefined ? { type } : {}),
      });
      const totalPages = Math.ceil(total / limit);
      sendListResponse(res, rows, { page, limit, total, totalPages });
    } catch (err) {
      next(err);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/credits/redeem:
   *   post:
   *     tags: [Referral]
   *     summary: Redeem credits (subscription or upgrade only; withdrawal disabled in v1)
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
   *             required: [redemptionType, amount]
   *             properties:
   *               redemptionType: { type: string, enum: [subscription, upgrade, withdraw] }
   *               amount: { type: number }
   *     responses:
   *       200:
   *         description: Redemption result
   *       400:
   *         description: Withdrawal not available or validation error
   *       404:
   *         description: Not found
   *       409:
   *         description: Insufficient credits
   */
  redeemCredit = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const vendorId = req.roleContext!.vendorId;
      const { redemptionType, amount } = req.body as {
        redemptionType: RedemptionType;
        amount: number;
      };

      const result = await this.redeemCreditCmd.execute({ vendorId, redemptionType, amount });
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/nearby-vendors:
   *   get:
   *     tags: [Referral]
   *     summary: Nearby vendors grouped by category (v1 locality string-match, no PostGIS)
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: vendorId
   *         required: true
   *         schema: { type: string }
   *       - in: query
   *         name: radius
   *         schema: { type: integer, default: 2 }
   *         description: "PROVISIONAL: echoed back but not used in v1 (no PostGIS). Distance is null."
   *     responses:
   *       200:
   *         description: Nearby vendors
   *       404:
   *         description: Not found
   */
  nearbyVendors = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const vendorId = req.roleContext!.vendorId;
      const radius = req.query['radius'] ? Number(req.query['radius']) : 2;

      const result = await this.nearbyVendorsQry.execute({ vendorId, radius });
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/referrals/leaderboard:
   *   get:
   *     tags: [Referral]
   *     summary: Pre-computed referral leaderboard
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: vendorId
   *         required: true
   *         schema: { type: string }
   *       - in: query
   *         name: period
   *         schema: { type: string, enum: [WEEKLY, MONTHLY, ALL_TIME], default: MONTHLY }
   *     responses:
   *       200:
   *         description: Leaderboard
   *       404:
   *         description: Not found
   */
  getLeaderboard = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const vendorId = req.roleContext!.vendorId;
      const period =
        (req.query['period'] as LeaderboardPeriodType) ?? LeaderboardPeriodType.MONTHLY;
      const page = Number(req.query['page'] ?? 1);
      const limit = Number(req.query['limit'] ?? 20);

      const { rows, total } = await this.leaderboardQry.execute({ vendorId, period, page, limit });
      const totalPages = Math.ceil(total / limit);
      sendListResponse(res, rows, { page, limit, total, totalPages });
    } catch (err) {
      next(err);
    }
  };
}
