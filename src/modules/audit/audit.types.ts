/**
 * Read models / DTOs for the audit (read-only) bounded context.
 * No @prisma/client types leak through these shapes — all ids are strings.
 */

export type RoleLabel = 'owner' | 'staff';

export interface AuditUserDto {
  id: string;
  name: string | null;
  role: RoleLabel;
}

export interface NamedRefDto {
  id: string;
  name: string | null;
}

export interface AuditLogView {
  id: string;
  timestamp: string; // ISO8601
  actionType: string;
  actionLabel: string;
  entityType: string | null;
  entityId: string | null;
  user: AuditUserDto;
  customer: NamedRefDto | null;
  supplyList: NamedRefDto | null;
  details: Record<string, unknown>;
  /** Owner-only; omitted (undefined) for staff callers. */
  ipAddress?: string | null;
}

export interface PaginationDto {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface AuditFiltersFacetDto {
  availableStaff: NamedRefDto[];
  availableActionTypes: string[];
}

export interface ListAuditLogsResultDto {
  auditLogs: AuditLogView[];
  pagination: PaginationDto;
  filters: AuditFiltersFacetDto;
}

export interface ConflictView {
  id: string; // daily supply id
  deliveryDate: string; // YYYY-MM-DD
  customer: NamedRefDto;
  supplyList: NamedRefDto;
  staffAction: {
    timestamp: string;
    staff: NamedRefDto;
    status: string;
  };
  overrideAction: {
    timestamp: string;
    by: 'owner' | 'customer';
    status: string;
    timeDiffMinutes: number;
  };
}

export interface GetConflictsResultDto {
  conflicts: ConflictView[];
}

export interface StaffSummaryActionTypeDto {
  actionType: string;
  actionLabel: string;
  count: number;
  firstActionAt: string;
  lastActionAt: string;
}

export interface StaffSummaryDateDto {
  date: string; // YYYY-MM-DD
  actionCount: number;
  firstActionAt: string;
  lastActionAt: string;
}

export interface StaffSummaryView {
  staffId: string;
  staffName: string | null;
  byActionType: StaffSummaryActionTypeDto[];
  byDate: StaffSummaryDateDto[];
  totalActions: number;
  activeDays: number;
  avgActionsPerDay: number;
}

export interface GetStaffSummaryResultDto {
  summary: StaffSummaryView[];
}

export interface MyActivityItemDto {
  id: string;
  timestamp: string;
  actionType: string;
  actionLabel: string;
  customer: NamedRefDto | null;
  supplyList: NamedRefDto | null;
  details: Record<string, unknown>;
}

export interface GetMyActivityResultDto {
  activity: MyActivityItemDto[];
  summary: {
    todayActions: number;
    thisWeekActions: number;
    thisMonthActions: number;
  };
}

/** Filters accepted by the list / export query builders. */
export interface AuditLogFilters {
  staffId?: bigint;
  customerId?: bigint;
  actionType?: string;
  entityType?: string;
  startDate?: Date;
  endDate?: Date;
  page?: number;
  limit?: number;
}

export interface ExportResult {
  filename: string;
  csv: string;
}
