# Feature: Supply Lists Management (US-005)

> Backend (paycycle_api). Branch: `feat/us-005-supply-lists`.
> Skills applied: `ddd-module-design.md`, `domain-modeling.md`, `api-contract-design.md`, `prisma-schema-design.md`, `error-handling.md`, `validation-schemas.md`.
> Companion: `DOMAIN_MODEL.md` (aggregates/VOs/events), `FEATURE_TASKS.md` (parallel workstreams), `FEATURE_BUGS.md`.

## Complexity Assessment
- **Tier**: **Complex**
- **Justification**: two aggregates with distinct lifecycles and invariants; this module fulfills the staff-module ACL by replacing three fail-closed stubs (`ListAssignmentPort`, `ListAssignmentWritePort`, the `assign-list`/`unassign-list` 503 gates); non-trivial invariants (one-primary-per-list, effective amount, archive-vs-delete, custom overrides, multi-tenant isolation); cross-module domain events for Audit/Delivery/Dashboard.
- **Directory Structure**: full vertical-slice DDD module at `src/modules/supply-list/` (see DOMAIN_MODEL.md "Module Structure"), mirroring the existing `src/modules/staff/` module.

## Domain Model
*(Full detail in `DOMAIN_MODEL.md`.)*
- **Aggregates**: `SupplyList` (root, owns `SupplyListStaff` + `SupplyListSchedule`) and `Subscription` = `SupplyListCustomer` (root).
- **Entities**: `SupplyListEntity`, `SubscriptionEntity`.
- **Value Objects**: `SupplyUnit`, `SupplyFrequency`, `Quantity`, `RateMoney`, `TimeOfDay`, `DateRange`, `SubscriptionStatus`.
- **Domain Events**: `SupplyListCreated/Updated/Archived`, `StaffAssignedToList`, `StaffUnassignedFromList`, `PrimaryStaffChanged`, `CustomerSubscribed`, `SubscriptionUpdated`, `SubscriptionEnded`.
- **Aggregate Boundaries (owned vs referenced by ID)**:
  - Owned within SupplyList aggregate: `supply_list_staff`, `supply_list_schedule`.
  - Referenced by ID only: `vendorId` (Vendor), `customerId` (Customer/US-008), `vendorUserId` (Staff).
  - `customerCount` / `todayStats` / `monthStats` are read projections, NOT aggregate state.

## API Endpoints

All mounted on the existing vendor-scoped router (`/api/v1/vendors`). Middleware chain: `authenticateToken → validate(params) → validate(body|query) → identifyUserRole('vendorId') → (requireOwnerRole() | canViewSupplyList) → controller`. Every error response carries `correlationId`.

Base response envelope: `{ success, data, meta?, error? }`. BigInt ids serialized as strings.

### Supply Lists

#### GET /api/v1/vendors/:vendorId/supply-lists — **Query**
- Auth: required. Role: Owner sees all; Staff sees only assigned (filtered via `ListAssignmentPort`).
- Query: `status?=active|archived`, `staffId?` (owner filter), standard pagination `page`,`limit` (default 20, max 100).
- Validator: **passthrough** query schema, `z.nativeEnum`-style for status; `staffId` numeric string.
- Response 200: `{ success, data: SupplyListListDto[], meta: { page, limit, total, totalPages } }`.
  - `SupplyListListDto`: `{ id, name, supplyType, unit, defaultQuantity, defaultRatePerUnit, startTime, frequency, status, assignedStaff: [{ staffId, staffName, isPrimary }], customerCount, todayStats: { delivered, onLeave, pending } }`.
- Errors: 401, 403 (staff requesting `staffId` ≠ self → forbidden), 400.

#### GET /api/v1/vendors/:vendorId/supply-lists/:listId — **Query**
- Auth: required. Role: Owner OR assigned staff (`PermissionService.canViewSupplyList`).
- Response 200: full `SupplyListDto` incl. `assignedStaff` (with `phoneNumber`), `customerCount`, `monthStats: { month, daysCompleted, totalQuantity, revenue }`, `todayStats: { date, delivered, onLeave, pending, totalQuantity }`. Stats are zeroed by the DeliveryStats stub until US-006.
- Errors: 404 (not found OR wrong tenant — masked), 403 (staff not assigned → **404 mask**, see Security).

