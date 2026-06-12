# Feature: Audit & Accountability (US-007)

> Slug: `us-007-audit-accountability` | Backend-only run | 2026-06-12

## Complexity Assessment

- **Tier**: **Moderate** (read-heavy query module over existing write infrastructure).
- **Justification**: The audit **write** path already exists and is wired across every
  mutating module (`src/common/audit/audit-logger.ts`, `audit.port.ts`,
  `audit-action.enum.ts`) writing to the existing `audit_logs` Prisma model with full
  indexes (`vendorId`, `performedByUserId`, `createdAt`, `action`, `entityType`,
  `entityId`). US-007 is therefore **not** a green-field aggregate — it is a new
  read-only bounded context (`audit`) that exposes query endpoints over those rows,
  plus a CSV export. There are **no domain invariants to enforce on writes** (audit
  rows are immutable by construction — there is no UPDATE/DELETE path), so the domain
  layer is thin (read models + a derivation helper). This is heavier than Simple (it
  has staff-scoping ACL, conflict derivation, multi-source enrichment, CSV streaming)
  but lighter than Complex (no new aggregate, no state machine, no cross-module events).
- **Directory Structure** (commands/ + queries/ mandatory per MEMORY.md):
  ```
  src/modules/audit/
    audit.types.ts          # DTOs / read models (no Prisma types leak out)
    audit.validator.ts      # Zod schemas (query passthrough, export body strict)
    audit.reader.ts         # ACL over staff/customer/supply-list/user contexts
    audit.repository.port.ts # read port interface
    audit.repository.ts     # Prisma read adapter over audit_logs (+ overrides)
    audit.controller.ts     # HTTP handlers (delegates to queries/commands)
    audit.routes.ts         # composition root + middleware chain
    audit.shared.ts         # action-label map, role label helpers, CSV builder
    queries/
      list-audit-logs.query.ts
      get-conflicts.query.ts
      get-staff-summary.query.ts
      get-my-activity.query.ts
    commands/
      export-audit-logs.command.ts   # generates CSV (a Command — produces a file payload)
    __tests__/
      audit.query.test.ts
  ```

## Domain Model

There is **no new aggregate**. `audit_logs` rows are immutable records, not an
aggregate root with a lifecycle. US-007 introduces **read models** only:

- **AuditLogView** — one enriched audit row (timestamp, action, actor, staff, customer,
  supply list, details).
- **ConflictView** — a delivery whose latest vendor/customer override status differs from
  the staff-marked status (derived from existing `DeliveryOverride` rows, not a
  materialized view — see OQ-1).
- **StaffSummaryView** — per-staff aggregation of action counts, active days, first/last
  action time.
- **MyActivityView** — a staff member's own recent activity + today/week/month counts.

**Value Objects / Helpers**:
- `AuditActionLabel` — pure map from `audit_logs.action` slug → human label (in `audit.shared.ts`).
- Role label derivation: `performedByRole === 'vendor_owner' ? 'owner' : 'staff'` (matches `role-context.ts`).

**Aggregate Boundaries**: the `audit` context **owns nothing it writes** — it reads
`audit_logs` and, for conflicts, `delivery_overrides` / `daily_supplies`. All
cross-context reads go through `AuditReader` (an ACL), never by importing other modules'
domain classes. Consistent with `DeliveryReader`.

**Domain Events**: none. (Audit is the sink of events, not a source.)

## API Endpoints

All mounted at `/api/v1/vendors` (consistent with delivery/supply-list/staff).
Middleware chain: `authenticateToken → validate(params/query) → identifyUserRole('vendorId') → [requireOwnerRole()]`.

