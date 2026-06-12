# Feature: US-010 Dashboard (Owner & Staff)

> Backend implementation plan for the Owner & Staff dashboards, supply forecast,
> outstanding aging, and vendor settings. Consumed by BE Dev, BE Review, BE QA.
> Authoritative REST contract is in `API_SPEC.md`.

---

## Complexity Assessment

- **Tier**: **Mixed — Moderate (VendorSettings) + Complex read-side (dashboards/forecast/aging)**
- **Justification**:
  - The **read endpoints** (owner dashboard, staff dashboard, supply forecast, outstanding aging)
    are **read-heavy aggregations across many existing aggregates** (DailySupply, SupplyList,
    SupplyListCustomer, Leave, Customer, Payment, VendorUser). They carry **no write invariants**.
    Per `ddd-module-design.md` CQS guidance, **Queries may bypass the domain layer** and return
    typed **ReadModel DTOs**. We will NOT route these reads through domain aggregates or reconstitute
    entities — that would be over-engineering and slow.
  - **VendorSettings** is the only **write** surface. It carries real invariants (valid time format,
    boolean toggles, mutually-consistent auto-send fields) and a clear lifecycle, so it is modeled as
    a proper **Moderate** aggregate with an entity + repository port + mapper.
- **Directory Structure**: New `dashboard` module (read-only, query-only) + new `vendor-settings`
  module (full Moderate DDD). Both follow the mandatory `commands/` + `queries/` layout.
  `dashboard` has only `queries/` (no commands — it is pure read), which is acceptable because the
  module legitimately has zero write use cases. `vendor-settings` has both `commands/` and `queries/`.

```
src/modules/dashboard/                       # READ-ONLY module (queries only)
├── queries/
│   ├── get-owner-dashboard/
│   │   └── get-owner-dashboard.query.ts
│   ├── get-staff-dashboard/
│   │   └── get-staff-dashboard.query.ts
│   ├── get-supply-forecast/
│   │   └── get-supply-forecast.query.ts
│   └── get-outstanding-aging/
│       └── get-outstanding-aging.query.ts
├── services/                                # standalone calculation services (pure, testable)
│   ├── supply-forecast.calculator.ts
│   ├── outstanding-aging.calculator.ts
│   └── financial-summary.calculator.ts
├── database/
│   ├── dashboard-read.repository.port.ts    # read port (interface)
│   └── dashboard-read.repository.ts         # Prisma adapter (raw/aggregate reads)
├── dashboard.mapper.ts                      # ReadModel rows → response DTOs
├── dashboard.types.ts                       # ReadModel + response DTOs
├── dashboard.validator.ts                   # Zod for query params / path params
├── dashboard.controller.ts
├── dashboard.routes.ts                      # composition root
└── __tests__/

src/modules/vendor-settings/                 # MODERATE DDD module (write + read)
├── domain/
│   ├── vendor-settings.entity.ts            # aggregate root (framework-free)
│   ├── vendor-settings.types.ts             # props + enums
│   ├── vendor-settings.errors.ts
│   ├── value-objects/
│   │   └── time-of-day.vo.ts                # "HH:mm" validation
│   └── events/
│       └── vendor-settings-updated.domain-event.ts
├── commands/
│   └── update-vendor-settings/
│       └── update-vendor-settings.command.ts
├── queries/
│   └── get-vendor-settings/
│       └── get-vendor-settings.query.ts
├── database/
│   ├── vendor-settings.repository.port.ts
│   └── vendor-settings.repository.ts
├── vendor-settings.mapper.ts
├── vendor-settings.types.ts
├── vendor-settings.validator.ts
├── vendor-settings.controller.ts
├── vendor-settings.routes.ts
└── __tests__/
```

---

## Domain Model

### Aggregates

| Aggregate | Root Entity | Type | Notes |
|-----------|-------------|------|-------|
| **VendorSettings** | `VendorSettingsEntity` | Moderate DDD | One row per vendor (unique `vendorId`). Owns auto-mark / auto-send config + notification prefs JSON. |
| _(Dashboards)_ | — | Read model only | No aggregate. Query handlers compose ReadModel DTOs directly from repository aggregate reads. |

### Entities

#### `VendorSettingsEntity` (aggregate root)

