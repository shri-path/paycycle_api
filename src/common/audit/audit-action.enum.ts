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

  // Supply lists & subscriptions (US-005)
  LIST_CREATED = 'list_created',
  LIST_UPDATED = 'list_updated',
  LIST_ARCHIVED = 'list_archived',
  LIST_STAFF_ASSIGNED = 'list_staff_assigned',
  LIST_STAFF_UNASSIGNED = 'list_staff_unassigned',
  CUSTOMERS_ADDED = 'customers_added',
  SUBSCRIPTION_UPDATED = 'subscription_updated',
  SUBSCRIPTION_ENDED = 'subscription_ended',

  // Delivery tracking (US-006)
  DELIVERY_MARKED = 'delivery_marked',
  DELIVERIES_BULK_MARKED = 'deliveries_bulk_marked',
  EXTRA_CHARGE_ADDED = 'extra_charge_added',
  LEAVE_MARKED = 'leave_marked',
  LEAVE_CANCELLED = 'leave_cancelled',
  DELIVERIES_GENERATED = 'deliveries_generated',

  // Placeholders for later user stories (referenced for forward-compat)
  PAYMENT_MARKED = 'payment_marked',
}