| # | Method | Path | CQS | Auth | Access |
|---|--------|------|-----|------|--------|
| 1 | GET | `/:vendorId/audit-logs` | Query | JWT | owner (full) / staff (own actions only) |
| 2 | GET | `/:vendorId/audit-logs/conflicts` | Query | JWT | owner only |
| 3 | GET | `/:vendorId/audit-logs/staff-summary` | Query | JWT | owner only |
| 4 | POST | `/:vendorId/audit-logs/export` | Command | JWT | owner only |
| 5 | GET | `/:vendorId/audit-logs/my-activity` | Query | JWT | member (owner or staff — returns caller's own) |

**Scoping decision (replaces the story's `/api/staff/my-activity` non-tenant route)**:
the project routes everything under `/:vendorId/...` so the JWT membership re-check in
`identifyUserRole` applies. `my-activity` therefore lives under the vendor path and
returns the **caller's own** activity regardless of role. This is documented in OQ-2.

**Zod patterns**:
- List/summary/conflicts queries: **passthrough** query schema (filters optional), with
  `z.coerce` for page/limit and ISO-date string validation.
- Export body: **strict** schema — `format` is `z.nativeEnum`-style enum limited to `csv`
  (see OQ-3: only CSV is implemented; `excel`/`pdf` rejected with 400).

**Error scenarios** (all carry `correlationId`):
- 400 `VALIDATION_ERROR` — bad date format, bad enum, limit > 100, unsupported export format.
- 401 `UNAUTHORIZED` — no/invalid token.
- 403 `FORBIDDEN` — staff hitting owner-only endpoints (conflicts / staff-summary / export).
- 404 `NOT_FOUND` — vendor not a membership of caller (masked by `identifyUserRole`).

## Data Model Changes

**None.** The existing `audit_logs` model already has every column and index this feature
needs (verified in `prisma/schema.prisma`):
```
vendorId, performedByUserId, performedByRole, action, entityType, entityId,
metadata (Json), ipAddress, userAgent, createdAt
@@index([vendorId]) [performedByUserId] [createdAt] [action] [entityType] [entityId]
```
- No new table, no migration, no enum change.
- **Seed**: add an `audit:read` permission row (resource:action) so staff who are granted
  it could be scoped — **but** for v1 the read endpoints are gated purely on owner vs
  staff (staff always see only their own), so no new permission key is strictly required.
  We add `audit:read` to the seed catalog as forward-compat (idempotent upsert per
  MEMORY.md) but routes do **not** require it (owner-only via `requireOwnerRole`,
  my-activity is self-scoped). Documented in OQ-4.

## Business Rules

- **Immutability**: enforced by absence of any write/update/delete code path. No endpoint
  mutates `audit_logs`. (Acceptance criterion 1.5.)
- **Owner full visibility**: owner endpoints query all rows for the vendor.
- **Staff self-only**: `audit-logs` (endpoint 1) for a staff caller forces
  `performedByUserId = ctx.userId`; `my-activity` always self-scoped.
- **Conflict detection**: a conflict exists for a `daily_supply` when the latest
  vendor/customer override `newStatus` differs from the staff-marked status. Derived from
  `delivery_overrides` rows in real time (reusing the delivery module's `deriveConflict`
  semantics, re-implemented in the audit reader to avoid importing delivery domain).
- **Export limit**: max 10,000 rows; CSV is generated in-memory and returned inline
  (see OQ-3 — no S3/signed URL in this environment; we return the CSV as a downloadable
  response payload).
- **Multi-tenant isolation**: every query is scoped by `vendorId` from `RoleContext`;
  wrong-tenant access is masked as 404 by `identifyUserRole`.

## Sequence (text)

```
GET /:vendorId/audit-logs?staffId=&actionType=&startDate=&endDate=&page=&limit=
  authenticateToken → validate(query) → identifyUserRole → controller.list
    → ListAuditLogsQuery.execute(ctx, filters)
        if ctx.role==='staff': force performedByUserId = ctx.userId
        repo.findLogs(vendorId, where, page, limit)  // audit_logs, orderBy createdAt desc
        reader.getUserNames([performedByUserId...])           // User
        reader.getCustomerNamesByEntity(rows)                 // VendorCustomer/Customer
        reader.getSupplyListNamesForDeliveries(rows)          // resolve via daily_supplies
        repo.distinctStaff(vendorId) + repo.distinctActions(vendorId)  // filter facets
    → map to AuditLogView[] + pagination meta + filters facet
  sendSuccess(res, {auditLogs, pagination, filters})
```

## Strategy Interfaces

None required. CSV generation is a pure function (`buildAuditCsv`) — no external
service. (If a storage provider is later introduced, `export` can delegate to a
`FileStoragePort`; deferred — OQ-3.)

## Error Handling Strategy

- Reuse `NotFoundError`, `ForbiddenError`, `ValidationError` from `@/common/errors/app-error`.
- `requireOwnerRole()` middleware already throws `ForbiddenError` for staff on owner routes.
- Date parsing failures → `ValidationError` (zod) before the handler runs.

## Security Considerations

- Owner-only endpoints enforced by `requireOwnerRole()` (defense in depth + service-level
  role check inside each owner query as a backstop).
- Staff endpoint 1 cannot widen scope — `performedByUserId` is overwritten server-side
  from `ctx.userId`, ignoring any `staffId` filter a staff caller supplies.
- `ipAddress`/`userAgent` are owner-visible only (omitted from staff `my-activity`).
- No PII beyond names already exposed elsewhere; CSV export is owner-only.

## Performance Considerations

- All filter combinations are served by existing indexes (`vendorId`, `createdAt`,
  `action`, `performedByUserId`, `entityType`, `entityId`).
- Enrichment (user/customer/supply-list names) is **batched** (N+1-free): collect ids
  across the page, then one `findMany` per related table keyed into a Map — same pattern
  as `DeliveryReader`.
- Pagination: `page`/`limit` (limit clamped ≤ 100). `total` via a parallel `count`.
- Conflicts and staff-summary cap at 100 / a bounded date window respectively.

## Open Questions

**Q1**: The story specifies PostgreSQL materialized views (`delivery_action_conflicts`,
`staff_activity_summary`) plus a refresh cron. The project uses Prisma and already models
delivery overrides in `delivery_overrides` (`actorRole`, `newStatus`, `createdAt`) — the
exact data a conflict needs — and ships a `deriveConflict` helper.
**Recommended**: Derive conflicts and staff summaries **on read** from `audit_logs` +
`delivery_overrides` via indexed Prisma queries (no materialized views, no refresh cron).
The data volume for a single vendor's hot window is small and fully indexed, so read-time
derivation meets the "loads within 2s" criterion without the operational cost of
materialized-view refresh, `REFRESH CONCURRENTLY` locks, and a Prisma-incompatible raw-SQL
migration.
**Trade-off**: Gains: zero migration/cron surface, always real-time (no staleness window),
stays within Prisma. Loses: at very large scale read-time aggregation is heavier than a
pre-computed view — revisit only if a vendor exceeds tens of thousands of monthly actions
(add a materialized view + cron then).

**Q2**: The story lists `GET /api/staff/my-activity` as a non-tenant-scoped route.
Every other endpoint in this codebase is `/:vendorId/...` so that `identifyUserRole` can
re-validate membership and tenant.
**Recommended**: Expose it as `GET /:vendorId/audit-logs/my-activity`, self-scoped to the
caller (`performedByUserId = ctx.userId`), available to both owner and staff.
**Trade-off**: Gains: uniform auth/tenant model, no special-case routing, owner can also
see their own activity. Loses: a staff member who belongs to multiple vendors must pick a
vendor in the path (acceptable — the app already scopes the active vendor).

**Q3**: The story's export returns a signed S3 `downloadUrl` with 1-hour expiry. There is
no object storage configured in this environment.
**Recommended**: `POST /audit-logs/export` returns the generated CSV **inline** as a
download (`Content-Type: text/csv`, `Content-Disposition: attachment`), capped at 10,000
rows. Only `format: "csv"` is accepted (`excel`/`pdf` → 400). A `FileStoragePort`
abstraction is noted for later if signed URLs become a requirement.
**Trade-off**: Gains: works today with no infra, simplest contract for the frontend
(download the response). Loses: no async/large-export story and no shareable URL — fine
for ≤10k rows; revisit with a storage provider for bigger exports.

**Q4**: Should staff read access be gated behind a granular `audit:read` permission?
**Recommended**: No granular gate in v1 — staff always see only their **own** activity
(`my-activity` + self-scoped `audit-logs`), and all cross-staff views are owner-only via
`requireOwnerRole()`. Add an idempotent `audit:read` permission to the seed catalog as
forward-compat but do not enforce it on routes yet.
**Trade-off**: Gains: simpler RBAC, matches the story ("staff can see only their own
activity"). Loses: an owner cannot yet delegate "view all staff activity" to a trusted
staff lead — add an `audit:read`-gated owner-equivalent path in a later story if needed.
