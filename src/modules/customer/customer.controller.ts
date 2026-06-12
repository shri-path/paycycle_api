import { Request, Response, NextFunction } from 'express';
import { sendSuccess, sendCreated } from '@/common/api-wrapper/response.util';
import { CreateCustomerCommand } from './commands/create-customer/create-customer.command';
import { UpdateCustomerCommand } from './commands/update-customer/update-customer.command';
import { DeactivateCustomerCommand } from './commands/deactivate-customer/deactivate-customer.command';
import { UpdateCreditLimitCommand } from './commands/update-credit-limit/update-credit-limit.command';
import { RecordPaymentCommand } from './commands/record-payment/record-payment.command';
import { AddSubscriptionCommand } from './commands/add-subscription/add-subscription.command';
import { RemoveSubscriptionCommand } from './commands/remove-subscription/remove-subscription.command';
import { ListCustomersQuery } from './queries/list-customers/list-customers.query';
import { GetCustomerQuery } from './queries/get-customer/get-customer.query';
import { GetCustomerBillQuery } from './queries/get-customer-bill/get-customer-bill.query';
import { GetCustomerCalendarQuery } from './queries/get-customer-calendar/get-customer-calendar.query';
import { ListPaymentsQuery } from './queries/list-payments/list-payments.query';

/**
 * Customer HTTP handlers. vendorId and customer context are taken from
 * req.roleContext (never from request body). All handlers are arrow functions
 * for consistent `this` binding.
 */
export class CustomerController {
  constructor(
    private readonly createCustomerCmd: CreateCustomerCommand,
    private readonly updateCustomerCmd: UpdateCustomerCommand,
    private readonly deactivateCustomerCmd: DeactivateCustomerCommand,
    private readonly updateCreditLimitCmd: UpdateCreditLimitCommand,
    private readonly recordPaymentCmd: RecordPaymentCommand,
    private readonly addSubscriptionCmd: AddSubscriptionCommand,
    private readonly removeSubscriptionCmd: RemoveSubscriptionCommand,
    private readonly listCustomersQry: ListCustomersQuery,
    private readonly getCustomerQry: GetCustomerQuery,
    private readonly getCustomerBillQry: GetCustomerBillQuery,
    private readonly getCustomerCalendarQry: GetCustomerCalendarQuery,
    private readonly listPaymentsQry: ListPaymentsQuery
  ) {}

