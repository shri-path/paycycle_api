/**
 * Canonical audit action identifiers written to `audit_logs.action`.
 * US-002 owns the staff actions; placeholders for later user stories are
 * listed so downstream modules log through the same vocabulary.
 */
export enum AuditAction {
  // Staff & access (US-002)
  STAFF_INVITED = 'staff_invited',
  STAFF_JOINED = 'staff_joined',
  STAFF_DISABLED = 'staff_disabled',
  STAFF_ENABLED = 'staff_enabled',
  STAFF_REMOVED = 'staff_removed',
  STAFF_PERMISSIONS_CHANGED = 'staff_permissions_changed',
  STAFF_INVITE_RESENT = 'staff_invite_resent',
  // US-005 forward-compat: emitted by the real list-assignment write adapter.
  STAFF_LIST_ASSIGNED = 'staff_list_assigned',
  STAFF_LIST_UNASSIGNED = 'staff_list_unassigned',

  // Placeholders for later user stories (referenced for forward-compat)
  LIST_CREATED = 'list_created',
  LIST_UPDATED = 'list_updated',
  DELIVERY_MARKED = 'delivery_marked',
  PAYMENT_MARKED = 'payment_marked',
}
