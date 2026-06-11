import { Request, Response, NextFunction } from 'express';
import { SupplyFrequency } from '@prisma/client';
import { SupplyFrequency as DomainSupplyFrequency } from './domain/supply-list.types';
import { sendSuccess, sendCreated, sendListResponse } from '@/common/api-wrapper/response.util';
import { NotFoundError } from '@/common/errors/app-error';
import { CreateSupplyListService } from './commands/create-supply-list/create-supply-list.service';
import { UpdateSupplyListService } from './commands/update-supply-list/update-supply-list.service';
import { ArchiveSupplyListService } from './commands/archive-supply-list/archive-supply-list.service';
import { AssignStaffService } from './commands/assign-staff/assign-staff.service';
import { UnassignStaffService } from './commands/unassign-staff/unassign-staff.service';
import { AddCustomersService } from './commands/add-customers/add-customers.service';
import { UpdateSubscriptionService } from './commands/update-subscription/update-subscription.service';
import { EndSubscriptionService } from './commands/end-subscription/end-subscription.service';
import { ListSupplyListsService } from './queries/list-supply-lists/list-supply-lists.service';
import { GetSupplyListService } from './queries/get-supply-list/get-supply-list.service';
import { ListListCustomersService } from './queries/list-list-customers/list-list-customers.service';
import { ListAvailableCustomersService } from './queries/list-available-customers/list-available-customers.service';
import {
  AddCustomersInput,
  AssignStaffInput,
  CreateSupplyListInput,
  UpdateSubscriptionInput,
  UpdateSupplyListInput,
} from './supply-list.validator';

/**
 * Supply Lists & Subscriptions HTTP handlers. vendorId/actorUserId come from
 * req.roleContext (resolved by identifyUserRole) — never from the request body.
 */
export class SupplyListController {
  constructor(
    private readonly createService: CreateSupplyListService,
    private readonly updateService: UpdateSupplyListService,
    private readonly archiveService: ArchiveSupplyListService,
    private readonly assignStaffService: AssignStaffService,
    private readonly unassignStaffService: UnassignStaffService,
    private readonly addCustomersService: AddCustomersService,
    private readonly updateSubscriptionService: UpdateSubscriptionService,
    private readonly endSubscriptionService: EndSubscriptionService,
    private readonly listService: ListSupplyListsService,
    private readonly getService: GetSupplyListService,
    private readonly listCustomersService: ListListCustomersService,
    private readonly availableCustomersService: ListAvailableCustomersService
  ) {}

