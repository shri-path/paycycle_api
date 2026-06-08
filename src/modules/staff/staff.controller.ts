import { Request, Response, NextFunction } from 'express';
import { ListQueryParams } from '@/common/api-wrapper/types';
import { sendSuccess, sendCreated, sendListResponse } from '@/common/api-wrapper/response.util';
import { NotFoundError } from '@/common/errors/app-error';
import { PermissionKey } from './domain/value-objects/permission-key.value-object';
import { InviteStaffService } from './commands/invite-staff/invite-staff.service';
import { UpdateStaffService } from './commands/update-staff/update-staff.service';
import { RemoveStaffService } from './commands/remove-staff/remove-staff.service';
import { ListStaffService } from './queries/list-staff/list-staff.service';
import { GetStaffService } from './queries/get-staff/get-staff.service';
import { GetMyRoleService } from './queries/get-my-role/get-my-role.service';

/**
 * Staff & access HTTP handlers. vendorId is taken from the route and is already
 * validated against an ACTIVE membership by identifyUserRole. performedBy comes
 * from req.roleContext / req.user — never from the request body.
 */
export class StaffController {
  constructor(
    private readonly inviteStaffService: InviteStaffService,
    private readonly updateStaffService: UpdateStaffService,
    private readonly removeStaffService: RemoveStaffService,
    private readonly listStaffService: ListStaffService,
    private readonly getStaffService: GetStaffService,
    private readonly getMyRoleService: GetMyRoleService
  ) {}

  /**
   * @openapi
   * /vendors/{vendorId}/role:
   *   get:
   *     tags: [Staff & Access]
   *     summary: Resolve the caller's role and permissions in a vendor
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: vendorId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Role context }
   *       401: { description: Unauthenticated }
   *       404: { description: No membership in vendor }
   */
  getMyRole = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ctx = this.requireContext(req);
      const result = await this.getMyRoleService.execute({
        vendorId: ctx.vendorId,
        userId: ctx.userId,
      });
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/staff:
   *   get:
   *     tags: [Staff & Access]
   *     summary: List staff (owner only)
   *     security: [{ bearerAuth: [] }]
   *     parameters:
   *       - in: path
   *         name: vendorId
   *         required: true
   *         schema: { type: string }
   *     responses:
   *       200: { description: Paginated staff list }
   *       403: { description: Requires owner privileges }
   *       404: { description: Vendor not found }
   */
  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ctx = this.requireContext(req);
      const result = await this.listStaffService.execute({
        vendorId: ctx.vendorId,
        query: req.query as unknown as ListQueryParams,
      });
      sendListResponse(res, result.data, result.meta);
    } catch (error) {
      next(error);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/staff/{staffId}:
   *   get:
   *     tags: [Staff & Access]
   *     summary: Get a staff member (owner only)
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Staff detail }
   *       403: { description: Requires owner privileges }
   *       404: { description: Staff not found }
   */
  get = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ctx = this.requireContext(req);
      const staffId = this.parseId(req.params['staffId']);
      const result = await this.getStaffService.execute({ vendorId: ctx.vendorId, staffId });
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * @openapi
   * /vendors/{vendorId}/staff/invite:
   *   post:
   *     tags: [Staff & Access]
   *     summary: Invite a staff member (owner only)
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       201: { description: Invitation created with invite URL }
   *       403: { description: Requires owner privileges }
   *       409: { description: Already a staff member }
   *       451: { description: Subscription staff limit reached }
   */
  invite = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ctx = this.requireContext(req);
      const body = req.body as {
        phone: string;
        name?: string;
        areaRouteLabel?: string;
        permissions?: PermissionKey[];
      };
      const result = await this.inviteStaffService.execute({
        vendorId: ctx.vendorId,
        invitedByUserId: ctx.userId,
        invitedByRole: ctx.roleName,
        phone: body.phone,
        name: body.name ?? null,
        areaRouteLabel: body.areaRouteLabel ?? null,
        permissions: body.permissions ?? [],
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
   * /vendors/{vendorId}/staff/{staffId}:
   *   patch:
   *     tags: [Staff & Access]
   *     summary: Update a staff member (owner only)
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Updated staff }
   *       403: { description: Requires owner privileges }
   *       404: { description: Staff not found }
   *       422: { description: Invalid status transition }
   */
  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ctx = this.requireContext(req);
      const staffId = this.parseId(req.params['staffId']);
      const body = req.body as {
        status?: 'ACTIVE' | 'DISABLED';
        areaRouteLabel?: string | null;
        permissions?: PermissionKey[];
      };
      const result = await this.updateStaffService.execute({
        vendorId: ctx.vendorId,
        staffId,
        performedByUserId: ctx.userId,
        performedByRole: ctx.roleName,
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.areaRouteLabel !== undefined ? { areaRouteLabel: body.areaRouteLabel } : {}),
        ...(body.permissions !== undefined ? { permissions: body.permissions } : {}),
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
   * /vendors/{vendorId}/staff/{staffId}:
   *   delete:
   *     tags: [Staff & Access]
   *     summary: Remove a staff member (owner only, soft-remove)
   *     security: [{ bearerAuth: [] }]
   *     responses:
   *       200: { description: Removed staff summary }
   *       403: { description: Requires owner privileges }
   *       404: { description: Staff not found }
   */
  remove = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ctx = this.requireContext(req);
      const staffId = this.parseId(req.params['staffId']);
      const result = await this.removeStaffService.execute({
        vendorId: ctx.vendorId,
        staffId,
        performedByUserId: ctx.userId,
        performedByRole: ctx.roleName,
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

  private parseId(raw: string | undefined): bigint {
    if (!raw || !/^\d+$/.test(raw)) {
      throw new NotFoundError('Staff member not found');
    }
    return BigInt(raw);
  }
}
