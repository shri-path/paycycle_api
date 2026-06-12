/**
 * Read port for the audit context. The adapter reads `audit_logs` (and, for
 * conflict derivation, `supply_overrides` + `daily_supplies`). All methods are
 * vendor-scoped. There is no write path — audit rows are immutable.
 */

/** A raw audit_logs row projected to plain fields. */
export interface AuditLogRow {
  id: bigint;
  createdAt: Date;
  action: string;
  entityType: string | null;
  entityId: bigint | null;
  performedByUserId: bigint | null;
  performedByRole: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
}

/** Filters resolved to concrete values for the repository where-clause. */
export interface AuditLogWhere {
  vendorId: bigint;
  performedByUserId?: bigint;
  customerEntityId?: bigint;
  actionType?: string;
  entityType?: string;
  /** inclusive lower bound (createdAt >=) */
  createdFrom?: Date;
  /** exclusive upper bound (createdAt <) — caller sets to end-of-day+1 */
  createdToExclusive?: Date;
}

/** A staff action row used by the staff-summary aggregation. */
export interface StaffActionRow {
  performedByUserId: bigint | null;
  action: string;
  createdAt: Date;
}

/** A delivery + its staff mark + latest contradicting override (for conflicts). */
export interface ConflictRow {
  dailySupplyId: bigint;
  serviceDate: Date;
  supplyListId: bigint;
  supplyListCustomerId: bigint;
  customerId: bigint;
  status: string;
  markedByUserId: bigint | null;
  markedAt: Date | null;
  overrideStatus: string;
  overrideRole: string; // ActorRole slug
  overrideAt: Date;
}

export interface IAuditRepository {
  /** Paginated audit rows (createdAt desc) + total count. */
  findLogs(
    where: AuditLogWhere,
    page: number,
    limit: number
  ): Promise<{ rows: AuditLogRow[]; total: number }>;

  /** Up to `cap` rows for export (createdAt desc), no pagination. */
  findForExport(where: AuditLogWhere, cap: number): Promise<AuditLogRow[]>;

  /** Distinct acting staff (excludes owner) for the filter facet. */
  distinctStaff(vendorId: bigint): Promise<Array<{ id: bigint; name: string | null }>>;

  /** Distinct action slugs present for the vendor. */
  distinctActions(vendorId: bigint): Promise<string[]>;

  /** Staff action rows for the summary, optionally filtered by staff/date window. */
  findStaffActions(
    vendorId: bigint,
    filters: { staffId?: bigint; createdFrom?: Date; createdToExclusive?: Date }
  ): Promise<StaffActionRow[]>;

  /** Deliveries whose latest vendor/customer override status differs from the staff mark. */
  findConflicts(vendorId: bigint, cap: number): Promise<ConflictRow[]>;

  /** Self-scoped recent activity rows (createdAt desc, capped). */
  findMyActivity(vendorId: bigint, userId: bigint, cap: number): Promise<AuditLogRow[]>;

  /** Count of the caller's own actions since a boundary date. */
  countMyActionsSince(vendorId: bigint, userId: bigint, since: Date): Promise<number>;
}