| Field | Type | Required | Default | Constraint |
|-------|------|----------|---------|------------|
| id | BigInt | Yes | auto | PK |
| vendorId | BigInt | Yes | — | unique, FK → vendors.id |
| autoMarkEnabled | boolean | Yes | true | — |
| autoSendBillsEnabled | boolean | Yes | false | — |
| autoSendBillsTime | `TimeOfDay` VO | Yes | "20:00" | "HH:mm", 00:00–23:59 |
| notificationPreferences | Json | No | `{}` | free-form object |
| createdAt / updatedAt | DateTime | Yes | now/auto | — |

- **Behavior (domain methods)**:
  - `static create(props)` — factory for a new settings row with defaults; emits nothing (created lazily).
  - `static fromPersistence(row)` — reconstitution.
  - `update(patch)` — applies partial change (`autoMarkEnabled?`, `autoSendBillsEnabled?`,
    `autoSendBillsTime?`, `notificationPreferences?`), re-validates, adds `VendorSettingsUpdatedEvent`.
  - `validate()` — invariants below.
  - `getProps()` — frozen read-only copy.
- **Invariants (`validate()`)**:
  1. `autoSendBillsTime` must be a valid `TimeOfDay` ("HH:mm", `00 ≤ hh ≤ 23`, `00 ≤ mm ≤ 59`).
  2. `notificationPreferences` must be a plain JSON object (not array/primitive).
  3. (Soft consistency, non-blocking) when `autoSendBillsEnabled = false`, `autoSendBillsTime` is
     retained but ignored — do NOT null it (preserves user's last choice). Documented, not enforced.

### Value Objects

#### `TimeOfDay`
- **Properties**: `{ hours: number; minutes: number }`, serialized as `"HH:mm"`.
- **Validation (constructor, Guard clauses)**: string matches `/^([01]\d|2[0-3]):[0-5]\d$/`;
  reject empty, reject out-of-range.
- **Equality**: structural (hours + minutes).
- **Immutable**: yes. `unpack()` → `"HH:mm"` string for persistence.

### Domain Events

| Event | Triggered When | Payload | Consumers |
|-------|----------------|---------|-----------|
| `VendorSettingsUpdatedEvent` | `update()` succeeds & persists | `{ aggregateId, vendorId, changed: string[], autoMarkEnabled, autoSendBillsEnabled, autoSendBillsTime }` + metadata `{ correlationId, userId, timestamp }` | Audit (future), delivery-generation cron (future — reacts to autoMark toggle). **No synchronous cross-module call.** |

> The dashboard read side emits **no events** (queries never mutate).

### Aggregate Boundaries

- **VendorSettings** references `Vendor` by **ID only** (`vendorId` FK). It does not own any child entities.
- **Dashboard reads** cross many aggregates but only by **ID-scoped reads through the read port** —
  the dashboard module never imports another module's repository, entity, or service. It owns a
  dedicated `IDashboardReadRepository` that issues Prisma aggregate/groupBy/raw queries against the
  existing tables. This keeps modules encapsulated (no `../delivery`, `../customer` imports).

---

## Data Model Changes

### New model: `VendorSettings`

```prisma
model VendorSettings {
  id BigInt @id @default(autoincrement())

  vendorId BigInt @unique @map("vendor_id")

  autoMarkEnabled      Boolean @default(true)  @map("auto_mark_enabled")
  autoSendBillsEnabled Boolean @default(false) @map("auto_send_bills_enabled")
  autoSendBillsTime    String  @default("20:00") @map("auto_send_bills_time") @db.VarChar(5) // "HH:mm"

  notificationPreferences Json @default("{}") @map("notification_preferences")

  createdAt DateTime  @default(now()) @map("created_at")
  updatedAt DateTime  @updatedAt @map("updated_at")
  deletedAt DateTime? @map("deleted_at")

  vendor Vendor @relation(fields: [vendorId], references: [id], onDelete: Cascade)

  @@index([vendorId])
  @@index([deletedAt])
  @@index([createdAt])
  @@map("vendor_settings")
}
```

Add the back-relation to `Vendor`:

```prisma
model Vendor {
  // ...existing fields...
  vendorSettings VendorSettings?
}
```

> **IMPORTANT — pre-existing redundancy (see Open Question OQ-1).** The `Vendor` model already
> carries `autoMarkEnabled`, `autoSendBills`, `autoSendTime`. This plan introduces `VendorSettings`
> as the **single source of truth** going forward (per the US-010 spec which explicitly defines a
> `vendor_settings` table). The Dev agent must:
> 1. Treat `VendorSettings` as authoritative for these flags.
> 2. **Backfill** one `VendorSettings` row per existing vendor in the migration, copying the legacy
>    `vendors.auto_mark_enabled / auto_send_bills / auto_send_time` values.
> 3. **Do NOT drop** the legacy `vendors` columns in this migration (safe-migration rule — drop in a
>    later major version). Leave them in place but stop writing to them from new code.

### Migration plan (`prisma/migrations/`)

1. `create_vendor_settings_table` — creates the table + indexes + unique on `vendor_id`.
2. **Data backfill** (raw SQL appended to the same migration):
   ```sql
   INSERT INTO vendor_settings (vendor_id, auto_mark_enabled, auto_send_bills_enabled, auto_send_bills_time, notification_preferences, created_at, updated_at)
   SELECT id, auto_mark_enabled, auto_send_bills, COALESCE(auto_send_time, '20:00'), '{}'::jsonb, now(), now()
   FROM vendors
   ON CONFLICT (vendor_id) DO NOTHING;
   ```

### db-design SQL update (REQUIRED)

Add `vendor_settings` to `project_documents/db-design/02-vendors.sql` (or a new `19-vendor-settings.sql`
referenced from `index.md`). Note in the SQL comment block that legacy `vendors.auto_*` columns are
deprecated in favour of `vendor_settings`. This keeps the db-design canon in sync with the Prisma schema.

### Seed data plan (`prisma/seeds/index.ts`)

- **Permissions** (resource:action) — upsert and assign to the `vendor_owner` role:
  - `dashboard:read` — view owner dashboard, supply forecast, outstanding aging.
  - `vendor-settings:read`
  - `vendor-settings:update`
  - `staff-dashboard:read` — view a staff dashboard (held by both owner and staff; see Security).
- **Dev seed** — for each seeded vendor, create one `VendorSettings` row (faker not needed; defaults
  are realistic). No financial faker data required — dashboards derive from existing seeded
  deliveries/payments.

### No materialized views in this iteration

The US spec mentions materialized views and Redis as **performance optimizations**. Per the task
constraints these are **out of scope**. We use **indexed live queries + Prisma `groupBy`/aggregate**.
The existing indexes already cover the hot paths (see Performance section). Materialized views can be
added later without changing the API contract.

---

## API Endpoints

All endpoints are **Queries** except `PATCH /settings` (Command). Middleware chain order is always:
`authenticateToken → validate(params) → validate(query/body) → identifyUserRole('vendorId') → [requireOwnerRole] → controller`.

`vendorId` is **never** trusted from the path for data scoping beyond routing — `identifyUserRole`
re-validates membership against the DB and supplies the authoritative `req.roleContext.vendorId`.
Multi-tenant isolation: a vendor the caller has no ACTIVE membership in is masked as **404** by
`identifyUserRole` (existing behavior). Full contract (request/response JSON) lives in `API_SPEC.md`.

### 1. `GET /api/v1/vendors/:vendorId/dashboard/owner` — **Query**
- **Auth**: required. **Role**: owner only (`requireOwnerRole`). **Permission**: `dashboard:read`.
- **Request**: path `vendorId`. No body. Optional query `month` (`YYYY-MM`, default current month).
- **Returns**: financial summary, outstanding aging summary, quick stats, autoMarkStatus,
  tomorrow's supply forecast (top lists) + 7-day aggregate, today's supply lists with progress.
- **Composition**: `GetOwnerDashboardQuery` calls `financial-summary.calculator`,
  `outstanding-aging.calculator`, `supply-forecast.calculator`, plus read-port quick-stat counts.
- **Errors**: 401, 403 (staff), 404 (no membership).

### 2. `GET /api/v1/vendors/:vendorId/dashboard/staff/:staffId` — **Query**
- **Auth**: required. **Role**: owner OR the staff member themselves. **Permission**: `staff-dashboard:read`.
- **Authorization rule** (enforced in handler, NOT just middleware):
  - If caller role is `owner` → may view any `staffId` in the vendor.
  - If caller role is `staff` → `staffId` path param **must equal** `req.roleContext.staffId`;
    otherwise **403** (do not leak other staff's data). A non-existent `staffId` in this vendor → **404**.
- **Returns**: date, staffName, todayProgress (total/completed/percentage), assignedLists with progress,
  pendingCount. **NO financial fields** — calculator for staff is financial-free by construction.
- **Errors**: 401, 403 (staff viewing another staff), 404 (staff not in vendor / no membership).

### 3. `GET /api/v1/vendors/:vendorId/supply-forecast` — **Query**
- **Auth**: required. **Role**: owner only (`requireOwnerRole`). **Permission**: `dashboard:read`.
- **Query params**: `date?` (`YYYY-MM-DD`, default tomorrow), `days?` (int 1–30, default 7),
  `supplyType?` (string filter).
- **Returns**: `byList[]`, `aggregatedByType{}`, `nextNDays{}` (daily averages over the window).
- **Composition**: `GetSupplyForecastQuery` → `supply-forecast.calculator`.
- **Errors**: 400 (bad date/days), 401, 403, 404.

### 4. `GET /api/v1/vendors/:vendorId/outstanding-aging` — **Query**
- **Auth**: required. **Role**: owner only. **Permission**: `dashboard:read`.
- **Query params**: `priority?` (`high|medium|low|all`, default `all`), `page?`, `limit?`
  (pagination for priorityCustomers, max 100 — handles 500+ customer vendors).
- **Returns**: aging summary buckets, priorityCustomers grouped high/medium/low, advanceCredit section.
- **Composition**: `GetOutstandingAgingQuery` → `outstanding-aging.calculator`.
- **Errors**: 400, 401, 403, 404.

### 5. `PATCH /api/v1/vendors/:vendorId/settings` — **Command**
- **Auth**: required. **Role**: owner only. **Permission**: `vendor-settings:update`.
- **Body** (Zod `.strict()`, all optional but at least one required):
  `autoMarkEnabled?: boolean`, `autoSendBillsEnabled?: boolean`, `autoSendBillsTime?: "HH:mm"`,
  `notificationPreferences?: object`.
- **Behavior**: upsert semantics — if no `VendorSettings` row exists for the vendor, create with
  defaults then apply patch (lazy creation). Emits `VendorSettingsUpdatedEvent`.
- **Returns**: the full updated settings object.
- **Errors**: 400 (validation / empty body), 401, 403, 404.

> A companion **read** endpoint `GET /api/v1/vendors/:vendorId/settings` (Query,
> `vendor-settings:read`, owner only) is included so the frontend can hydrate the settings screen
> without parsing the dashboard payload. It returns the same shape as the PATCH response.

---

## Business Rules

### Financial summary (owner)
- `currentMonth` = `month` query param or server's current month (`YYYY-MM`).
- `totalRevenue` = Σ `DailySupply.finalAmount` for the vendor where `status IN (DELIVERED, AUTO_MARKED)`
  and `serviceDate` within the month. (LEAVE / CANCELLED / PENDING excluded.)
- `collected` = Σ `Payment.amount` for the vendor where `paymentDate` within the month.
- `pending` = `max(totalRevenue − collected, 0)`.
- `collectionPercentage` = `totalRevenue === 0 ? 0 : round(collected / totalRevenue * 100)`.
- `advanceCredit` = Σ absolute value of negative customer balances (credit balances).
- `netReceivable` = `totalOutstanding − advanceCredit` (clamp ≥ 0).
- **Edge cases**: zero revenue → 0% (no divide-by-zero). First day of month → partial data is correct,
  not an error.

### Outstanding aging
- Per customer in the vendor: `balance = lifetimeFinalAmount − lifetimePayments`.
  - `lifetimeFinalAmount` = Σ `DailySupply.finalAmount` (DELIVERED/AUTO_MARKED) for that customer+vendor.
  - `lifetimePayments` = Σ `Payment.amount` for that customer+vendor.
- Skip customers with `balance <= 0` from aging buckets; `balance < 0` → advanceCredit section.
- `daysOverdue` = days between **oldest unpaid serviceDate** and today. "Oldest unpaid" approximated as
  the oldest `DailySupply.serviceDate` whose cumulative amount is not yet covered by payments
  (FIFO allocation). For this iteration use the **oldest unbilled/unpaid serviceDate** = oldest
  `DailySupply.serviceDate` for the customer when `balance > 0` (documented simplification — see OQ-2).
- Buckets: `fresh_0_30` (≤30d), `overdue_30_60` (31–60d), `critical_60_plus` (>60d).
- **Priority** of a customer = function of (creditUtilization%, daysOverdue, amount):
  - `high` if `utilizationPercentage >= 90` OR `daysOverdue > 60`.
  - `medium` if `utilizationPercentage >= 60` OR `daysOverdue > 30`.
  - `low` otherwise. Sort within each group by `daysOverdue desc, outstanding desc`.
  - `utilizationPercentage` = `creditLimit > 0 ? round(balance / creditLimit * 100) : 0`.
- `paymentScore` comes from `Customer.paymentScore`. `lastPaymentDate` = max `Payment.paymentDate`.

### Supply forecast
- Active subscriptions = `SupplyListCustomer` where `isActive = true`, `deletedAt IS NULL`,
  and the date is within `[startDate, endDate]` (null endDate = open-ended).
- For each forecast date, a customer is **on leave** if a `Leave` row for that subscription covers the
  date (`startDate ≤ date ≤ endDate`). On-leave customers add to `plannedLeaves`, not `quantity`.
- `quantity` per subscriber = `SupplyListCustomer.customQuantity ?? SupplyList.defaultQuantity ?? 0`.
- Aggregate by `SupplyList.supplyType` (fallback to list name when supplyType is null).
- `dailyAverage` over an N-day window = `round(totalQuantity / days)`.
- `supplyType` filter (optional) narrows to matching lists.
- **Edge cases**: 100% of subscribers on leave → quantity 0, plannedLeaves = subscriber count.
  No active subscriptions → empty `byList`, empty aggregates (not an error).
- **DAILY frequency** is assumed for v1. Lists with `frequency = WEEKLY/MONTHLY` are filtered by their
  `SupplyListSchedule` (dayOfWeek / dayOfMonth) against each forecast date (see OQ-3).

### Quick stats (owner)
- `supplyListsCount` = active `SupplyList` count for vendor.
- `totalCustomers` = active `VendorCustomer` count for vendor.
- `activeStaff` = `VendorUser` count where `role = staff`, `status = ACTIVE`, `deletedAt IS NULL`.
- `conflictsToday` = count of today's `DailySupply` rows flagged as conflicts. **Conflict definition for
  v1**: deliveries with status `PENDING` whose `serviceDate < today` is NOT applicable (today only);
  a "conflict" = a `DailySupply` for today that has both an auto-mark and a manual override on the same
  row (i.e. `isAutoMarked = true` AND a `SupplyOverride` exists for it). See OQ-4 for the precise rule —
  defaulted to this and documented.

### Today's supply lists / progress (owner & staff)
- "Today" = server date (vendor timezone assumed = server tz for v1; see OQ-5).
- Per list: `total` = count of `DailySupply` rows for the list+date (excluding CANCELLED);
  `completed` = count with status `IN (DELIVERED, AUTO_MARKED)`; `percentage` = `round(completed/total*100)`
  (0 when total = 0). `status`: `not_started` (completed=0), `completed` (completed=total>0),
  else `in_progress`.
- Owner sees all lists; `staffName` = primary assigned staff (`SupplyListStaff.isPrimary`) name or null.
- Staff dashboard restricts lists to those assigned to that `vendorUserId` via `SupplyListStaff`.

### Multi-tenant isolation rules
- All reads scoped by `req.roleContext.vendorId` (DB-validated), never the raw path param.
- Staff dashboard: staff may only read their own `staffId` (403 otherwise); owner may read any.
- Wrong-tenant access → 404 (handled by `identifyUserRole`).

---

## Sequence Diagrams (text-based)

### Owner dashboard
```
Client → GET /vendors/:vendorId/dashboard/owner?month=2026-04
  authenticateToken → validate(params) → validate(query) → identifyUserRole → requireOwnerRole
  → DashboardController.getOwnerDashboard(req)
      vendorId = req.roleContext.vendorId
      → GetOwnerDashboardQuery.execute(vendorId, month)
          financial   = FinancialSummaryCalculator.compute(vendorId, month)   [read port: revenue, payments]
          aging       = OutstandingAgingCalculator.summary(vendorId)          [read port: balances]
          forecast    = SupplyForecastCalculator.forTomorrowAndWindow(vendorId, 7)
          quickStats  = readRepo.quickStats(vendorId)
          settings    = vendorSettingsReadPort.findByVendor(vendorId) → autoMarkStatus
          todayLists  = readRepo.todayListProgress(vendorId, today)
          → DashboardMapper.toOwnerDashboardDto(...)   [whitelist fields]
  → sendSuccess(res, dto)
```

### Update settings (Command)
```
Client → PATCH /vendors/:vendorId/settings { autoMarkEnabled:false }
  authenticateToken → validate(params) → validate(body) → identifyUserRole → requireOwnerRole
  → VendorSettingsController.update(req)
      → UpdateVendorSettingsCommand.execute({ vendorId, patch, performedByUserId })
          repo.transaction(tx):
            row = repo.findByVendor(vendorId, tx)
            entity = row ? VendorSettingsEntity.fromPersistence(row)
                         : VendorSettingsEntity.create({ vendorId })       // lazy create
            entity.update(patch)        // validates invariants, adds VendorSettingsUpdatedEvent
            saved = repo.upsert(entity, tx)  // toPersistence
          publish entity.domainEvents   // after commit
          → VendorSettingsMapper.toResponse(saved)
  → sendSuccess(res, dto)
```

---

## Ports / Interfaces

### `IDashboardReadRepository` (dashboard module read port)
Pure read methods returning **ReadModel rows** (plain objects, no Prisma types leaked):
- `monthlyRevenue(vendorId, monthStart, monthEnd): Promise<number>`
- `monthlyCollected(vendorId, monthStart, monthEnd): Promise<number>`
- `customerBalances(vendorId): Promise<CustomerBalanceRow[]>` — `{ customerId, customerName, balance, creditLimit, paymentScore, lastPaymentDate, oldestUnpaidDate }`
- `quickStats(vendorId, today): Promise<QuickStatsRow>`
- `todayListProgress(vendorId, today, staffVendorUserId?): Promise<ListProgressRow[]>`
- `activeSubscriptionsForForecast(vendorId, supplyType?): Promise<ForecastSubscriptionRow[]>`
- `leavesInRange(vendorId, from, to): Promise<LeaveRow[]>`
- `staffName(vendorId, staffVendorUserId): Promise<string | null>`
- `staffExistsInVendor(vendorId, staffVendorUserId): Promise<boolean>`

### `IVendorSettingsRepository` (vendor-settings module port)
- `findByVendor(vendorId, tx?): Promise<VendorSettingsRow | null>`
- `upsert(entity: VendorSettingsEntity, tx?): Promise<VendorSettingsRow>`
- `transaction<T>(fn): Promise<T>`

---

## Mapper Contracts

### `DashboardMapper` (read → response, whitelisted)
- `toOwnerDashboardDto(parts) → OwnerDashboardDto`
- `toStaffDashboardDto(parts) → StaffDashboardDto`  *(financial-free shape — no money fields exist)*
- `toSupplyForecastDto(parts) → SupplyForecastDto`
- `toOutstandingAgingDto(parts) → OutstandingAgingDto`
- All BigInt IDs → strings; all amounts → numbers (rounded to integers per spec examples, INR whole rupees).

### `VendorSettingsMapper` (3-way)
- `toDomain(row) → VendorSettingsEntity` (builds `TimeOfDay` VO).
- `toPersistence(entity) → { vendorId, autoMarkEnabled, autoSendBillsEnabled, autoSendBillsTime, notificationPreferences }`.
- `toResponse(row|entity) → VendorSettingsDto` — whitelist: `{ id, vendorId, autoMarkEnabled, autoSendBillsEnabled, autoSendBillsTime, notificationPreferences, createdAt, updatedAt }`.

---

## Error Handling Strategy

| Operation | Error class | Status | Notes |
|-----------|-------------|--------|-------|
| Wrong/no tenant membership | `NotFoundError` | 404 | from `identifyUserRole` (mask) |
| Staff hits owner-only endpoint | `ForbiddenError` | 403 | `requireOwnerRole` |
| Staff views another staff's dashboard | `ForbiddenError` | 403 | in-handler check |
| `staffId` not in vendor | `NotFoundError` | 404 | mask |
| Invalid `date`/`days`/`month`/`priority` query | `ValidationError` | 400 | Zod at boundary |
| Empty PATCH body / unknown keys | `ValidationError` | 400 | `.strict()` + `.refine(atLeastOne)` |
| Invalid `autoSendBillsTime` | `ValidationError` (boundary) + `TimeOfDay` guard (domain) | 400 | validated twice |

- Use existing `@/common/errors/app-error` classes (`NotFoundError`, `ForbiddenError`,
  `ValidationError`/`BadRequestError`). Domain errors live in `vendor-settings.errors.ts`
  (`InvalidTimeOfDayError extends ExceptionBase`). All errors carry `correlationId` via the existing
  error handler. Per MEMORY: log errors with correlationId.

---

## Security Considerations

- **Owner-only** financial surfaces: owner dashboard, supply forecast, outstanding aging, settings.
  Staff get **403** (not 404) on these — they legitimately belong to the vendor, but lack the role.
- **Staff dashboard** explicitly excludes all monetary fields at the **DTO/calculator level** (not just
  hidden in UI) — the staff calculator never queries `finalAmount`, `Payment`, rates, or `creditLimit`.
- Row-level scoping by DB-validated `vendorId`. Path `vendorId` used only for routing.
- Rate limiting: standard read limiter on GETs; `writeLimiter` (50/15min) on `PATCH /settings`.

---

## Performance Considerations

- All aggregations use **indexed live queries**. Relevant existing indexes already present:
  - `daily_supplies`: `@@index([vendorId, serviceDate])`, `@@index([serviceDate, status])`,
    `@@index([supplyListId, serviceDate, status])` — cover revenue-by-month and today-progress.
  - `payments`: `@@index([vendorId])`, `@@index([paymentDate])`, `@@index([customerId, paymentDate])`.
  - `supply_list_customers`: `@@index([supplyListId, isActive])`, `@@index([startDate])`, `@@index([endDate])`.
  - `leaves`: `@@index([startDate, endDate])`.
- Prefer Prisma `aggregate` / `groupBy` over per-row loops for revenue, collected, and today progress.
- Outstanding aging: compute per-customer balances with a **single grouped query** for delivered sums
  and a **single grouped query** for payments, then reconcile in memory — avoids N+1.
- `outstanding-aging` priorityCustomers is **paginated** (max 100) to handle 500+ customer vendors.
- Owner dashboard fans out to ~6 independent reads — run them with `Promise.all` in the query handler.
- No Redis / materialized views this iteration (deferred optimization; contract unchanged when added).

---

## Test Plan

### Unit tests (`src/modules/**/__tests__/`)
- **`TimeOfDay` VO**: valid "00:00"/"23:59"; reject "24:00", "9:5", "", "20:60", non-string.
- **`VendorSettingsEntity`**: `create()` defaults; `update()` applies partial + emits event + lists
  changed keys; `validate()` rejects bad time; lazy-create path.
- **`SupplyForecastCalculator`**: quantity uses customQuantity over default; leave excludes a subscriber
  and increments plannedLeaves; 100%-leave → 0 qty; aggregation by supplyType; dailyAverage over window;
  supplyType filter; open-ended subscription (null endDate) included.
- **`OutstandingAgingCalculator`**: bucket boundaries (30/60); skip balance ≤ 0; negative balance →
  advanceCredit; utilization% with creditLimit 0 → 0; priority classification high/medium/low; sort order.
- **`FinancialSummaryCalculator`**: revenue excludes LEAVE/CANCELLED/PENDING; collectionPercentage with
  zero revenue → 0; pending clamp ≥ 0; netReceivable clamp.
- **Mappers**: whitelist (no `deletedAt` leak); BigInt→string; staff DTO has zero money fields.
- **Query handlers** (mocked ports): owner dashboard composes all parts; staff self-vs-other auth (403);
  staffId-not-in-vendor (404).

### Integration tests (`tests/integration/`)
- Seed a vendor with owner + staff, customers, supply lists, subscriptions, deliveries (today), payments,
  one leave, one advance-credit customer.
- `GET /dashboard/owner` (owner) → 200, all sections present, numbers correct; (staff) → 403.
- `GET /dashboard/staff/:staffId` — owner reads any staff → 200; staff reads self → 200 with no money
  fields; staff reads other staff → 403; unknown staffId → 404.
- `GET /supply-forecast` — default (tomorrow) and `days=7`; `supplyType` filter; leave reduces quantity.
- `GET /outstanding-aging` — buckets, priority grouping, advanceCredit section, pagination.
- `PATCH /settings` — owner toggles autoMark → 200 + persisted; lazy-create when no row; staff → 403;
  empty body → 400; bad time → 400; correlationId present in error body.
- `GET /settings` — returns current/lazy-default settings.
- Multi-tenant: caller with no membership in `:vendorId` → 404 on every endpoint.

> Follow `testing-strategy.md` for utilities; integration cleanup must delete `vendor_settings`,
> dashboard has no own table. Reference the subscription module's integration test setup/teardown.

---

## Open Questions (with recommendation + trade-off)

**OQ-1 — VendorSettings vs existing `vendors.auto_*` columns.**
The `vendors` table already stores `auto_mark_enabled`, `auto_send_bills`, `auto_send_time`; the US-010
spec defines a separate `vendor_settings` table.
*Recommendation*: introduce `vendor_settings` as the **single source of truth**, **backfill** from the
legacy columns, and stop writing the legacy columns (drop them in a later major version). *Trade-off*:
short-term duplication of three columns; the alternative (extend `vendors` in place, no new table)
contradicts the spec and gives no room for the `notification_preferences` JSON and future settings.
**Proceeding with the new-table recommendation; flagged for confirmation.**

**OQ-2 — "Oldest unpaid bill" precision.** True FIFO payment-to-delivery allocation requires a
bill/ledger model (US-009 billing) that isn't wired to per-delivery allocation yet.
*Recommendation*: v1 approximates `daysOverdue` from the **oldest delivered serviceDate while balance > 0**.
*Trade-off*: may overstate `daysOverdue` for partially-paid customers. Exact allocation deferred to the
billing ledger. **Proceeding with the approximation; documented in Business Rules.**

**OQ-3 — Non-DAILY supply lists in the forecast.** Spec's pseudocode assumes daily subscriptions.
*Recommendation*: apply `SupplyListSchedule` (dayOfWeek/dayOfMonth) so WEEKLY/MONTHLY lists only count
on matching dates; lists with no schedule rows default to DAILY. *Trade-off*: slightly more query work.
**Proceeding; if schedules are not yet populated this degrades gracefully to daily.**

**OQ-4 — `conflictsToday` definition.** The spec surfaces a conflicts count but never defines a conflict.
*Recommendation*: v1 = today's deliveries that were auto-marked **and** subsequently overridden
(auto vs manual disagreement). *Trade-off*: a narrow definition; may undercount other conflict types.
**Proceeding; easy to broaden once a conflicts model exists.**

**OQ-5 — Timezone.** Dashboards are date-bound ("today"/"tomorrow"). No per-vendor timezone exists in the
schema. *Recommendation*: use server timezone for v1 and document it. *Trade-off*: vendors in other zones
may see a date boundary off by hours near midnight. A `Vendor.timezone` column can be added later.
**Proceeding with server tz.**

---

## Skills the Dev agent must follow
- `prisma-schema-design.md` — `VendorSettings` model + migration + backfill + seeds.
- `domain-modeling.md` — `VendorSettingsEntity`, `TimeOfDay` VO, `VendorSettingsUpdatedEvent`.
- `repository-implementation.md` — both ports + Prisma adapters (read repo uses aggregate/groupBy).
- `service-implementation.md` — query handlers (CQS: all Queries except UpdateVendorSettingsCommand).
- `validation-schemas.md` — Zod for query params (`.passthrough()` reads) and PATCH body (`.strict()`).
- `error-handling.md` — error class mapping above; correlationId.
- `module-scaffold.md` — controllers, routes (composition root), `app.ts` registration, Swagger.
- `testing-strategy.md` — unit + integration plan above.
