# Feature: US-011 Vendor Settings & Automation

> Branch: `feat/us-011-vendor-settings`
> Builds on US-010 (`vendor-settings` module already shipped: entity, TimeOfDay VO,
> `VendorSettingsUpdatedEvent`, GET/PATCH `/settings`, Prisma `VendorSettings`).

## US Summary

As a vendor business owner, configure automation settings (auto-mark deliveries,
auto-send monthly bills, default credit policy, notification preferences) and run
bulk operations (mark leave, adjust rate, send reminders) so daily marking drops
from 100+ taps to a handful of exceptions.

## Complexity Assessment

- **Tier**: **Complex** (split across two aggregates + cross-module integration + cron)
- **Justification**:
  - Extends an existing aggregate (`VendorSettings`) — Simple slice.
  - Adds a **new aggregate** `BulkOperation` with a state machine (PENDING → IN_PROGRESS → COMPLETED/FAILED).
  - Three bulk command handlers each touch **cross-aggregate** data (Leave, SupplyListCustomer, DailySupply, Customer) — must use **ID-only references via ports**, never direct repository imports from other modules.
  - Introduces a `BillNotificationPort` strategy + an auto-send-bills cron job.
  - Touches the existing `delivery` module's generation/auto-mark path.
- **Directory Structure** (extends existing module; `commands/` and `queries/` subdirs are mandatory):

```
src/modules/vendor-settings/
├── domain/
│   ├── vendor-settings.entity.ts                 (MODIFY — new fields)
│   ├── vendor-settings.types.ts                  (MODIFY)
│   ├── vendor-settings.errors.ts                 (MODIFY — new domain errors)
│   ├── value-objects/
│   │   ├── time-of-day.vo.ts                      (existing)
│   │   ├── credit-limit.vo.ts                     (NEW)
│   │   └── credit-period.vo.ts                    (NEW)
│   ├── events/
│   │   ├── vendor-settings-updated.domain-event.ts (existing)
│   │   ├── notification-preferences-updated.domain-event.ts (NEW)
│   │   └── bulk-operation-completed.domain-event.ts (NEW)
│   └── bulk-operation/                            (NEW aggregate)
│       ├── bulk-operation.entity.ts
│       ├── bulk-operation.types.ts
│       └── bulk-operation.errors.ts
├── database/
│   ├── vendor-settings.repository.port.ts         (MODIFY — new fields on Row)
│   ├── vendor-settings.repository.ts              (MODIFY)
│   ├── bulk-operation.repository.port.ts          (NEW)
│   └── bulk-operation.repository.ts               (NEW)
├── ports/                                         (NEW — cross-module reads/writes)
│   ├── bulk-leave-writer.port.ts
│   ├── bulk-rate-writer.port.ts
│   ├── reminder-target.port.ts
│   └── bill-notification.port.ts                  (strategy)
├── adapters/                                      (NEW — implement ports via existing repos)
│   ├── bulk-leave-writer.adapter.ts
│   ├── bulk-rate-writer.adapter.ts
│   ├── reminder-target.adapter.ts
│   └── bill-notification-log.adapter.ts           (stub impl, like sms-stub)
├── commands/
│   ├── update-vendor-settings/                    (existing — extend input)
│   ├── update-notification-preferences/           (NEW)
│   │   └── update-notification-preferences.command.ts
│   ├── bulk-mark-leave/                            (NEW)
│   │   └── bulk-mark-leave.command.ts
│   ├── bulk-adjust-rate/                           (NEW)
│   │   └── bulk-adjust-rate.command.ts
│   ├── bulk-send-reminders/                        (NEW)
│   │   └── bulk-send-reminders.command.ts
│   └── auto-send-bills/                            (NEW — cron use case)
│       └── auto-send-bills.command.ts
├── queries/
│   ├── get-vendor-settings/                        (existing)
│   └── get-bulk-operation/                          (NEW — poll status)
│       └── get-bulk-operation.query.ts
├── vendor-settings.controller.ts                  (MODIFY — new handlers)
├── bulk-operations.controller.ts                  (NEW)
├── vendor-settings.mapper.ts                       (MODIFY — new fields)
├── bulk-operation.mapper.ts                        (NEW)
├── vendor-settings.validator.ts                    (MODIFY + new schemas)
├── vendor-settings.routes.ts                       (MODIFY — wire new routes)
├── vendor-settings.cron.ts                         (NEW — auto-send-bills)
├── vendor-settings.types.ts                        (MODIFY)
└── __tests__/                                      (extend)
```