#### POST /api/v1/vendors/:vendorId/supply-lists — **Command** (Owner only)
- Permission: owner (`requireOwnerRole`). Marker permission `list:create`.
- Body (**strict** Zod): `{ name, supplyType?, unit, defaultQuantity, defaultRatePerUnit, startTime, frequency, frequencyDays?, staffIds?: string[], primaryStaffId? }`.
  - `frequencyDays`: required non-empty when `frequency=weekly` (csv of mon..sun or 1..7) — modeled via discriminated union on `frequency`.
  - `primaryStaffId` must be within `staffIds` (refine).
- Response 201: `{ success, data: SupplyListDto }`.
- Errors: 400 validation, 409 (duplicate list name within vendor — OQ-5), 422 (assigned staff not ACTIVE / not in vendor), 403.

#### PATCH /api/v1/vendors/:vendorId/supply-lists/:listId — **Command** (Owner only)
- Body (**strict**, all optional): `{ name?, supplyType?, unit?, defaultQuantity?, defaultRatePerUnit?, startTime?, frequency?, frequencyDays? }`. At least one field (refine).
- Changing default price does NOT affect existing custom overrides (response includes `priceChangeNote` only in Swagger doc, not payload).
- Response 200: `{ success, data: SupplyListDto }`. Errors: 404, 400, 422 (invalid frequency/schedule combo).