  /**
   * @openapi
   * /vendors/{vendorId}/customers:
   *   get:
   *     tags: [Customers]
   *     summary: List customers with search, filter, and payment-status
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: vendorId
   *         required: true
   *         schema: { type: string }
   *       - in: query
   *         name: search
   *         schema: { type: string }
   *       - in: query
   *         name: listId
   *         schema: { type: string }
   *       - in: query
   *         name: status
   *         schema: { type: string, enum: [all, paid, pending, overdue] }
   *       - in: query
   *         name: page
   *         schema: { type: integer }
   *       - in: query
   *         name: limit
   *         schema: { type: integer }
   *     responses:
   *       200: { description: Customer list }
   *       401: { description: Unauthenticated }
   *       403: { description: Forbidden }
   */
  listCustomers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ctx = req.roleContext!;
      const q = req.query as Record<string, string>;
      const result = await this.listCustomersQry.execute({
        vendorId: ctx.vendorId,
        isOwner: ctx.role === 'owner',
        staffListIds: ctx.role === 'staff' ? await this._getStaffListIds(ctx.staffId) : undefined,
        search: q['search'],
        listId: q['listId'] ? BigInt(q['listId']) : undefined,
        paymentStatusFilter: q['status'] ?? 'all',
        page: Number(q['page'] ?? 1),
        limit: Number(q['limit'] ?? 20),
      });
      sendSuccess(res, result);
    } catch (e) {
      next(e);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/customers:
   *   post:
   *     tags: [Customers]
   *     summary: Create a new customer
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
   *           schema: { type: object }
   *     responses:
   *       201: { description: Customer created }
   *       400: { description: Validation error }
   *       409: { description: Phone already exists }
   */
  createCustomer = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ctx = req.roleContext!;
      const body = req.body as {
        name: string;
        phone: string;
        phoneCountryCode?: string;
        email?: string | null;
        address?: string | null;
        area?: string | null;
        language?: string;
        supplyListIds?: string[];
        startDate?: string | null;
        creditLimit?: number;
        sendInvite?: boolean;
      };
      const result = await this.createCustomerCmd.execute({
        vendorId: ctx.vendorId,
        performedByUserId: ctx.userId,
        name: body.name,
        phone: body.phone,
        phoneCountryCode: body.phoneCountryCode,
        email: body.email,
        address: body.address,
        area: body.area,
        language: body.language,
        supplyListIds: body.supplyListIds?.map((id) => BigInt(id)),
        startDate: body.startDate ? new Date(body.startDate) : null,
        creditLimit: body.creditLimit,
        sendInvite: body.sendInvite,
      });
      sendCreated(res, result);
    } catch (e) {
      next(e);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/customers/{customerId}:
   *   get:
   *     tags: [Customers]
   *     summary: Get customer full detail
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: vendorId
   *         required: true
   *         schema: { type: string }
   *       - in: path
   *         name: customerId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Customer detail }
   *       404: { description: Customer not found }
   */
  getCustomer = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ctx = req.roleContext!;
      const customerId = BigInt(req.params['customerId']!);
      const result = await this.getCustomerQry.execute({
        customerId,
        vendorId: ctx.vendorId,
        isOwner: ctx.role === 'owner',
        staffListIds: ctx.role === 'staff' ? await this._getStaffListIds(ctx.staffId) : undefined,
      });
      sendSuccess(res, result);
    } catch (e) {
      next(e);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/customers/{customerId}:
   *   patch:
   *     tags: [Customers]
   *     summary: Update customer profile
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Updated customer }
   */
  updateCustomer = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ctx = req.roleContext!;
      const customerId = BigInt(req.params['customerId']!);
      const body = req.body as {
        name?: string;
        phone?: string;
        phoneCountryCode?: string;
        email?: string | null;
        address?: string | null;
        area?: string | null;
        language?: string;
        status?: string;
      };
      const result = await this.updateCustomerCmd.execute({
        customerId,
        vendorId: ctx.vendorId,
        name: body.name,
        phone: body.phone,
        phoneCountryCode: body.phoneCountryCode,
        email: body.email,
        address: body.address,
        area: body.area,
        language: body.language,
        status: body.status,
      });
      sendSuccess(res, result);
    } catch (e) {
      next(e);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/customers/{customerId}:
   *   delete:
   *     tags: [Customers]
   *     summary: Deactivate customer (soft delete)
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Customer deactivated }
   */
  deactivateCustomer = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ctx = req.roleContext!;
      const customerId = BigInt(req.params['customerId']!);
      await this.deactivateCustomerCmd.execute({ customerId, vendorId: ctx.vendorId });
      sendSuccess(res, { deactivated: true });
    } catch (e) {
      next(e);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/customers/{customerId}/bill/{month}:
   *   get:
   *     tags: [Customers]
   *     summary: Get monthly bill for customer
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Monthly bill }
   */
  getCustomerBill = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ctx = req.roleContext!;
      const customerId = BigInt(req.params['customerId']!);
      const month = req.params['month']!;
      const result = await this.getCustomerBillQry.execute({
        customerId,
        vendorId: ctx.vendorId,
        month,
      });
      sendSuccess(res, result);
    } catch (e) {
      next(e);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/customers/{customerId}/payments:
   *   post:
   *     tags: [Customers]
   *     summary: Record a payment
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       201: { description: Payment recorded }
   */
  recordPayment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ctx = req.roleContext!;
      const customerId = BigInt(req.params['customerId']!);
      const body = req.body as {
        amount: number;
        paymentDate: string;
        paymentMethod: string;
        referenceNumber?: string | null;
      };
      const result = await this.recordPaymentCmd.execute({
        customerId,
        vendorId: ctx.vendorId,
        recordedByUserId: ctx.userId,
        amount: body.amount,
        paymentDate: new Date(body.paymentDate),
        paymentMethod: body.paymentMethod,
        referenceNumber: body.referenceNumber,
      });
      sendCreated(res, result);
    } catch (e) {
      next(e);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/customers/{customerId}/payments:
   *   get:
   *     tags: [Customers]
   *     summary: List payment history for customer
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Payment list }
   */
  listPayments = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ctx = req.roleContext!;
      const customerId = BigInt(req.params['customerId']!);
      const q = req.query as Record<string, string>;
      const result = await this.listPaymentsQry.execute({
        customerId,
        vendorId: ctx.vendorId,
        page: Number(q['page'] ?? 1),
        limit: Number(q['limit'] ?? 20),
      });
      sendSuccess(res, result);
    } catch (e) {
      next(e);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/customers/{customerId}/credit-limit:
   *   patch:
   *     tags: [Customers]
   *     summary: Update credit limit
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Credit limit updated }
   */
  updateCreditLimit = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ctx = req.roleContext!;
      const customerId = BigInt(req.params['customerId']!);
      const body = req.body as { creditLimit: number };
      const result = await this.updateCreditLimitCmd.execute({
        customerId,
        vendorId: ctx.vendorId,
        creditLimit: body.creditLimit,
      });
      sendSuccess(res, result);
    } catch (e) {
      next(e);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/customers/{customerId}/calendar/{month}:
   *   get:
   *     tags: [Customers]
   *     summary: Get delivery calendar for customer
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Calendar }
   */
  getCustomerCalendar = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ctx = req.roleContext!;
      const customerId = BigInt(req.params['customerId']!);
      const month = req.params['month']!;
      const result = await this.getCustomerCalendarQry.execute({
        customerId,
        vendorId: ctx.vendorId,
        month,
        isOwner: ctx.role === 'owner',
        staffListIds: ctx.role === 'staff' ? await this._getStaffListIds(ctx.staffId) : undefined,
      });
      sendSuccess(res, result);
    } catch (e) {
      next(e);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/customers/{customerId}/subscriptions:
   *   post:
   *     tags: [Customers]
   *     summary: Add customer to another supply list
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       201: { description: Subscription created }
   */
  addSubscription = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ctx = req.roleContext!;
      const customerId = BigInt(req.params['customerId']!);
      const body = req.body as {
        supplyListId: string;
        startDate?: string | null;
        customQuantity?: number | null;
        customRatePerUnit?: number | null;
      };
      const result = await this.addSubscriptionCmd.execute({
        customerId,
        vendorId: ctx.vendorId,
        supplyListId: BigInt(body.supplyListId),
        startDate: body.startDate ? new Date(body.startDate) : null,
        customQuantity: body.customQuantity,
        customRatePerUnit: body.customRatePerUnit,
      });
      sendCreated(res, result);
    } catch (e) {
      next(e);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/customers/{customerId}/subscriptions/{subscriptionId}:
   *   delete:
   *     tags: [Customers]
   *     summary: Remove customer from supply list
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Subscription ended }
   */
  removeSubscription = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ctx = req.roleContext!;
      const subscriptionId = BigInt(req.params['subscriptionId']!);
      await this.removeSubscriptionCmd.execute({
        subscriptionId,
        vendorId: ctx.vendorId,
      });
      sendSuccess(res, { removed: true });
    } catch (e) {
      next(e);
    }
  };

  /**
   * Load staff's assigned supply list IDs from the DB (cached per request via closure).
   * This avoids importing the staff module directly.
   */
  private async _getStaffListIds(staffId: bigint): Promise<bigint[]> {
    const { prisma } = await import('@/infrastructure/database/prisma.client');
    const rows = await prisma.supplyListStaff.findMany({
      where: { vendorUserId: staffId },
      select: { supplyListId: true },
    });
    return rows.map((r) => r.supplyListId);
  }
}
