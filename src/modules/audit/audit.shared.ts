import { AuditAction } from '@/common/audit/audit-action.enum';
import { AuditLogView, RoleLabel } from './audit.types';

const APP_TIMEZONE_OFFSET_MIN = 330; // Asia/Kolkata (UTC+5:30), matches delivery.shared.

const OWNER_ROLE_NAME = 'vendor_owner';

/**
 * Human-readable labels for every known audit action slug. Falls back to a
 * humanized version of the slug for any action not explicitly mapped.
 */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  [AuditAction.STAFF_INVITED]: 'Staff Invited',
  [AuditAction.STAFF_JOINED]: 'Staff Joined',
  [AuditAction.STAFF_DISABLED]: 'Staff Disabled',
  [AuditAction.STAFF_ENABLED]: 'Staff Enabled',
  [AuditAction.STAFF_REMOVED]: 'Staff Removed',
  [AuditAction.STAFF_PERMISSIONS_CHANGED]: 'Staff Permissions Changed',
  [AuditAction.STAFF_INVITE_RESENT]: 'Staff Invite Resent',
  [AuditAction.STAFF_LIST_ASSIGNED]: 'Staff Assigned to List',
  [AuditAction.STAFF_LIST_UNASSIGNED]: 'Staff Unassigned from List',
  [AuditAction.LIST_CREATED]: 'Supply List Created',
  [AuditAction.LIST_UPDATED]: 'Supply List Updated',
  [AuditAction.LIST_ARCHIVED]: 'Supply List Archived',
  [AuditAction.LIST_STAFF_ASSIGNED]: 'List Staff Assigned',
  [AuditAction.LIST_STAFF_UNASSIGNED]: 'List Staff Unassigned',
  [AuditAction.CUSTOMERS_ADDED]: 'Customers Added',
  [AuditAction.SUBSCRIPTION_UPDATED]: 'Subscription Updated',
  [AuditAction.SUBSCRIPTION_ENDED]: 'Subscription Ended',
  [AuditAction.DELIVERY_MARKED]: 'Delivery Marked',
  [AuditAction.DELIVERIES_BULK_MARKED]: 'Deliveries Bulk Marked',
  [AuditAction.EXTRA_CHARGE_ADDED]: 'Extra Charge Added',
  [AuditAction.LEAVE_MARKED]: 'Leave Marked',
  [AuditAction.LEAVE_CANCELLED]: 'Leave Cancelled',
  [AuditAction.DELIVERIES_GENERATED]: 'Deliveries Generated',
  [AuditAction.PAYMENT_MARKED]: 'Payment Recorded',
};

/** Human label for an action slug; humanizes unknown slugs. */
export function actionLabel(slug: string): string {
  const known = AUDIT_ACTION_LABELS[slug];
  if (known) return known;
  return slug
    .split('_')
    .map((w) => (w.length > 0 ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/** Map a raw role slug to the owner/staff label (null → owner, e.g. system). */
export function roleLabel(performedByRole: string | null): RoleLabel {
  return performedByRole === OWNER_ROLE_NAME || performedByRole === null ? 'owner' : 'staff';
}

/** Current service date (UTC midnight) in the app timezone. */
export function appToday(now: Date = new Date()): Date {
  const shifted = new Date(now.getTime() + APP_TIMEZONE_OFFSET_MIN * 60_000);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
}

/** Start of the ISO week (Monday) containing today, in the app timezone. */
export function startOfWeek(now: Date = new Date()): Date {
  const today = appToday(now);
  const jsDay = today.getUTCDay(); // 0=Sun..6=Sat
  const sinceMonday = jsDay === 0 ? 6 : jsDay - 1;
  return new Date(today.getTime() - sinceMonday * 86_400_000);
}

/** First day of the current month, in the app timezone. */
export function startOfMonth(now: Date = new Date()): Date {
  const today = appToday(now);
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
}

function csvCell(value: unknown): string {
  const str =
    value === null || value === undefined
      ? ''
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
  return `"${str.replace(/"/g, '""')}"`;
}

/** Build an RFC-4180 CSV string from enriched audit rows. */
export function buildAuditCsv(rows: AuditLogView[]): string {
  const header = ['Timestamp', 'Action', 'User', 'Role', 'Customer', 'Supply List', 'Details'];
  const lines = [header.map(csvCell).join(',')];
  for (const row of rows) {
    lines.push(
      [
        row.timestamp,
        row.actionLabel,
        row.user.name ?? '',
        row.user.role,
        row.customer?.name ?? '',
        row.supplyList?.name ?? '',
        row.details,
      ]
        .map(csvCell)
        .join(',')
    );
  }
  return lines.join('\r\n');
}
