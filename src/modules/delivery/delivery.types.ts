import { ActorRole, DailySupplyStatus, LeaveType } from '@prisma/client';

/** Re-export the Prisma enums so callers depend on the module surface, not @prisma/client. */
export { ActorRole, DailySupplyStatus, LeaveType };

/** Marking statuses a client may request via the mark endpoint. */
export type MarkableStatus = 'DELIVERED' | 'LEAVE';

/** The acting persona resolved from the request context. */
export type ActorRoleLabel = 'owner' | 'staff' | 'customer' | 'system';

/** Who marked a delivery, as returned to clients. */
export interface MarkedByDto {
  userId: string;
  name: string | null;
  role: ActorRoleLabel;
}

/** A single delivery card for the per-list view. */
export interface DeliveryDto {
  id: string;
  customer: {
    id: string;
    name: string | null;
    address: string | null;
    phoneNumber: string | null;
  };
  quantity: number;
  unit: string;
  /** Owner-only — omitted for staff. */
  ratePerUnit?: number;
  /** Owner-only — omitted for staff. */
  amount?: number;
  status: DailySupplyStatus;
  markedBy: MarkedByDto | null;
  markedAt: string | null;
  hasConflict: boolean;
  conflictReason: string | null;
  otherLists: string[];
}

/** Response of PATCH /deliveries/:id/mark. */
export interface MarkDeliveryResultDto {
  delivery: DeliveryDto;
  hasConflict: boolean;
}

/** Response of POST /deliveries/mark-bulk. */
export interface MarkBulkResultDto {
  updated: number;
  skipped: number;
}

/** Today summary roll-up. */
export interface TodaySummaryDto {
  totalDeliveries: number;
  delivered: number;
  onLeave: number;
  pending: number;
  autoMarked: number;
  revenue: string;
  conflicts: number;
}

/** Per-list roll-up inside the today view. */
export interface TodayListDto {
  listId: string;
  listName: string;
  startTime: string | null;
  staff: Array<{ staffId: string; name: string | null }>;
  totalCustomers: number;
  delivered: number;
  onLeave: number;
  pending: number;
  /** Owner-only. */
  revenue?: string;
}

/** A conflict surfaced in the today view. */
export interface TodayConflictDto {
  deliveryId: string;
  customerName: string | null;
  listName: string;
  reason: string;
}

/** Response of GET /deliveries/today. */
export interface TodayResultDto {
  date: string;
  summary: TodaySummaryDto;
  byList: TodayListDto[];
  conflicts: TodayConflictDto[];
}

/** Response of GET /supply-lists/:listId/deliveries. */
export interface ListDeliveriesResultDto {
  listId: string;
  listName: string;
  date: string;
  progress: { total: number; delivered: number; onLeave: number; pending: number };
  deliveries: DeliveryDto[];
}

/** Response of POST /extra-charges. */
export interface ExtraChargeResultDto {
  id: string;
  dailySupplyId: string;
  amount: number;
  comment: string;
  addedBy: MarkedByDto | null;
  createdAt: string;
}

/** A single leave row in the create-leave result. */
export interface LeaveDto {
  id: string;
  customerId: string;
  supplyListId: string;
  startDate: string;
  endDate: string;
  leaveType: LeaveType;
}

/** Response of POST /leaves. */
export interface CreateLeaveResultDto {
  created: number;
  leaves: LeaveDto[];
  affectedDeliveries: number;
}

/** Response of GET /leaves. */
export interface ListLeavesResultDto {
  today: Array<{ id: string; customerName: string | null; listName: string; date: string }>;
  upcoming: Array<{
    id: string;
    customerName: string | null;
    listName: string;
    startDate: string;
    endDate: string;
    daysCount: number;
  }>;
}

/** Response of DELETE /leaves/:id. */
export interface CancelLeaveResultDto {
  revertedDeliveries: number;
}

/** A single day cell in the calendar. */
export interface CalendarDayDto {
  status: 'completed' | 'has_leaves' | 'pending' | 'has_conflicts';
  delivered: number;
  leaves: number;
  revenue: string;
}

/** Response of GET /deliveries/calendar. */
export interface CalendarResultDto {
  month: string;
  summary: { totalDeliveries: number; totalLeaves: number; revenue: string };
  days: Record<string, CalendarDayDto>;
}

/** Response of GET /deliveries/date/:date. */
export interface DateDetailResultDto {
  date: string;
  summary: { totalDeliveries: number; leaves: number; revenue: string };
  byList: Array<{
    listId: string;
    listName: string;
    startTime: string | null;
    staffName: string | null;
    delivered: number;
    leaves: number;
    revenue: string;
  }>;
  extraCharges: Array<{
    customerName: string | null;
    listName: string;
    amount: number;
    reason: string;
  }>;
  leaves: Array<{ customerName: string | null; listName: string; markedBy: ActorRoleLabel }>;
}

/** Response of POST /deliveries/generate. */
export interface GenerateResultDto {
  generated: number;
  skipped: number;
  date: string;
}
