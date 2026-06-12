# Feature Tasks — Audit & Accountability (US-007)

## Complexity: Moderate — Skills: domain-modeling, validation-schemas, repository-implementation, service-implementation, module-scaffold, testing-strategy

Single-developer sequential execution (no sub-agent dispatch available). Tasks are still
grouped into phases so each builds on completed prior phases.

---

### Phase 1 — Foundation

#### Task 1: Types & read models — `src/modules/audit/audit.types.ts`
Define `AuditLogView`, `ConflictView`, `StaffSummaryView`, `MyActivityView`, plus the
list/pagination/filters result DTO. No `@prisma/client` types in exported shapes (all ids
as `string`). Per DOMAIN_MODEL.md tables.

#### Task 2: Shared helpers — `src/modules/audit/audit.shared.ts`
- `AUDIT_ACTION_LABELS` map (cover every `AuditAction` enum value) + `actionLabel(slug)`.
- `roleLabel(performedByRole)`.
- `buildAuditCsv(rows)` RFC-4180.
- date-window helpers `appToday/startOfWeek/startOfMonth` (Asia/Kolkata offset 330).

#### Task 3: Validators — `src/modules/audit/audit.validator.ts`
- `vendorIdParamSchema` (reuse pattern: `{ vendorId: string regex \d+ }`).
- `listQuerySchema` (passthrough; coerce page/limit, clamp limit ≤ 100; ISO date strings).
- `staffSummaryQuerySchema`, `conflictsQuerySchema`.
- `exportBodySchema` (strict; `format` literal `'csv'`; optional filters).

---

### Phase 2 — Data Access

#### Task 4: Repository port — `src/modules/audit/audit.repository.port.ts`
Interface `IAuditRepository`:
- `findLogs(vendorId, where, page, limit): { rows, total }`
- `countLogs(...)` (or fold into findLogs)
- `distinctStaff(vendorId): {id,name|null}[]`
- `distinctActions(vendorId): string[]`
- `findForExport(vendorId, where): rows` (cap 10_000)
- `findStaffActions(vendorId, {staffId?,start?,end?})` for summary
- `findOverridesWithStaffMarks(vendorId)` for conflicts
- `findMyActivity(vendorId, userId)` + counts
Define a `AuditLogRow` read type (plain fields, bigint ids).

#### Task 5: Prisma read adapter — `src/modules/audit/audit.repository.ts`
Implements `IAuditRepository` over `prisma.auditLog` (+ `deliveryOverride`/`dailySupply`
for conflicts). Soft-delete N/A (audit has none). All queries scoped by `vendorId`.
`orderBy createdAt desc`. Use `select` projections; never `include` whole relations.

#### Task 6: Reader ACL — `src/modules/audit/audit.reader.ts`
Batched name resolution (N+1-free), keyed Maps:
- `getUserNames(userIds): Map<string,string|null>`
- `getCustomerNamesByIds(vendorId, customerIds): Map`
- `getCustomerForDeliveries(dailySupplyIds): Map<dailySupplyId,{customerId,customerName,listId,listName}>`
- `getStaffRoster(vendorId): {id,name|null}[]` (vendor_users + user.name)
Reuse query shapes from `DeliveryReader`.

---

### Phase 3 — Application (queries + command)

#### Task 7: `queries/list-audit-logs.query.ts`
`ListAuditLogsQuery.execute(ctx, filters)` — staff scope force, build where, page, enrich,
facets, map to result DTO. Strip `ipAddress` for staff.

#### Task 8: `queries/get-conflicts.query.ts`
Owner backstop. Derive conflicts from override rows + staff marks (DOMAIN_MODEL formula).

#### Task 9: `queries/get-staff-summary.query.ts`
Owner backstop. Aggregate staff actions by action-type and by date; compute totals.

#### Task 10: `queries/get-my-activity.query.ts`
Self-scoped activity + today/week/month counts.

#### Task 11: `commands/export-audit-logs.command.ts`
Owner backstop. Reuse list-where builder, fetch ≤10k, `buildAuditCsv`, return `{ filename, csv }`.

---

### Phase 4 — Interface

#### Task 12: Controller — `src/modules/audit/audit.controller.ts`
Handlers `list`, `conflicts`, `staffSummary`, `export`, `myActivity`. Pattern from
`DeliveryController` (`ctx(req)`, try/catch → next). `export` sets CSV headers + `res.send`.
Full `@openapi` JSDoc per endpoint.

#### Task 13: Routes — `src/modules/audit/audit.routes.ts`
Composition root (instantiate repo/reader/queries/command/controller). Middleware chains
per API_SPEC. Owner-only routes add `requireOwnerRole()`. `Router({ mergeParams: true })`.

#### Task 14: Register in app — `src/app.ts`
Mount `auditRoutes` at `/api/v1/vendors` (alongside delivery/supply-list).

#### Task 15: Seed — `prisma/seeds/` (idempotent)
Add `audit:read` permission row via upsert/existence check (forward-compat; not enforced).

---

### Phase 5 — Tests

#### Task 16: Unit tests — `src/modules/audit/__tests__/audit.query.test.ts`
- `actionLabel`/`roleLabel`/`buildAuditCsv` pure-function cases.
- Each query with a mocked `IAuditRepository` + `AuditReader`: owner vs staff scoping,
  ipAddress masking, conflict derivation formula, summary aggregation, my-activity counts.
- Real assertions, no stubs (MEMORY.md: no placeholder tests).

#### Task 17: Integration tests — `tests/integration/audit.test.ts`
HTTP lifecycle via supertest: auth required, RBAC (staff 403 on owner routes), staff
self-scoping on `audit-logs`, multi-tenant 404 mask, CSV content-type on export,
correlationId on errors, pagination meta shape.

## Exact output files
types, shared, validator, repository.port, repository, reader, 4 queries, 1 command,
controller, routes, app.ts edit, seed edit, 2 test files.