#### DELETE /api/v1/vendors/:vendorId/supply-lists/:listId — **Command** (Owner only)
- Always **archive** (soft): `isActive=false`, `deletedAt=now`. Never hard delete in US-005 (edge #1).
- Response 200: `{ success, data: { id, status: 'archived' } }` (200 not 204, to return new status to FE). Errors: 404.

### Staff Assignment

#### POST /api/v1/vendors/:vendorId/supply-lists/:listId/staff — **Command** (Owner only)
- Body (**strict**): `{ staffId, isPrimary?=false }`.
- Validates staff via `StaffDirectoryPort` (must be ACTIVE member of vendor → else 422 "Staff is disabled"/"Staff not found in vendor").
- If `isPrimary=true`, demotes others atomically.
- Response 201: `{ success, data: SupplyListDto }` (returns updated `assignedStaff`). Errors: 404 (list), 409 (already assigned — DB unique), 422 (disabled/not-in-vendor staff).

#### DELETE /api/v1/vendors/:vendorId/supply-lists/:listId/staff/:staffId — **Command** (Owner only)
- Removes assignment. If was primary, leaves no primary.
- Response 200: `{ success, data: SupplyListDto }`. Errors: 404 (list or assignment).

### Customer Subscriptions

#### GET /api/v1/vendors/:vendorId/supply-lists/:listId/customers — **Query**
- Auth: Owner OR assigned staff. Query: `search?` (name/phone), `status?=active|paused|ended`, `page`,`limit` (default 50, max 100).
- Response 200: `{ success, data: SubscriptionDto[], meta }`.
  - `SubscriptionDto`: `{ subscriptionId, customerId, customerName, phoneNumber?, address?, quantity, ratePerUnit, amount, isCustomQuantity, isCustomRate, startDate, status, otherLists: string[] }`. `otherLists` capped to 5 names (see OQ-4).
- Errors: 404 (list), 403→404 mask (staff not assigned).

#### GET /api/v1/vendors/:vendorId/supply-lists/:listId/available-customers — **Query** (Owner only)
- Lists vendor customers NOT already actively subscribed to this list. Query: `search?`, `page`,`limit`.
- Response 200: `{ success, data: [{ customerId, name, phone, otherLists: string[] }], meta }`.

#### POST /api/v1/vendors/:vendorId/supply-lists/:listId/customers — **Command** (Owner only)
- Body (**strict**): `{ customerIds: string[1..100], useDefaultQuantity=true, customQuantity?, useDefaultRate=true, customRate?, startDate? }`.
  - Refine: if `useDefaultQuantity=false` then `customQuantity` required ≥0; same for rate.
- Validates customers belong to vendor (`CustomerDirectoryPort`); skips/links existing; rejects duplicates (active subscription already exists) → returns per-item result.
- Response 201: `{ success, data: { addedCount, skippedCount, subscriptions: SubscriptionDto[], skipped: [{ customerId, reason }] } }`.
- Errors: 400, 409 (all customers already subscribed), 422 (customer not in vendor), 403.

#### PATCH /api/v1/vendors/:vendorId/supply-lists/:listId/customers/:subscriptionId — **Command** (Owner only)
- Body (**strict**, ≥1 field): `{ quantity?, ratePerUnit?, status?=active|paused }`. (`ended` goes through DELETE.)
- Response 200: `{ success, data: SubscriptionDto }`. Errors: 404, 400.

#### DELETE /api/v1/vendors/:vendorId/supply-lists/:listId/customers/:subscriptionId — **Command** (Owner only)
- Ends subscription: `status=ended`, `endDate=today`, `isActive=false`. History preserved (no hard delete).
- Response 200: `{ success, data: { subscriptionId, status: 'ended', endDate } }`. Errors: 404.

### Error response shape (all endpoints)
```json
{ "success": false, "error": { "code": "NOT_FOUND", "message": "Supply list not found", "correlationId": "req-...", "details": null, "subErrors": [] } }
```

### Strategy / Port interfaces (external/cross-module)
- **Implemented (staff module's ports)**: `ListAssignmentPort` (read), `ListAssignmentWritePort` (write) — real adapters over `supply_list_staff`.
- **Owned (this module)**: `StaffDirectoryPort`, `CustomerDirectoryPort`, `DeliveryStatsPort` (stub). See DOMAIN_MODEL.md ACL section.

## Data Model Changes

New Prisma models (canonical db-design modules 05 & 06 already define these tables; **no design change required** — we mirror them in Prisma). All `@@map` to snake_case, BigInt PKs, mandatory indexes on `deletedAt`, `createdAt` (where applicable), FKs, and `vendorId`.

### `SupplyList` → `supply_lists`
- Fields: `id`, `vendorId`, `name`, `supplyType?`, `unit`, `defaultQuantity? Decimal(10,3)`, `ratePerUnit? Decimal(10,2)`, `startTime? String(5)` (HH:mm), `frequency SupplyFrequency @default(DAILY)`, `isActive @default(true)`, `createdAt`, `updatedAt`, `deletedAt?`.
- Relations: `vendor` (RESTRICT), `staff SupplyListStaff[]`, `schedule SupplyListSchedule[]`, `subscriptions SupplyListCustomer[]`.
- Indexes: `vendorId`, `isActive`, `frequency`, `deletedAt`.
- New enum `SupplyFrequency { DAILY WEEKLY MONTHLY } @@map("supply_frequency")`.

### `SupplyListStaff` → `supply_list_staff`  *(owned child of SupplyList aggregate)*
- Fields: `id`, `supplyListId`, `vendorUserId`, `isPrimary @default(false)`, `assignedByUserId?`, `assignedAt @default(now())`, `createdAt`, `updatedAt`.
- Relations: `supplyList` (CASCADE), `vendorUser VendorUser` (RESTRICT — **adds back-relation on VendorUser**), `assignedByUser User?` (SetNull).
- Constraints: `@@unique([supplyListId, vendorUserId])`. Indexes: `supplyListId`, `vendorUserId`, `isPrimary`.

### `SupplyListSchedule` → `supply_list_schedule`  *(owned child)*
- Fields: `id`, `supplyListId`, `dayOfWeek? SmallInt (1-7)`, `dayOfMonth? SmallInt (1-31)`, `createdAt`, `updatedAt`.
- Relations: `supplyList` (CASCADE). Index: `supplyListId`. Checks (DB): dow 1-7, dom 1-31.

### `SupplyListCustomer` → `supply_list_customers`  *(Subscription aggregate root)*
- Fields: `id`, `vendorId` (denorm), `supplyListId`, `customerId`, `customQuantity? Decimal(10,3)`, `customRatePerUnit? Decimal(10,2)`, `startDate? Date`, `endDate? Date`, `isActive @default(true)`, `createdAt`, `updatedAt`, `deletedAt?`.
- Relations: `vendor` (RESTRICT), `supplyList` (CASCADE), `customer Customer` (RESTRICT — **requires Customer model**, see below).
- Constraints: `@@unique([supplyListId, customerId])`. Indexes: `vendorId`, `supplyListId`, `customerId`, `isActive`, `startDate`, `endDate`, `deletedAt`.

### Prerequisite models not yet in Prisma — `Customer`, `VendorCustomer`
The canonical db-design defines `customers` (03) and `vendor_customers` (04), but the current Prisma schema stops at `AuditLog`. US-008 owns Customer Management, but **US-005 cannot create subscriptions without a `customers` table to FK into**. We therefore introduce a **minimal `Customer` + `VendorCustomer` Prisma model now** (matching db-design 03/04 exactly), seed dev customers, and let US-008 extend them later. This is flagged as **OQ-1**.
- `Customer` → `customers`: `id`, `userId?`, `name?`, `phone @unique`, `email?`, `address?`, `locality?`, `autoMarkEnabled @default(true)`, `lastLoginAt?`, timestamps, `deletedAt?`. Indexes per db-design 03.
- `VendorCustomer` → `vendor_customers`: `id`, `vendorId`, `customerId`, `status VendorCustomerStatus @default(ACTIVE)`, `referredByCustomerId?`, `acquisitionSource? AcquisitionSource`, timestamps, `deletedAt?`. `@@unique([vendorId, customerId])`, indexes per db-design 04. New enums `VendorCustomerStatus`, `AcquisitionSource`.

### Migration
- Single migration `add_supply_lists_and_customers` creating: enums (`SupplyFrequency`, `VendorCustomerStatus`, `AcquisitionSource`), tables `customers`, `vendor_customers`, `supply_lists`, `supply_list_staff`, `supply_list_schedule`, `supply_list_customers`, plus the new back-relation/index on `vendor_users`.
- Keep `prisma migrate` order consistent with db-design (customers/vendor_customers before supply tables).

### Seed data plan (`prisma/seeds/index.ts`)
- **Permissions (new `resource:action` rows)** — extend catalog and assign:
  - `list:read` (owner + staff), `list:create` (owner), `list:edit` (owner), `list:delete` (owner), `list:assign_staff` (owner), `subscription:read` (owner + staff), `subscription:write` (owner). Note: `list:create`/`list:edit` markers already seeded by US-002; add `list:read`, `list:delete`, `list:assign_staff`, `subscription:*`. Assign read-side to `vendor_staff` role; all to `vendor_owner`.
- **Dev data (faker)**: 6–8 customers per dev vendor, 2–3 supply lists (Morning Milk, Evening Milk, Morning Bread), staff assignments (1 primary each), 4–6 subscriptions per list with a mix of default and custom overrides, both DAILY and WEEKLY frequency examples. Realistic Indian names/phones/localities. Idempotent upserts.

## Business Rules
- **Invariants** (enforced by entities — see DOMAIN_MODEL.md):
  - SupplyList: name non-empty ≤100; valid unit; qty/rate ≥0 (zero rate allowed); WEEKLY⇒≥1 dayOfWeek, MONTHLY⇒≥1 dayOfMonth; ≤1 primary; primary ∈ assigned.
  - Subscription: custom qty/rate ≥0; endDate≥startDate; effective qty/rate resolvable; vendor of list = denorm vendorId.
- **Amount calculation** (`calculateCustomerAmount`): `(customQuantity ?? list.defaultQuantity) × (customRatePerUnit ?? list.ratePerUnit)`. Lives in `SubscriptionEntity.amount()`.
- **State machines**:
  - SupplyList: `Active → Archived` (terminal in US-005).
  - Subscription: `ACTIVE ⇄ PAUSED`, `ACTIVE|PAUSED → ENDED` (terminal). Invalid transitions → 422.
- **Cross-aggregate validation**: assigned staff must be ACTIVE vendor member (StaffDirectoryPort, 422 if disabled — edge #4); customers must belong to vendor (CustomerDirectoryPort, 422 — flow step "validate customer IDs belong to vendor"); denormalized `vendorId` on subscription must equal the list's vendor.
- **Multi-tenant isolation**: every query/command filters by `vendorId` from JWT-derived role context; wrong-tenant access masked as 404 (never reveal existence).
- **Editing default price** must not affect existing subscriptions that carry custom overrides (edge #3) — guaranteed because amount is computed from override-first.
- **Archive vs delete** (edge #1): DELETE always archives (soft); active subscriptions are left intact for history.
- **Staff removal** (edge #5): handled via existing staff `StaffRemovedEvent`/`unassignAll` now backed by the real write adapter.
- **Duplicate add** (edge #10): unique `(supplyListId, customerId)` → 409 / per-item skip.

## Sequence Diagrams (text)

### Create Supply List (with staff)
```
Client → Router: POST /vendors/:vendorId/supply-lists
Router: authenticate → validate(params) → validate(body, strict) → identifyUserRole → requireOwnerRole
Router → CreateSupplyListService.execute(cmd{vendorId, dto, actorUserId, correlationId})
Service → StaffDirectoryPort.findActiveMembership(vendorId, staffId) for each staffId  // 422 if any not ACTIVE
Service → SupplyListEntity.create(props)   // builds VOs, validates invariants, emits SupplyListCreatedEvent (+ StaffAssigned/PrimaryStaff events)
Service → repo.insert(entity) within tx     // mapper.toPersistence → supply_lists + supply_list_staff + supply_list_schedule
repo → publish domain events (post-commit)
Service → AuditLogger.log(SUPPLY_LIST_CREATED, actor, vendorId, listId)
Service → mapper.toResponse(entity, {customerCount:0, todayStats: stub})
Service → Controller → 201 { success, data: SupplyListDto }
```

### Add Customers (bulk)
```
Client → POST /vendors/:vendorId/supply-lists/:listId/customers {customerIds[], pricing, startDate}
Router: authenticate → validate → requireOwnerRole
Service → repo.findById(listId, vendorId)  // 404 (mask) if missing/wrong tenant
Service → CustomerDirectoryPort.assertCustomersBelongToVendor(vendorId, customerIds)  // 422 offenders
Service → repo.findActiveSubscriptionCustomerIds(listId)  // dedupe
For each new customerId: SubscriptionEntity.create({...effective pricing}) → emits CustomerSubscribedEvent
Service → repo.insertMany(entities) in tx (skip duplicates)
Service → AuditLogger.log(CUSTOMERS_ADDED)
Service → mapper.toResponse per subscription (+ amount + otherLists)
Controller → 201 { addedCount, skippedCount, subscriptions[], skipped[] }
```

### Staff-list assignment via staff endpoint (now real)
```
Client → POST /vendors/:vendorId/staff/:staffId/assign-list  (staff module endpoint)
Staff AssignListService → ListAssignmentWritePort.assign(membershipId, listId, isPrimary, actor)
  → SupplyListAssignmentWriteAdapter (US-005): validates list belongs to vendor, upserts supply_list_staff,
    demotes other primaries if isPrimary; throws ConflictError on duplicate
(no more 503)
```

## Strategy Interfaces (external services)
- **DeliveryStatsPort** — interface `{ getTodayStats(listId, date), getMonthStats(listId, month) }`. US-005 implementation: `DeliveryStatsZeroStubAdapter` (returns zeros). US-006 swaps in the real adapter at the composition root. Selection happens in `supply-list.routes.ts` only.
- No third-party (Stripe/SMS) integration in this feature.

## Error Handling Strategy
*(Per `error-handling.md`. All errors extend `ExceptionBase`, carry `correlationId`, structured `toJSON()`.)*

| Domain operation | Failure | Error class | HTTP |
|------------------|---------|-------------|------|
| Get/Update/Archive list | missing OR wrong tenant | `NotFoundError` | 404 |
| Create list | duplicate name in vendor | `ConflictError` | 409 |
| Create/Assign | staff not ACTIVE / not in vendor | `UnprocessableEntityError` | 422 |
| Assign staff | already assigned (P2002) | `ConflictError` (adapter maps Prisma P2002) | 409 |
| Update list | invalid frequency/schedule combo | `BadRequestError` / VO `ArgumentInvalidException` | 400/422 |
| Add customers | customer not in vendor | `UnprocessableEntityError` | 422 |
| Add customers | all already subscribed | `ConflictError` | 409 |
| Update subscription | invalid status transition | `UnprocessableEntityError` | 422 |
| Staff view list not assigned | authorization | **masked as `NotFoundError` (404)** | 404 |
| Any | unexpected | `InternalServerError` | 500 |
- **State transition validation** in `SubscriptionStatus`/`MembershipStatus`-style VO `assertTransition`.
- **Multi-tenant masking**: repository `findById(id, vendorId)` returns null for wrong tenant → service throws `NotFoundError`. Staff not assigned to a list → 404 (not 403) so list existence is not revealed.
- **Error logging**: per MEMORY, errors logged with `correlationId` to `Logs/YYYY-MM-DD.txt` via the existing logger/error middleware.

## Security Considerations
| Endpoint | Auth | Role/Permission | Rate Limit | Notes |
|----------|------|-----------------|------------|-------|
| GET supply-lists | Yes | any active member (owner all / staff assigned) | 100/15min | vendor-scoped |
| GET supply-lists/:id | Yes | owner or assigned staff | 100/15min | 404-mask unassigned |
| POST supply-lists | Yes | owner | 50/15min | validate staff |
| PATCH/DELETE list | Yes | owner | 50/15min | tenant guard |
| POST/DELETE staff | Yes | owner | 50/15min | StaffDirectoryPort |
| GET customers / available | Yes | owner or assigned staff | 100/15min | |
| POST/PATCH/DELETE customers | Yes | owner | 50/15min | CustomerDirectoryPort |
- Multi-tenant isolation enforced on every query via `vendorId`. Row-level filter from JWT role context. No sensitive fields in responses (whitelist mappers). All mutations audited via `AuditLogger`.

## Performance Considerations
- Indexes: `supply_lists(vendor_id)`, `(is_active)`, `(frequency)`, `(deleted_at)`; `supply_list_customers(vendor_id)`, `(supply_list_id)`, `(customer_id)`, `(is_active)`; `supply_list_staff(supply_list_id)`, `(vendor_user_id)`. Composite read patterns covered by these single-column indexes; add composite `supply_list_customers(supply_list_id, is_active)` and `supply_lists(vendor_id, is_active)` for the hottest list/customer queries.
- `customerCount` computed via `COUNT` grouped by `supply_list_id` (single query for the list page, not N+1).
- `otherLists` resolved in one batched query keyed by `customerId IN (...)`, capped to 5 names per customer in the projection (OQ-4).
- Customer pagination default 50/page (story). `todayStats` stubbed (no query cost) until US-006; when real, use the `daily_supplies(vendor_id, service_date)` composite index.
- Avoid N+1 on `assignedStaff`: batch-load `supply_list_staff` + `vendor_users`/`users` by `supplyListId IN (...)`.

## Open Questions (for user — recommendation + trade-off)

**OQ-1 — Introduce minimal `Customer`/`VendorCustomer` Prisma models now, or block on US-008?**
Subscriptions cannot FK to a non-existent `customers` table, and the dependency graph runs US-005 before US-008.
- **Recommendation**: Introduce `Customer` + `VendorCustomer` now, matching db-design 03/04 *exactly*, expose read access only via `CustomerDirectoryPort`, and seed dev customers. US-008 later adds customer CRUD/endpoints on top without schema churn.
- **Trade-off**: a small slice of US-008's schema lands early (owned by US-005's migration). Mitigated by keeping US-005's API surface read-only over customers and matching the canonical design so US-008 only adds behavior, not tables.

**OQ-2 — `todayStats`/`monthStats` before Delivery Tracking (US-006) exists.**
- **Recommendation**: Ship `DeliveryStatsPort` with a zero-returning stub adapter so the response contract is stable; US-006 swaps the real adapter at the composition root.
- **Trade-off**: FE shows 0/0/0 progress until US-006 (acceptable — FE US-005 isn't started). Alternative (omit the fields) would force a breaking response change in US-006.

**OQ-3 — Un-archive a supply list?**
The story only specifies archive. 
- **Recommendation**: No un-archive endpoint in US-005 (archive is terminal); revisit if product needs it.
- **Trade-off**: Owners must recreate a list if archived by mistake. Low risk; keeps the state machine simple. Easy to add later.

**OQ-4 — `otherLists` payload size for customers in many lists (edge #6).**
- **Recommendation**: Return the first 5 list names plus a `otherListsCount` total; FE renders "and X more".
- **Trade-off**: FE can't show all names without a follow-up call. Bounds payload and query cost. (If FE prefers full array, we return all — cheap for typical 1–4 lists.)

**OQ-5 — Enforce unique supply-list name per vendor?**
The story doesn't state it; "Morning Milk" twice is confusing but not illegal.
- **Recommendation**: Enforce case-insensitive unique `name` per active vendor list → 409 on duplicate.
- **Trade-off**: Blocks legitimately distinct lists that happen to share a name. Low likelihood; improves UX clarity. (If undesired, drop the unique check — no schema impact since it's app-level.)

**OQ-6 — Wiring real adapters into the staff composition root.**
US-005 must edit `src/modules/staff/staff.routes.ts` to replace the two stub adapters, which lightly touches a frozen module.
- **Recommendation**: Make that swap as part of US-005 (it's the whole point of the deferred US-004 OQ); cover with the staff module's existing assign/unassign tests now exercising real writes.
- **Trade-off**: One edit to a shipped module + re-run of staff regression suite. Without it, `assign-list`/`unassign-list` stay 503 and the feature is incomplete.
</content>
