# Domain Model — Audit & Accountability (US-007)

> Read-only context. No aggregate, no write invariants. Read models + pure helpers only.

## Read Models (DTOs in `audit.types.ts`)

### AuditLogView
| Field | Type | Notes |
|-------|------|-------|
| id | string | bigint → string |
| timestamp | ISO8601 | `createdAt` |
| actionType | string | `audit_logs.action` slug |
| actionLabel | string | from `AuditActionLabel` map |
| entityType | string \| null | snake_case (`daily_supply`, `customer`, ...) |
| entityId | string \| null | |
| user | `{ id, name, role }` | role = owner\|staff from `performedByRole` |
| customer | `{ id, name } \| null` | resolved when derivable |
| supplyList | `{ id, name } \| null` | resolved for delivery entities |
| details | object | raw `metadata` JSON (owner) / trimmed (staff) |
| ipAddress | string \| null | **owner-only** (omitted for staff) |

### ConflictView
| Field | Type |
|-------|------|
| id | string (daily_supply id) |
| deliveryDate | ISO date |
| customer | `{ id, name }` |
| supplyList | `{ id, name }` |
| staffAction | `{ timestamp, staff: { id, name }, status }` |
| overrideAction | `{ timestamp, by: 'owner'\|'customer', status, timeDiffMinutes }` |

### StaffSummaryView
| Field | Type |
|-------|------|
| staffId | string |
| staffName | string \| null |
| byActionType | `{ actionType, actionLabel, count, firstActionAt, lastActionAt }[]` |
| byDate | `{ date, actionCount, firstActionAt, lastActionAt }[]` |
| totalActions | number |
| activeDays | number |
| avgActionsPerDay | number |

### MyActivityView
| Field | Type |
|-------|------|
| activity | `{ id, timestamp, actionType, actionLabel, customer?, supplyList?, details }[]` |
| summary | `{ todayActions, thisWeekActions, thisMonthActions }` |

## Pure Helpers (`audit.shared.ts`)

- `AUDIT_ACTION_LABELS: Record<string,string>` + `actionLabel(slug): string`
  (fallback: humanize the slug).
- `roleLabel(performedByRole: string|null): 'owner'|'staff'`
  (`=== 'vendor_owner' → owner`, else `staff`; null → `owner`).
- `buildAuditCsv(rows: AuditLogView[]): string` — RFC-4180 CSV with header
  `Timestamp,Action,User,Role,Customer,Supply List,Details`; quotes escaped by doubling.
- `appToday`/week/month boundaries reused from a small local helper (Asia/Kolkata offset,
  matching `delivery.shared.appToday`).

## Conflict Derivation (read-time, no materialized view)

Input per `daily_supply`: its staff-mark (status + actor) and the ordered
`delivery_overrides` rows (`actorRole`, `newStatus`, `createdAt`).
A conflict exists when the **latest** vendor/customer override `newStatus` differs from the
status the staff member marked. `timeDiffMinutes = (overrideCreatedAt - staffActionAt)/60000`.
`by = actorRole === 'customer' ? 'customer' : 'owner'`.

## Multi-tenant & Scoping Rules

- All reads scoped by `ctx.vendorId`.
- Staff caller on `audit-logs`: `where.performedByUserId = ctx.userId` (forced).
- `my-activity`: always `where.performedByUserId = ctx.userId`.
- Owner-only queries additionally guarded by `requireOwnerRole()` + a service backstop
  (`if ctx.role !== 'owner' throw ForbiddenError`).