  /**
   * @openapi
   * /vendors/{vendorId}/supply-lists:
   *   get:
   *     tags: [Supply Lists]
   *     summary: List supply lists (owner sees all, staff sees assigned)
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - { in: path, name: vendorId, required: true, schema: { type: string } }
   *       - { in: query, name: status, schema: { type: string, enum: [active, archived] } }
   *       - { in: query, name: staffId, schema: { type: string } }
   *       - { in: query, name: page, schema: { type: integer } }
   *       - { in: query, name: limit, schema: { type: integer } }
   *     responses:
   *       200: { description: Paginated supply lists }
   *       401: { description: Unauthenticated }
   *       403: { description: Staff requesting another staff's lists }
   */
  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ctx = this.requireContext(req);
      const q = req.query as Record<string, string | undefined>;
      const result = await this.listService.execute({
        vendorId: ctx.vendorId,
        role: ctx.role,
        callerStaffId: ctx.staffId,
        ...(q['status'] ? { status: q['status'] as 'active' | 'archived' } : {}),
        ...(q['staffId'] ? { staffId: BigInt(q['staffId']) } : {}),
        ...(q['page'] ? { page: Number(q['page']) } : {}),
        ...(q['limit'] ? { limit: Number(q['limit']) } : {}),
      });
      sendListResponse(res, result.data, result.meta);
    } catch (error) {
      next(error);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/supply-lists/{listId}:
   *   get:
   *     tags: [Supply Lists]
   *     summary: Get a supply list (owner or assigned staff)
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Supply list detail }
   *       404: { description: Not found or staff not assigned (masked) }
   */
  get = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ctx = this.requireContext(req);
      const listId = this.parseId(req.params['listId'], 'Supply list not found');
      const result = await this.getService.execute({
        vendorId: ctx.vendorId,
        listId,
        role: ctx.role,
        callerStaffId: ctx.staffId,
      });
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/supply-lists:
   *   post:
   *     tags: [Supply Lists]
   *     summary: Create a supply list (owner only)
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       201: { description: Created supply list }
   *       400: { description: Validation error }
   *       409: { description: Duplicate active list name }
   *       422: { description: Assigned staff not active / not in vendor }
   */
  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ctx = this.requireContext(req);
      const body = req.body as CreateSupplyListInput;
      const frequencyDays = body.frequency === SupplyFrequency.DAILY ? [] : body.frequencyDays;
      const result = await this.createService.execute({
        vendorId: ctx.vendorId,
        actorUserId: ctx.userId,
        actorRole: ctx.roleName,
        name: body.name,
        supplyType: body.supplyType ?? null,
        unit: body.unit,
        defaultQuantity: body.defaultQuantity ?? null,
        defaultRatePerUnit: body.defaultRatePerUnit ?? null,
        startTime: body.startTime ?? null,
        // Prisma boundary enum → domain enum (identical string values).
        frequency: body.frequency as unknown as DomainSupplyFrequency,
        frequencyDays,
        staffIds: (body.staffIds ?? []).map((id) => BigInt(id)),
        primaryStaffId: body.primaryStaffId ? BigInt(body.primaryStaffId) : null,
        ip: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
      });
      sendCreated(res, result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/supply-lists/{listId}:
   *   patch:
   *     tags: [Supply Lists]
   *     summary: Update a supply list (owner only)
   *     description: Editing the default price does not affect existing custom overrides.
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Updated supply list }
   *       404: { description: Not found }
   *       409: { description: Duplicate active list name }
   *       422: { description: Invalid frequency/schedule combo }
   */
  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ctx = this.requireContext(req);
      const listId = this.parseId(req.params['listId'], 'Supply list not found');
      const body = req.body as UpdateSupplyListInput;
      const result = await this.updateService.execute({
        vendorId: ctx.vendorId,
        listId,
        actorUserId: ctx.userId,
        actorRole: ctx.roleName,
        patch: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.supplyType !== undefined ? { supplyType: body.supplyType } : {}),
          ...(body.unit !== undefined ? { unit: body.unit } : {}),
          ...(body.defaultQuantity !== undefined ? { defaultQuantity: body.defaultQuantity } : {}),
          ...(body.defaultRatePerUnit !== undefined
            ? { defaultRatePerUnit: body.defaultRatePerUnit }
            : {}),
          ...(body.startTime !== undefined ? { startTime: body.startTime } : {}),
          ...(body.frequency !== undefined
            ? { frequency: body.frequency as unknown as DomainSupplyFrequency }
            : {}),
          ...(body.frequencyDays !== undefined ? { frequencyDays: body.frequencyDays } : {}),
        },
        ip: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
      });
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/supply-lists/{listId}:
   *   delete:
   *     tags: [Supply Lists]
   *     summary: Archive a supply list (owner only, soft)
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Archived (status returned) }
   *       404: { description: Not found }
   */
  archive = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ctx = this.requireContext(req);
      const listId = this.parseId(req.params['listId'], 'Supply list not found');
      const result = await this.archiveService.execute({
        vendorId: ctx.vendorId,
        listId,
        actorUserId: ctx.userId,
        actorRole: ctx.roleName,
        ip: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
      });
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/supply-lists/{listId}/staff:
   *   post:
   *     tags: [Supply Lists]
   *     summary: Assign a staff member to a supply list (owner only)
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       201: { description: Updated supply list with assignedStaff }
   *       404: { description: List not found }
   *       409: { description: Already assigned }
   *       422: { description: Staff disabled / not in vendor }
   */
  assignStaff = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ctx = this.requireContext(req);
      const listId = this.parseId(req.params['listId'], 'Supply list not found');
      const body = req.body as AssignStaffInput;
      const result = await this.assignStaffService.execute({
        vendorId: ctx.vendorId,
        listId,
        staffId: BigInt(body.staffId),
        isPrimary: body.isPrimary,
        actorUserId: ctx.userId,
        actorRole: ctx.roleName,
        ip: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
      });
      sendCreated(res, result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/supply-lists/{listId}/staff/{staffId}:
   *   delete:
   *     tags: [Supply Lists]
   *     summary: Unassign a staff member from a supply list (owner only)
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Updated supply list }
   *       404: { description: List or assignment not found }
   */
  unassignStaff = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ctx = this.requireContext(req);
      const listId = this.parseId(req.params['listId'], 'Supply list not found');
      const staffId = this.parseId(req.params['staffId'], 'Assignment not found');
      const result = await this.unassignStaffService.execute({
        vendorId: ctx.vendorId,
        listId,
        staffId,
        actorUserId: ctx.userId,
        actorRole: ctx.roleName,
        ip: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
      });
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/supply-lists/{listId}/customers:
   *   get:
   *     tags: [Supply Lists]
   *     summary: List subscriptions on a supply list (owner or assigned staff)
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - { in: query, name: search, schema: { type: string } }
   *       - { in: query, name: status, schema: { type: string, enum: [active, paused, ended] } }
   *     responses:
   *       200: { description: Paginated subscriptions }
   *       404: { description: List not found or staff not assigned (masked) }
   */
  listCustomers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ctx = this.requireContext(req);
      const listId = this.parseId(req.params['listId'], 'Supply list not found');
      const q = req.query as Record<string, string | undefined>;
      const result = await this.listCustomersService.execute({
        vendorId: ctx.vendorId,
        listId,
        role: ctx.role,
        callerStaffId: ctx.staffId,
        ...(q['search'] ? { search: q['search'] } : {}),
        ...(q['status'] ? { status: q['status'] as 'active' | 'paused' | 'ended' } : {}),
        ...(q['page'] ? { page: Number(q['page']) } : {}),
        ...(q['limit'] ? { limit: Number(q['limit']) } : {}),
      });
      sendListResponse(res, result.data, result.meta);
    } catch (error) {
      next(error);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/supply-lists/{listId}/available-customers:
   *   get:
   *     tags: [Supply Lists]
   *     summary: List vendor customers not yet subscribed to this list (owner only)
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Paginated available customers }
   *       404: { description: List not found }
   */
  availableCustomers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ctx = this.requireContext(req);
      const listId = this.parseId(req.params['listId'], 'Supply list not found');
      const q = req.query as Record<string, string | undefined>;
      const result = await this.availableCustomersService.execute({
        vendorId: ctx.vendorId,
        listId,
        ...(q['search'] ? { search: q['search'] } : {}),
        ...(q['page'] ? { page: Number(q['page']) } : {}),
        ...(q['limit'] ? { limit: Number(q['limit']) } : {}),
      });
      sendListResponse(res, result.data, result.meta);
    } catch (error) {
      next(error);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/supply-lists/{listId}/customers:
   *   post:
   *     tags: [Supply Lists]
   *     summary: Add customers to a supply list in bulk (owner only)
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       201: { description: Added / skipped summary with subscriptions }
   *       409: { description: All selected customers already subscribed }
   *       422: { description: Customer not in vendor }
   */
  addCustomers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ctx = this.requireContext(req);
      const listId = this.parseId(req.params['listId'], 'Supply list not found');
      const body = req.body as AddCustomersInput;
      const result = await this.addCustomersService.execute({
        vendorId: ctx.vendorId,
        listId,
        customerIds: body.customerIds.map((id) => BigInt(id)),
        useDefaultQuantity: body.useDefaultQuantity,
        customQuantity: body.customQuantity ?? null,
        useDefaultRate: body.useDefaultRate,
        customRate: body.customRate ?? null,
        startDate: body.startDate ?? null,
        actorUserId: ctx.userId,
        actorRole: ctx.roleName,
        ip: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
      });
      sendCreated(res, result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/supply-lists/{listId}/customers/{subscriptionId}:
   *   patch:
   *     tags: [Supply Lists]
   *     summary: Update a subscription (quantity/rate/status — owner only)
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Updated subscription }
   *       404: { description: List or subscription not found }
   *       422: { description: Invalid status transition }
   */
  updateSubscription = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ctx = this.requireContext(req);
      const listId = this.parseId(req.params['listId'], 'Supply list not found');
      const subscriptionId = this.parseId(req.params['subscriptionId'], 'Subscription not found');
      const body = req.body as UpdateSubscriptionInput;
      const result = await this.updateSubscriptionService.execute({
        vendorId: ctx.vendorId,
        listId,
        subscriptionId,
        ...(body.quantity !== undefined ? { quantity: body.quantity } : {}),
        ...(body.ratePerUnit !== undefined ? { ratePerUnit: body.ratePerUnit } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        actorUserId: ctx.userId,
        actorRole: ctx.roleName,
        ip: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
      });
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/supply-lists/{listId}/customers/{subscriptionId}:
   *   delete:
   *     tags: [Supply Lists]
   *     summary: End a subscription (owner only, history preserved)
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Subscription ended }
   *       404: { description: List or subscription not found }
   */
  endSubscription = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ctx = this.requireContext(req);
      const listId = this.parseId(req.params['listId'], 'Supply list not found');
      const subscriptionId = this.parseId(req.params['subscriptionId'], 'Subscription not found');
      const result = await this.endSubscriptionService.execute({
        vendorId: ctx.vendorId,
        listId,
        subscriptionId,
        actorUserId: ctx.userId,
        actorRole: ctx.roleName,
        ip: req.ip ?? null,
        userAgent: req.headers['user-agent'] ?? null,
      });
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  private requireContext(req: Request): NonNullable<Request['roleContext']> {
    if (!req.roleContext) {
      throw new NotFoundError('Vendor not found');
    }
    return req.roleContext;
  }

  private parseId(raw: string | undefined, notFoundMessage: string): bigint {
    if (!raw || !/^\d+$/.test(raw)) {
      throw new NotFoundError(notFoundMessage);
    }
    return BigInt(raw);
  }
}
