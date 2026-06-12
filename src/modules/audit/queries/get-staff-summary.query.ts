import { ForbiddenError } from '@/common/errors/app-error';
import { RoleContext } from '@/infrastructure/middlewares/rbac/role-context';
import { IAuditRepository, StaffActionRow } from '../audit.repository.port';
import { AuditReader } from '../audit.reader';
import { actionLabel, appToday } from '../audit.shared';
import {
  GetStaffSummaryResultDto,
  StaffSummaryActionTypeDto,
  StaffSummaryDateDto,
  StaffSummaryView,
} from '../audit.types';

interface SummaryFilters {
  staffId?: bigint;
  startDate?: Date;
  endDate?: Date;
}

/** Query (owner only): per-staff activity aggregation. */
export class GetStaffSummaryQuery {
  constructor(
    private readonly repository: IAuditRepository,
    private readonly reader: AuditReader
  ) {}

  async execute(ctx: RoleContext, filters: SummaryFilters): Promise<GetStaffSummaryResultDto> {
    if (ctx.role !== 'owner') {
      throw new ForbiddenError('This action requires owner privileges');
    }

    const rows = await this.repository.findStaffActions(ctx.vendorId, {
      ...(filters.staffId !== undefined ? { staffId: filters.staffId } : {}),
      ...(filters.startDate !== undefined ? { createdFrom: filters.startDate } : {}),
      ...(filters.endDate !== undefined
        ? { createdToExclusive: new Date(filters.endDate.getTime() + 86_400_000) }
        : {}),
    });

    const byStaff = new Map<string, StaffActionRow[]>();
    for (const r of rows) {
      if (r.performedByUserId === null) continue;
      const key = r.performedByUserId.toString();
      const list = byStaff.get(key) ?? [];
      list.push(r);
      byStaff.set(key, list);
    }

    const staffIds = [...byStaff.keys()].map((s) => BigInt(s));
    const staffNames = await this.reader.getUserNames(staffIds);

    const summary: StaffSummaryView[] = [];
    for (const [staffId, actions] of byStaff.entries()) {
      summary.push(this.aggregate(staffId, staffNames.get(staffId) ?? null, actions));
    }
    // Stable order: most active first.
    summary.sort((a, b) => b.totalActions - a.totalActions);

    return { summary };
  }

  private aggregate(
    staffId: string,
    staffName: string | null,
    actions: StaffActionRow[]
  ): StaffSummaryView {
    const byTypeMap = new Map<string, { count: number; first: Date; last: Date }>();
    const byDateMap = new Map<string, { count: number; first: Date; last: Date }>();

    for (const a of actions) {
      const t = byTypeMap.get(a.action);
      if (t) {
        t.count += 1;
        if (a.createdAt < t.first) t.first = a.createdAt;
        if (a.createdAt > t.last) t.last = a.createdAt;
      } else {
        byTypeMap.set(a.action, { count: 1, first: a.createdAt, last: a.createdAt });
      }

      const dateKey = this.dateKey(a.createdAt);
      const d = byDateMap.get(dateKey);
      if (d) {
        d.count += 1;
        if (a.createdAt < d.first) d.first = a.createdAt;
        if (a.createdAt > d.last) d.last = a.createdAt;
      } else {
        byDateMap.set(dateKey, { count: 1, first: a.createdAt, last: a.createdAt });
      }
    }

    const byActionType: StaffSummaryActionTypeDto[] = [...byTypeMap.entries()]
      .map(([type, v]) => ({
        actionType: type,
        actionLabel: actionLabel(type),
        count: v.count,
        firstActionAt: v.first.toISOString(),
        lastActionAt: v.last.toISOString(),
      }))
      .sort((a, b) => b.count - a.count);

    const byDate: StaffSummaryDateDto[] = [...byDateMap.entries()]
      .map(([date, v]) => ({
        date,
        actionCount: v.count,
        firstActionAt: v.first.toISOString(),
        lastActionAt: v.last.toISOString(),
      }))
      .sort((a, b) => (a.date < b.date ? 1 : -1));

    const totalActions = actions.length;
    const activeDays = byDateMap.size;

    return {
      staffId,
      staffName,
      byActionType,
      byDate,
      totalActions,
      activeDays,
      avgActionsPerDay: activeDays > 0 ? Math.round(totalActions / activeDays) : 0,
    };
  }

  /** YYYY-MM-DD in the app timezone. */
  private dateKey(d: Date): string {
    return appToday(d).toISOString().slice(0, 10);
  }
}
