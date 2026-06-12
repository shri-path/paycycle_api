/**
 * DashboardController — HTTP handlers for dashboard read endpoints.
 * All handlers are arrow functions. No business logic.
 */
import { Request, Response, NextFunction } from 'express';
import { sendSuccess, sendListResponse } from '@/common/api-wrapper/response.util';
import { GetOwnerDashboardQuery } from './queries/get-owner-dashboard/get-owner-dashboard.query';
import { GetStaffDashboardQuery } from './queries/get-staff-dashboard/get-staff-dashboard.query';
import { GetSupplyForecastQuery } from './queries/get-supply-forecast/get-supply-forecast.query';
import { GetOutstandingAgingQuery } from './queries/get-outstanding-aging/get-outstanding-aging.query';

export class DashboardController {
  constructor(
    private readonly getOwnerDashboardQry: GetOwnerDashboardQuery,
    private readonly getStaffDashboardQry: GetStaffDashboardQuery,
    private readonly getSupplyForecastQry: GetSupplyForecastQuery,
    private readonly getOutstandingAgingQry: GetOutstandingAgingQuery
  ) {}

  /**
   * @openapi
   * /vendors/{vendorId}/dashboard/owner:
   *   get:
   *     tags: [Dashboard]
   *     summary: Get owner dashboard (financial + forecast + progress)
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: vendorId
   *         required: true
   *         schema: { type: string }
   *       - in: query
   *         name: month
   *         schema: { type: string, example: "2026-04" }
   *         description: Financial window YYYY-MM (defaults to current month)
   *     responses:
   *       200:
   *         description: Owner dashboard data
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Forbidden (staff attempting owner endpoint)
   *       404:
   *         description: Not a member of this vendor
   */
  getOwnerDashboard = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const vendorId = req.roleContext!.vendorId;
      const month = req.query['month'] as string | undefined;
      const result = await this.getOwnerDashboardQry.execute(vendorId, month);
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/dashboard/staff/{staffId}:
   *   get:
   *     tags: [Dashboard]
   *     summary: Get staff dashboard (work progress, no financial data)
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: vendorId
   *         required: true
   *         schema: { type: string }
   *       - in: path
   *         name: staffId
   *         required: true
   *         schema: { type: string }
   *         description: VendorUser.id of the staff member
   *     responses:
   *       200:
   *         description: Staff dashboard data (no financial fields)
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Staff viewing another staff's data
   *       404:
   *         description: Staff not found in vendor / not a member
   */
  getStaffDashboard = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const vendorId = req.roleContext!.vendorId;
      const callerRole = req.roleContext!.role;
      const callerStaffId = req.roleContext!.staffId;
      const targetStaffId = BigInt(req.params['staffId']!);

      const result = await this.getStaffDashboardQry.execute(
        vendorId,
        targetStaffId,
        callerRole,
        callerStaffId
      );
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/supply-forecast:
   *   get:
   *     tags: [Dashboard]
   *     summary: Get supply forecast for procurement planning
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: vendorId
   *         required: true
   *         schema: { type: string }
   *       - in: query
   *         name: date
   *         schema: { type: string, example: "2026-04-13" }
   *         description: Forecast date YYYY-MM-DD (default tomorrow)
   *       - in: query
   *         name: days
   *         schema: { type: integer, minimum: 1, maximum: 30, default: 7 }
   *       - in: query
   *         name: supplyType
   *         schema: { type: string }
   *     responses:
   *       200:
   *         description: Supply forecast data
   *       400:
   *         description: Invalid date or days parameter
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Forbidden (staff)
   *       404:
   *         description: Not a member
   */
  getSupplyForecast = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const vendorId = req.roleContext!.vendorId;
      const dateStr = req.query['date'] as string | undefined;
      const days = Number(req.query['days'] ?? 7);
      const supplyType = req.query['supplyType'] as string | undefined;

      let forecastDate: Date;
      if (dateStr) {
        forecastDate = new Date(dateStr);
        forecastDate.setHours(0, 0, 0, 0);
      } else {
        forecastDate = new Date();
        forecastDate.setHours(0, 0, 0, 0);
        forecastDate.setDate(forecastDate.getDate() + 1);
      }

      const result = await this.getSupplyForecastQry.execute(
        vendorId,
        forecastDate,
        days,
        supplyType
      );
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/outstanding-aging:
   *   get:
   *     tags: [Dashboard]
   *     summary: Get outstanding aging analysis for collections
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: vendorId
   *         required: true
   *         schema: { type: string }
   *       - in: query
   *         name: priority
   *         schema: { type: string, enum: [high, medium, low, all], default: all }
   *       - in: query
   *         name: page
   *         schema: { type: integer, minimum: 1, default: 1 }
   *       - in: query
   *         name: limit
   *         schema: { type: integer, minimum: 1, maximum: 100, default: 20 }
   *     responses:
   *       200:
   *         description: Outstanding aging data with prioritized customers
   *       400:
   *         description: Invalid query parameters
   *       401:
   *         description: Unauthorized
   *       403:
   *         description: Forbidden (staff)
   *       404:
   *         description: Not a member
   */
  getOutstandingAging = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const vendorId = req.roleContext!.vendorId;
      const priority = req.query['priority'] as 'high' | 'medium' | 'low' | 'all' | undefined;
      const page = Number(req.query['page'] ?? 1);
      const limit = Number(req.query['limit'] ?? 20);

      const { data, totalCount } = await this.getOutstandingAgingQry.execute(
        vendorId,
        priority,
        page,
        limit
      );
      const totalPages = Math.ceil(totalCount / limit);
      sendListResponse(res, data, { page, limit, total: totalCount, totalPages });
    } catch (err) {
      next(err);
    }
  };
}
