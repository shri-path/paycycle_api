import { ForbiddenError } from '@/common/errors/app-error';
import { RoleContext } from '@/infrastructure/middlewares/rbac/role-context';
import { IAuditRepository } from '../audit.repository.port';
import { AuditReader } from '../audit.reader';
import { ConflictView, GetConflictsResultDto } from '../audit.types';

const CONFLICT_CAP = 100;

/**
 * Query (owner only): deliveries where an owner/customer override status
 * contradicts the staff-marked status. Derived in real time from supply_overrides.
 */
export class GetConflictsQuery {
  constructor(
    private readonly repository: IAuditRepository,
    private readonly reader: AuditReader
  ) {}

  async execute(ctx: RoleContext): Promise<GetConflictsResultDto> {
    if (ctx.role !== 'owner') {
      throw new ForbiddenError('This action requires owner privileges');
    }

    const rows = await this.repository.findConflicts(ctx.vendorId, CONFLICT_CAP);

    const staffIds = rows.map((r) => r.markedByUserId).filter((id): id is bigint => id !== null);
    const [staffNames, customerNames, listNames] = await Promise.all([
      this.reader.getUserNames(staffIds),
      this.reader.getCustomerNames(
        ctx.vendorId,
        rows.map((r) => r.customerId)
      ),
      this.reader.getSupplyListNames(
        ctx.vendorId,
        rows.map((r) => r.supplyListId)
      ),
    ]);

    const conflicts: ConflictView[] = rows.map((r) => {
      const timeDiffMinutes =
        r.markedAt !== null
          ? Math.round((r.overrideAt.getTime() - r.markedAt.getTime()) / 60_000)
          : 0;
      return {
        id: r.dailySupplyId.toString(),
        deliveryDate: r.serviceDate.toISOString().slice(0, 10),
        customer: {
          id: r.customerId.toString(),
          name: customerNames.get(r.customerId.toString()) ?? null,
        },
        supplyList: {
          id: r.supplyListId.toString(),
          name: listNames.get(r.supplyListId.toString()) ?? null,
        },
        staffAction: {
          timestamp: (r.markedAt ?? r.overrideAt).toISOString(),
          staff: {
            id: r.markedByUserId !== null ? r.markedByUserId.toString() : '',
            name:
              r.markedByUserId !== null
                ? (staffNames.get(r.markedByUserId.toString()) ?? null)
                : null,
          },
          status: r.status,
        },
        overrideAction: {
          timestamp: r.overrideAt.toISOString(),
          by: r.overrideRole === 'CUSTOMER' ? 'customer' : 'owner',
          status: r.overrideStatus,
          timeDiffMinutes,
        },
      };
    });

    return { conflicts };
  }
}