## Scope

- Extend `VendorSettings`: `defaultCreditLimit`, `defaultCreditPeriodDays`, `bulkOperationConcurrencyLimit`.
- New `BulkOperation` aggregate + `bulk_operations_log` table.
- Extend PATCH `/settings` to accept new fields.
- New PATCH `/notification-preferences` (replaces only the JSON blob).
- Three owner-only POST bulk endpoints (mark-leave, adjust-rate, send-reminders).
- GET `/bulk-operations/:operationId` to poll status (supports async processing).
- Auto-mark integration in delivery generation (driven by `autoMarkEnabled`).
- Auto-send-bills monthly cron (last day of month at vendor's `autoSendBillsTime`).

## Out of Scope

- Real WhatsApp/SMS provider integration — use a `BillNotificationPort` strategy with a **log/stub adapter** (mirrors `sms-stub.adapter.ts`). Real provider is a future story.
- A durable job queue (Bull). v1 runs bulk ops **synchronously inside the request transaction** when under `bulkOperationConcurrencyLimit`; larger sets return `202 Accepted` with status `IN_PROGRESS` and are finished by an in-process worker tick (see Open Question OQ-3).
- Real-time WebSocket progress (frontend polls `GET /bulk-operations/:id`).
- Impact-preview endpoints (`calculateBulkLeaveImpact`, `calculateRateChangeImpact`) the wireframe references — see OQ-5.
- Per-customer credit override and "action on breach" enforcement (consumed by US-008; this story only stores the defaults — see OQ-1).

---

## Domain Model

### Aggregate 1 — VendorSettings (existing, extended)

New props on `VendorSettingsProps` / `VendorSettingsCreateProps` / `VendorSettingsPatch`:

| Prop | Type | Nullable | Default | Invariant |
|------|------|----------|---------|-----------|
| `defaultCreditLimit` | `Decimal` (string in domain) | yes | `null` | `>= 0` when present (`CreditLimit` VO) |
| `defaultCreditPeriodDays` | `number` | yes | `null` | integer `1..365` when present (`CreditPeriod` VO) |
| `bulkOperationConcurrencyLimit` | `number` | no | `50` | integer `1..500` |

- `update(patch)` extends the existing field-by-field change tracking. Changing any new
  field still emits `VendorSettingsUpdatedEvent` (add the new field names to `changed[]`).
- `updateNotificationPreferences(prefs, metadata)` — **new behaviour method** that replaces
  only `notificationPreferences`, validates it is a plain object, and emits the new
  `NotificationPreferencesUpdatedEvent`. Keeps the notification-preferences command from
  having to touch automation fields.

### Aggregate 2 — BulkOperation (NEW)

Root entity persisted to `bulk_operations_log`. One row per bulk request, used for audit
+ async status polling.

**Props**

| Prop | Type | Notes |
|------|------|-------|
| `id` | `bigint` | assigned on insert |
| `vendorId` | `bigint` | tenant scope |
| `operationType` | `BulkOperationType` enum | MARK_LEAVE / ADJUST_RATE / SEND_REMINDERS |
| `targetType` | `BulkOperationTargetType` enum | ALL / SUBSCRIPTION / CUSTOMER |
| `targetId` | `bigint \| null` | set only when a single target is named |
| `affectedCount` | `number` | filled as work completes |
| `status` | `BulkOperationStatus` enum | PENDING / IN_PROGRESS / COMPLETED / FAILED |
| `metadata` | `Json` | operation-specific params + result summary |
| `errorMessage` | `string \| null` | set on FAILED |
| `performedByUserId` | `bigint` | owner who triggered it |
| `startedAt` | `Date` | set on transition to IN_PROGRESS |
| `completedAt` | `Date \| null` | set on COMPLETED/FAILED |
| timestamps | `createdAt/updatedAt/deletedAt` | soft delete |

**State machine** (enforced by entity; invalid transitions throw `InvalidBulkOperationTransitionError`):

```
PENDING ──start()──► IN_PROGRESS ──complete(summary, count)──► COMPLETED
                          │
                          └──fail(message)──► FAILED
PENDING ──fail(message)──► FAILED            (validation failed before work began)
```
- No transition out of COMPLETED or FAILED (terminal).
- `complete()` requires current status IN_PROGRESS.

**Factory**: `BulkOperation.create({ vendorId, operationType, targetType, targetId, metadata, performedByUserId })` → status PENDING.

### Value Objects

| VO | Rule | Error |
|----|------|-------|
| `TimeOfDay` (existing) | `HH:mm`, 00:00–23:59 | `InvalidTimeOfDayError` |
| `CreditLimit` (NEW) | decimal string, `>= 0`, max 10 digits / 2 decimals | `InvalidCreditLimitError` |
| `CreditPeriod` (NEW) | integer `1..365` | `InvalidCreditPeriodError` |
| `DateOnly` (NEW, shared in module) | `YYYY-MM-DD`, valid calendar date; bulk dates must be **today or future** | `InvalidBulkDateError` (past date) |

> Reuse `delivery`'s `ServiceDate`/`appToday()` semantics for "today" (Asia/Kolkata) rather than re-deriving — read via the `BulkLeaveWriterPort` so the domain stays framework-free.

### Domain Events

| Event | Triggered when | Payload | Consumed by (v1) |
|-------|----------------|---------|-------------------|
| `VendorSettingsUpdatedEvent` (existing) | automation/credit fields change | `changed[]`, flags, times | logger (no bus yet) |
| `NotificationPreferencesUpdatedEvent` (NEW) | prefs blob replaced | `vendorId`, `changedKeys[]` | logger |
| `BulkOperationCompletedEvent` (NEW) | BulkOperation reaches COMPLETED/FAILED | `operationId`, `operationType`, `status`, `affectedCount` | logger; future: owner summary notification |

> Follow the existing pattern: events are pulled from the entity and **logged** in the command
> (no synchronous event bus in v1). Do **not** introduce a `DomainEvent` table — the module
> already established log-based emission in US-010.

### Aggregate Boundaries (ID-only references)

- `BulkOperation` references `vendorId`, `targetId`, `performedByUserId` **by ID only**.
- Bulk commands must NOT import `delivery`/`supply-list`/`customer` repositories directly.
  They depend on **ports owned by this module**, implemented by adapters at the composition root:
  - `BulkLeaveWriterPort` — list active subscriptions for a list/all, create `Leave` rows, flip existing `DailySupply` rows to `LEAVE`, expose `today()`.
  - `BulkRateWriterPort` — fetch supply lists, update `SupplyList.ratePerUnit`, update only subscriptions **without** a `customRatePerUnit`, count affected customers.
  - `ReminderTargetPort` — resolve target customers (by IDs or all-with-outstanding) → `{ customerId, phone, language, outstanding }[]`.
  - `BillNotificationPort` — strategy: `sendBill(phone, text)` / `sendReminder(phone, text)` (stub impl logs; never throws).

---

## API Endpoints

All endpoints are nested under `/api/v1/vendors/:vendorId/...`, **owner-only**, JWT-authenticated.
Middleware chain (matches existing routes): `authenticateToken → [writeLimiter] → validate(params) → validate(body) → identifyUserRole('vendorId') → requireOwnerRole → controller`.

| # | Method | Path | CQS | Summary |
|---|--------|------|-----|---------|
| 1 | PATCH | `/settings` | Command | Extended: + credit/concurrency fields |
| 2 | PATCH | `/notification-preferences` | Command | Replace prefs blob only |
| 3 | POST | `/bulk-operations/mark-leave` | Command | Mark leave for list/customers/all |
| 4 | POST | `/bulk-operations/adjust-rate` | Command | Adjust rate for subscriptions |
| 5 | POST | `/bulk-operations/send-reminders` | Command | Send payment reminders |
| 6 | GET | `/bulk-operations/:operationId` | Query | Poll bulk op status |

Full request/response shapes are in `API_SPEC.md` (the FE contract).

**Permissions**: gated by `requireOwnerRole()` (role-based), consistent with existing
`/settings`. No new `resource:action` permission strings required. (Seed note: none.)

---

## Data Model Changes

### `vendor_settings` (MODIFY)

```prisma
model VendorSettings {
  // ... existing fields ...
  defaultCreditLimit            Decimal?  @map("default_credit_limit") @db.Decimal(10, 2)
  defaultCreditPeriodDays       Int?      @map("default_credit_period_days")
  bulkOperationConcurrencyLimit Int       @default(50) @map("bulk_operation_concurrency_limit")
  // existing indexes unchanged
}
```
> Note: the user-story SQL also lists `default_credit_action (warn|pause|block)`. The task
> prompt omits it. See **OQ-1** — recommendation is to include it now to avoid a second
> migration; plan below assumes it is deferred unless OQ-1 is answered "include".

### `bulk_operations_log` (NEW)

```prisma
enum BulkOperationType {
  MARK_LEAVE
  ADJUST_RATE
  SEND_REMINDERS
  @@map("bulk_operation_type")
}

enum BulkOperationTargetType {
  ALL
  SUBSCRIPTION
  CUSTOMER
  @@map("bulk_operation_target_type")
}

enum BulkOperationStatus {
  PENDING
  IN_PROGRESS
  COMPLETED
  FAILED
  @@map("bulk_operation_status")
}

model BulkOperationLog {
  id BigInt @id @default(autoincrement())

  vendorId          BigInt                  @map("vendor_id")
  operationType     BulkOperationType       @map("operation_type")
  targetType        BulkOperationTargetType @map("target_type")
  targetId          BigInt?                 @map("target_id")
  affectedCount     Int                     @default(0) @map("affected_count")
  status            BulkOperationStatus     @default(PENDING)
  metadata          Json                    @default("{}")
  errorMessage      String?                 @map("error_message") @db.Text
  performedByUserId BigInt                  @map("performed_by_user_id")

  startedAt   DateTime  @default(now()) @map("started_at")
  completedAt DateTime? @map("completed_at")

  createdAt DateTime  @default(now()) @map("created_at")
  updatedAt DateTime  @updatedAt @map("updated_at")
  deletedAt DateTime? @map("deleted_at")

  vendor          Vendor @relation(fields: [vendorId], references: [id], onDelete: Restrict)
  performedByUser User   @relation("BulkOpPerformedBy", fields: [performedByUserId], references: [id], onDelete: Restrict)

  @@index([vendorId])
  @@index([status])
  @@index([operationType])
  @@index([performedByUserId])
  @@index([deletedAt])
  @@index([createdAt])
  @@index([vendorId, status])
  @@map("bulk_operations_log")
}
```
> Mandatory indexes present: `vendorId`, `deletedAt`, `createdAt`, all FK columns.
> Composite `(vendorId, status)` for the worker poll of unfinished ops.

**Back-relations to add**: `Vendor.bulkOperations BulkOperationLog[]` and
`User.bulkOperationsPerformed BulkOperationLog[] @relation("BulkOpPerformedBy")`.

### Migration plan

1. Single migration `add_us011_vendor_settings_and_bulk_ops`:
   - `ALTER TABLE vendor_settings ADD COLUMN ...` (3 nullable/defaulted columns — non-breaking).
   - `CREATE TYPE` for the three enums.
   - `CREATE TABLE bulk_operations_log` + indexes + FKs.
2. `bulkOperationConcurrencyLimit` defaults to 50, so existing rows backfill automatically.
3. No data backfill needed for the nullable credit columns.
4. Update `../project_documents/db-design/18-*.sql` (or the vendor-settings module SQL) to
   match — see OQ-2 on which db-design file owns these tables.

### Seed data

- No new permissions (owner-role gate).
- Dev seed: for each seeded vendor, set `defaultCreditLimit=2000`, `defaultCreditPeriodDays=30`,
  `bulkOperationConcurrencyLimit=50`; insert 2–3 faker `bulk_operations_log` rows in mixed
  statuses (one COMPLETED MARK_LEAVE with summary metadata, one FAILED, one PENDING) so the FE
  status-polling UI has data.

---

## Business Rules

### Invariants
- `defaultCreditLimit >= 0`; `defaultCreditPeriodDays ∈ [1,365]`; `bulkOperationConcurrencyLimit ∈ [1,500]`.
- `BulkOperation` state machine transitions only as drawn above.
- Exactly one targeting mode per bulk request: either `all: true` **or** a non-empty id array — never both, never neither (Zod discriminated/refined).
- Bulk leave date(s) must be **today or future** (edge case #9 — past date → 422/400).
- Rate change applies only to the supply-list default and to subscriptions **without**
  `customRatePerUnit` (edge case #7 — custom-rate subs skipped, counted as `skipped`).
- Bulk leave skips customer/date combos that already have a covering `Leave` (edge case #2).
- Rate change is forward-only; never rewrites past `DailySupply`/bills (edge case #3).
- Rate `newRate === 0` is allowed (edge case #10 — FE shows a confirm; backend accepts).

### Auto-mark integration (delivery module)
- Generation already supports auto-mark via `DailySupplyEntity.create({ onLeave })` and the
  `AutoMarkSweepCommand`. US-011 wires `autoMarkEnabled` into the decision:
  - When `autoMarkEnabled = true` and not on leave → status `DELIVERED` (system-marked, `isAutoMarked=true`, `markedByUserId=null`).
  - When `false` → status `PENDING` (current behaviour).
  - On leave → `LEAVE` regardless.
- `GenerateDailySuppliesCommand.generateForVendor` must read the vendor's settings once per
  vendor via a **read port** (`VendorSettingsReaderPort`) — delivery must not import the
  vendor-settings repository directly. The reader returns `{ autoMarkEnabled }` (default
  `true` when no settings row exists, matching the entity default).
- Setting changes apply from the **next generation run** only — never retroactive (edge cases #1, #6).

### Auto-send bills cron
- New job in `vendor-settings.cron.ts`, gated by `ENABLE_CRON=true`, timezone `Asia/Kolkata`,
  schedule `0 * * * *` (hourly). Each tick:
  1. If today is **not** the last day of the month → return.
  2. Select vendors where `autoSendBillsEnabled = true` AND `HOUR(autoSendBillsTime) = currentHour`.
  3. For each vendor's active customers: generate the monthly bill text, `BillNotificationPort.sendBill(phone, text)`, record a `bulk_operations_log` row of type `SEND_REMINDERS`/metadata `{ kind: 'auto-bill' }` for the run summary, log per-customer success/failure (retry once on failure — edge case #4).
- Bill generation/text formatting is delegated to a port (`MonthlyBillReaderPort`) implemented
  against the billing/customer module; this story does not compute bill math itself.

### Multi-tenant isolation
- `vendorId` always comes from `req.roleContext.vendorId` (JWT-derived), never the body.
- `GET /bulk-operations/:operationId` for an op belonging to another vendor → **404 NotFound**
  (mask existence), never 403.
- All bulk writers filter their queries by `vendorId`; any target id (subscription/customer)
  resolved to a different vendor is dropped and counted as `skipped`, never acted upon.

---

## Sequence Diagrams (text)

### Bulk mark-leave (sync path, count ≤ concurrencyLimit)
```
Controller → BulkMarkLeaveCommand.execute({vendorId, mode, ids|all, date, reason, userId, correlationId})
  repo.transaction:
    settings = settingsReader.get(vendorId)            // concurrency limit
    targets  = bulkLeaveWriter.resolveSubscriptions(vendorId, mode, ids|all)
    op = BulkOperation.create(MARK_LEAVE, target, metadata)   // PENDING
    op = repo.insert(op)                                       // assigns id
    if targets.length > limit → op.status stays PENDING, return 202 (worker finishes)
    op.start()                                                 // IN_PROGRESS
    for each subscription:
        if bulkLeaveWriter.hasCoveringLeave(subId, date) → skip++
        else bulkLeaveWriter.createLeave(subId, date, reason, VENDOR_MARKED, userId)
             bulkLeaveWriter.markDeliveriesLeave(subId, date) → affected++
    op.complete({customersAffected, days, totalLeaves, revenueImpact}, affected)  // COMPLETED
    repo.save(op)
  pullEvents → log BulkOperationCompletedEvent
  mapper.toResponse(op)  →  200 { success, data: { operationId, status, summary } }
```

### Bulk adjust-rate
```
Command: resolve lists (single or all-same-supply) → for each list:
  bulkRateWriter.updateListDefaultRate(listId, newRate, vendorId)
  bulkRateWriter.updateSubsWithoutCustomRate(listId, newRate) → customersAffected
  customersWithCustomRate → skipped
  if notifyCustomers: for each affected → BillNotificationPort.sendReminder(phone, rateChangeText)
op.complete({listsAffected, customersAffected, rateChange, monthlyImpact})
```

### Auto-send bills cron tick
```
cron(0 * * * *) → if !isLastDayOfMonth return
  vendors = settingsReader.vendorsForAutoSend(currentHour)
  for vendor: op = BulkOperation.create(SEND_REMINDERS, ALL, {kind:'auto-bill'})
    customers = monthlyBillReader.activeCustomers(vendorId)
    for c: text = monthlyBillReader.formatBill(c, month)
           try sendBill(c.phone, text) → sent++  catch → retry once → failed++
    op.complete({totalSent, delivered, failed})
```

---

## Strategy Interfaces (external services)

```ts
// ports/bill-notification.port.ts  (strategy — selected at composition root)
export interface BillNotificationPort {
  /** Must not throw — log + resolve. Returns true on accepted-for-delivery. */
  sendBill(phone: string, text: string): Promise<boolean>;
  sendReminder(phone: string, text: string): Promise<boolean>;
}
```
- **Known implementation (v1)**: `BillNotificationLogAdapter` — logs and returns `true`
  (mirrors `auth/adapters/sms-stub.adapter.ts`).
- **Future**: `WhatsAppBillNotificationAdapter` (real provider) — swapped at the composition
  root with no command changes.
- No inbound webhook in this story (outbound only).

---

## Error Handling Strategy

| Domain operation | Failure | Domain error | HTTP mapping |
|------------------|---------|--------------|--------------|
| Settings update | bad time | `InvalidTimeOfDayError` | 400 ValidationError |
| Settings update | bad prefs blob | `InvalidNotificationPreferencesError` | 400 |
| Settings update | credit limit < 0 | `InvalidCreditLimitError` | 400 |
| Settings update | period out of range | `InvalidCreditPeriodError` | 400 |
| Bulk request | both/neither targeting mode | (Zod) | 400 ValidationError |
| Bulk request | > N target items | (Zod max) | 413 PayloadTooLarge |
| Bulk leave | past date | `InvalidBulkDateError` | 422 Unprocessable |
| Bulk op transition | illegal transition | `InvalidBulkOperationTransitionError` | 422 (internal guard; should not surface in normal flow) |
| Get bulk op | wrong/other tenant or missing | `NotFoundError` | 404 (masked) |
| Owner gate | staff caller | `ForbiddenError` | 403 |

- Commands catch domain errors and rethrow as `app-error` types (pattern from existing
  `UpdateVendorSettingsCommand`), preserving `correlationId`.
- On bulk processing failure, the command calls `op.fail(message)`, persists FAILED with
  `errorMessage`, logs the error with `correlationId` to `Logs/YYYY-MM-DD.txt` (per memory),
  and rethrows a 422/500 as appropriate. The persisted FAILED row is the durable record.

## Security Considerations
- Owner-only via `requireOwnerRole()`; `vendorId` from JWT context, never body.
- Bulk endpoints behind the existing `writeLimiter` (50/15min, 1000 in test).
- Tenant masking (404) on cross-tenant `GET /bulk-operations/:id`.
- Target ids validated to belong to the caller's vendor; foreign ids silently skipped.
- `metadata` JSON is server-constructed (params echoed + computed summary) — never reflect raw client objects that could leak.

## Performance Considerations
- `bulkOperationConcurrencyLimit` caps synchronous work per request; larger sets go async (202 + poll).
- Bulk writes use set-based Prisma `updateMany`/`createMany` where possible (leave creation,
  subscription rate update), not per-row round-trips.
- `(vendorId, status)` composite index supports the worker poll of unfinished ops and the FE
  history list.
- WhatsApp/bill sends batched (story notes max 50/min); the stub is instant, real adapter must throttle.

---

## Test Plan

**Unit**
- `VendorSettingsEntity`: new field change-tracking + new VOs (limit < 0, period 0/366, concurrency bounds); `updateNotificationPreferences` emits the new event.
- `BulkOperation` entity: every legal transition + each illegal transition throws.
- New VOs: `CreditLimit`, `CreditPeriod`, `DateOnly` (past date rejected).
- Each bulk command with **mocked ports**: skip-on-existing-leave, skip custom-rate subs, count summary correctness, FAILED path persists errorMessage.
- Auto-mark decision: `autoMarkEnabled` true→DELIVERED, false→PENDING, onLeave→LEAVE (default true when no settings).
- Cron: `isLastDayOfMonth` + hour-match selection; retry-once on send failure.

**Integration (Supertest)**
- PATCH `/settings` with new fields (happy + each validation error + empty body).
- PATCH `/notification-preferences` (replace blob; array rejected).
- POST each bulk endpoint: happy 200, staff→403, cross-tenant target skipped, both/neither mode→400, oversized→413, past date→422.
- GET `/bulk-operations/:id`: own op 200, other tenant 404, missing 404.
- correlationId present in all error envelopes.
- Multi-tenant isolation across two seeded vendors.

---

## Open Questions (recommendation + trade-off — non-blocking)

**OQ-1 — `defaultCreditAction` (warn/pause/block).** The US-011 SQL lists it; the task prompt
omits it. **Recommendation: add it now** as an enum column on `vendor_settings`
(`default_credit_action`, default `WARN`) and accept it in PATCH `/settings`.
*Trade-off*: adding it now is one cheap extra column and avoids a second migration when US-008
enforcement lands; omitting keeps this story minimal but guarantees a follow-up migration.
**Assumed for the plan**: deferred (matches the task prompt) — flip on confirmation.

**OQ-2 — db-design ownership.** Which `project_documents/db-design/*.sql` file owns
`vendor_settings` / `bulk_operations_log`? **Recommendation**: update the existing
settings/automation module SQL (the file that already defines `vendor_settings` from US-010)
in the same PR so SQL and Prisma stay in lockstep. *Trade-off*: none beyond locating the file.

**OQ-3 — sync vs async bulk threshold & worker.** The story says "process in background for
500+". **Recommendation**: run synchronously when `targetCount ≤ bulkOperationConcurrencyLimit`
(return 200 COMPLETED); above it, persist PENDING, return **202** with `operationId`, and finish
via an in-process worker tick (reuse the cron-gated pattern, no Bull in v1). FE already polls
`GET /bulk-operations/:id`. *Trade-off*: in-process worker won't survive a crash mid-run (the
PENDING row is recoverable by the next tick); a real queue (Bull) is the durable answer but is
out of scope. **Assumed**: this hybrid.

**OQ-4 — request field naming.** Task prompt uses `subscriptionIds`/`newRate`/`effectiveDate`/
`messageTemplate`; the user-story body uses `supplyListId`/`customerIds`/`scope`/`effectiveFrom`/
`reason`/`customMessage`. **Recommendation**: follow the **task-prompt field names** (they are
the explicit contract for this assignment) and document them in `API_SPEC.md`; map richer
US options (e.g. `scope=all_lists_same_supply`, `reason`) as optional additive fields.
*Trade-off*: the wireframe screens assume the richer US shape, so the FE architect must read
`API_SPEC.md` as authoritative — flagged there explicitly.

**OQ-5 — impact-preview endpoints.** Wireframes call `calculateBulkLeaveImpact` /
`calculateRateChangeImpact` for live impact cards. The task prompt does not request them.
**Recommendation**: ship the mutation endpoints now (they return the same summary on success);
add `GET .../impact` preview endpoints in a fast-follow if the FE needs pre-confirm numbers.
*Trade-off*: without preview endpoints the FE can't show the impact card before submit; if that
is a hard wireframe requirement, add two read-only query handlers (cheap, reuse the writer ports
in dry-run mode). **Assumed**: deferred.

**OQ-6 — bill text & language.** Auto-send/reminders need bill formatting + customer language.
**Recommendation**: delegate to a `MonthlyBillReaderPort` owned by this module and implemented
by the billing/customer module; if no monthly-bill computation exists yet, the stub returns a
templated summary. *Trade-off*: real bill math may be a dependency not yet built (US billing) —
the stub keeps US-011 unblocked and swappable later.
