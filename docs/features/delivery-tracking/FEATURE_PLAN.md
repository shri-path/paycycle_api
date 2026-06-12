# Feature: Daily Delivery Tracking (US-006)

> **User Story**: [US-006 — Daily Delivery Tracking](../project_documents/vendor_app/user_stories/US-006-delivery-tracking.md)
> **Branch**: `feat/us-006-delivery-tracking`
> **Status**: Architect designing
> **Canonical artifacts** (Dev consumes these): this file + `DOMAIN_MODEL.md` + `FEATURE_TASKS.md` will live under `docs/features/delivery-tracking/`. This root-level `FEATURE_PLAN.md` is the working draft for the handoff; copy into `docs/features/delivery-tracking/` when the pipeline starts.

---

## 1. Summary

US-006 turns subscriptions (US-005 `supply_list_customers`) into a **daily operational ledger**. Each active subscription generates one **daily supply** row per service date. Staff and owners then **mark** each row `DELIVERED` or `LEAVE`, optionally add **extra charges** (with a mandatory reason) and record **planned leaves** (date ranges) that pre-mark future rows. The owner gets aggregate views (today across lists, calendar month, day detail) and **conflict** detection when the customer's self-service marking disagrees with staff marking.

**Why**: This is the data foundation for billing (amount per day), dashboards (US-010), and audit (US-007). It also completes the staff persona — staff finally have a real daily workflow, and the three grant keys seeded back in US-002/US-005 (`mark_deliveries`, `mark_leaves`, `add_extra_charges`) become enforceable.

**Key reconciliation with the story doc** (the story's inline SQL is superseded by canonical db-design 07/08):

| Story doc (inline SQL)              | Canonical (db-design 07/08) — AUTHORITATIVE          | Resolution |
|-------------------------------------|------------------------------------------------------|------------|
| table `daily_deliveries`            | table `daily_supplies`                               | Use `daily_supplies` |
| FK `subscription_id`                | FK `supply_list_customer_id`                         | Use `supply_list_customer_id` |
| `delivery_date`                     | `service_date`                                       | Use `service_date` |
| `customer_id` column on delivery    | (none — reached via `supply_list_customer_id`)       | Drop; denormalize only `vendor_id` + `supply_list_id` (already in canonical) |
| status `'pending','delivered','leave','conflict'` | enum `daily_supply_status = PENDING, DELIVERED, LEAVE, AUTO_MARKED, CANCELLED` | Use canonical enum; **conflict is NOT a status** (see §5 Conflict Handling) |
| `amount` (single)                   | `base_amount` + `final_amount`                       | Use both (base = qty×rate, final = base + extra charges) |
| `marked_by_role` enum on row        | `actor_role` lives on the override/charge audit rows | Role captured in `supply_overrides` / `supply_extra_charges`, not on `daily_supplies` |
| table `extra_charges`               | table `supply_extra_charges` (FK `daily_supply_id`)  | Use canonical; charge attaches to a daily supply, not a (customer,date) pair |
| table `customer_leaves`             | table `leaves` (FK `supply_list_customer_id`)        | Use canonical |
| (none)                              | table `supply_overrides` (immutable marking audit)   | **Adopt** — every status/quantity change writes one override row |
| `conflict_reason` TEXT on row       | — | Modeled as an override + a `hasConflict` derived flag (see §5) |

All such reconciliations are mirrored as comments in the Prisma schema and surfaced in **Open Questions** where a genuine decision is involved.

---

## 2. Complexity Assessment

- **Tier**: **Complex**
- **Justification**:
  - Two aggregates with rich invariants: **DailySupply** (status state-machine, amount recomputation, conflict detection, append-only override trail) and **Leave** (date-range value object, retroactive pre-marking of daily rows).
  - A **scheduled generation** use case (idempotent daily fan-out across all vendors) that is neither a simple command nor a query.
  - Cross-aggregate orchestration: a `Leave` write must atomically transition affected `DailySupply` rows. An `ExtraCharge` write must recompute `final_amount` on its parent `DailySupply`.
  - Multiple aggregate reads feeding **derived reporting projections** (today-summary, calendar, day-detail) that bypass the domain layer (CQS read side).
  - It is the upstream provider that US-005 already stubbed via `DeliveryStatsPort` — US-006 must ship the real adapter and re-wire the supply-list composition root.
- **Architecture depth**: Full DDD with vertical slicing (`domain/`, `commands/`, `queries/`, `database/`, `adapters/`, `ports/`), matching the shipped `supply-list` module layout.
- **Directory structure**: see §6.

---

## 3. Domain Model

> Full detail in `DOMAIN_MODEL.md`. Summary here.

### Bounded context
New module **`delivery`** (`src/modules/delivery/`). Ubiquitous language: *daily supply*, *service date*, *mark*, *override*, *extra charge*, *leave*, *conflict*, *auto-mark*, *generation run*.

- **OWNS**: `daily_supplies`, `supply_overrides`, `supply_extra_charges`, `leaves`, generation logic, conflict detection.
- **DOES NOT OWN**: supply lists, subscriptions, staff assignments, customers (all read via ports into the supply-list / staff / customer contexts).
- **Provides**: the real `DeliveryStatsPort` adapter consumed by the `supply-list` module (replaces `DeliveryStatsZeroStubAdapter`).

### Aggregates

**A. DailySupply (aggregate root)**
- Children: `SupplyOverride` (append-only audit entries), `SupplyExtraCharge` (line items).
- Cross-aggregate refs by ID only: `vendorId`, `supplyListCustomerId`, `supplyListId`, `markedByUserId`.
- **Invariants**:
  1. `baseAmount = quantity × ratePerUnit`, both `≥ 0`.
  2. `finalAmount = baseAmount + Σ(extraCharges.amount)`; recomputed whenever a charge is added/removed; `≥ 0`.
  3. `status = LEAVE` ⟹ `finalAmount = 0` and any extra charges are disallowed (see OQ-3).
  4. Status transitions follow the state machine (below); terminal `CANCELLED` cannot be re-marked.
  5. Every status- or quantity-changing mutation appends exactly one `SupplyOverride` row (immutable trail).
  6. Uniqueness: at most one row per `(supplyListCustomerId, serviceDate)` (DB unique constraint).
- **State machine** (`daily_supply_status`):
  - `PENDING → DELIVERED` (mark delivered) · `PENDING → LEAVE` (mark leave) · `PENDING → AUTO_MARKED` (cron auto-mark) · `PENDING → CANCELLED` (subscription ended/customer removed)
  - `DELIVERED → LEAVE`, `LEAVE → DELIVERED`, `AUTO_MARKED → DELIVERED`, `AUTO_MARKED → LEAVE` (owner/staff correction)
  - `DELIVERED → CANCELLED`, `LEAVE → CANCELLED` (subscription ended) — owner only
  - `CANCELLED` = terminal.
- **Conflict**: not a status. A conflict is *derived* = the latest override by a `CUSTOMER` actor disagrees with the latest override by a `VENDOR_STAFF`/`VENDOR_OWNER` actor on the same daily supply. Exposed as `hasConflict: boolean` + `conflictReason: string | null` in read projections; resolved when an owner re-marks (which appends a `VENDOR_OWNER` override, making it the latest).
- **Domain events**: `DailySupplyMarked`, `DailySupplyConflictDetected`, `ExtraChargeAdded`, `DailySupplyCancelled`.

**B. Leave (aggregate root)**
- Value object `DateRange` (start ≤ end). Cross-aggregate refs by ID: `supplyListCustomerId`, `createdByUserId`.
- **Invariants**: `endDate ≥ startDate`; `leaveType ∈ {CUSTOMER_REQUESTED, VENDOR_MARKED, SYSTEM}`.
- **Behavior**: creating a Leave triggers (in the same transaction, via application service) pre-marking of any existing `DailySupply` rows whose `serviceDate` falls in range to `LEAVE` (amount→0); and future generation consults open leaves.
- **Domain events**: `LeaveCreated`, `LeaveCancelled`.

### Value Objects
- `ServiceDate` — a calendar date normalized to midnight UTC (no time component).
- `DeliveryQuantity` / `RateMoney` — reuse the conceptual VOs already in `supply-list/domain/value-objects` (`quantity.value-object.ts`, `rate-money.value-object.ts`); **do not import across modules** — define delivery-local copies (modules are encapsulated).
- `DateRange` — reuse the conceptual pattern from `supply-list/domain/value-objects/date-range.value-object.ts`; define a delivery-local copy.
- `ActorRole` — enum VO mapping `RoleContext` (`owner`/`staff`) + customer/system into `actor_role` (`VENDOR_OWNER`, `VENDOR_STAFF`, `CUSTOMER`, `SYSTEM`).
- `DeliveryStatus` — wraps `daily_supply_status` with transition validation.

### Aggregate boundaries (owned vs referenced-by-ID)
- DailySupply **owns** its `SupplyOverride[]` and `SupplyExtraCharge[]` (Prisma relations, cascade delete).
- DailySupply **references by ID** (no `@relation` traversal in domain): vendor, subscription, supply list, marking user.
- Leave references subscription + user by ID. Leave and DailySupply are **separate aggregates** — coordinated by the application service in one transaction (eventual-consistency boundary is acceptable since both live in this module and the DB transaction spans them).

---

## 4. Prisma Schema Changes

> Source of truth: db-design `07-daily-operations.sql` + `08-extra-charges-leaves.sql`. The SQL files already match this design; no SQL edits required. Below is the Prisma DSL to ADD to `prisma/schema.prisma`. **No existing models change** except adding back-relations on `Vendor`, `User`, `SupplyList`, and `SupplyListCustomer`.

### New enums

```prisma
enum DailySupplyStatus {
  PENDING
  DELIVERED
  LEAVE
  AUTO_MARKED
  CANCELLED

  @@map("daily_supply_status")
}

enum ActorRole {
  CUSTOMER
  VENDOR_OWNER
  VENDOR_STAFF
  SYSTEM

  @@map("actor_role")
}

enum LeaveType {
  CUSTOMER_REQUESTED
  VENDOR_MARKED
  SYSTEM

  @@map("leave_type")
}
```

### MODULE 07: DAILY OPERATIONS

```prisma
model DailySupply {
  id BigInt @id @default(autoincrement())

  // Cross-aggregate references by ID (denormalized for vendor/list scoped queries)
  vendorId             BigInt @map("vendor_id")
  supplyListCustomerId BigInt @map("supply_list_customer_id")
  supplyListId         BigInt @map("supply_list_id")

  serviceDate DateTime          @map("service_date") @db.Date
  status      DailySupplyStatus @default(PENDING)

  quantity    Decimal @db.Decimal(10, 3)
  unit        String  @db.VarChar(20)
  ratePerUnit Decimal @map("rate_per_unit") @db.Decimal(10, 2)
  baseAmount  Decimal @map("base_amount") @db.Decimal(10, 2)  // quantity × ratePerUnit
  finalAmount Decimal @map("final_amount") @db.Decimal(10, 2)  // baseAmount + Σ extra charges

  isAutoMarked   Boolean   @default(false) @map("is_auto_marked")
  markedByUserId BigInt?   @map("marked_by_user_id")
  markedAt       DateTime? @map("marked_at")

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  // === Relations (owned children + read-only parent refs) ===
  vendor       Vendor             @relation(fields: [vendorId], references: [id], onDelete: Restrict)
  subscription SupplyListCustomer @relation(fields: [supplyListCustomerId], references: [id], onDelete: Cascade)
  supplyList   SupplyList         @relation(fields: [supplyListId], references: [id], onDelete: Cascade)
  markedByUser User?              @relation("DailySupplyMarkedBy", fields: [markedByUserId], references: [id], onDelete: SetNull)

  overrides     SupplyOverride[]
  extraCharges  SupplyExtraCharge[]

  @@unique([supplyListCustomerId, serviceDate], map: "uq_daily_supplies_list_customer_date")
  @@index([vendorId])
  @@index([supplyListCustomerId])
  @@index([supplyListId])
  @@index([serviceDate])
  @@index([status])
  @@index([markedByUserId])
  @@index([vendorId, serviceDate])
  @@index([serviceDate, status])
  @@index([supplyListId, serviceDate, status]) // staff list-day view
  @@map("daily_supplies")
}

model SupplyOverride {
  id BigInt @id @default(autoincrement())

  dailySupplyId    BigInt     @map("daily_supply_id")
  changedByUserId  BigInt?    @map("changed_by_user_id")
  actorRole        ActorRole? @map("actor_role")
  previousStatus   String?    @map("previous_status") @db.VarChar(20)
  newStatus        String?    @map("new_status") @db.VarChar(20)
  previousQuantity Decimal?   @map("previous_quantity") @db.Decimal(10, 3)
  newQuantity      Decimal?   @map("new_quantity") @db.Decimal(10, 3)
  comment          String?    @db.Text

  createdAt DateTime @default(now()) @map("created_at")

  dailySupply   DailySupply @relation(fields: [dailySupplyId], references: [id], onDelete: Cascade)
  changedByUser User?       @relation("SupplyOverrideChangedBy", fields: [changedByUserId], references: [id], onDelete: SetNull)

  @@index([dailySupplyId])
  @@index([changedByUserId])
  @@index([createdAt])
  @@map("supply_overrides")
}
```

> **Note**: `supply_overrides` is an **immutable append-only audit trail** — no `updatedAt`, no `deletedAt`. This matches db-design 07. It is the marking-history sub-entity inside the DailySupply aggregate (not a separate aggregate).

### MODULE 08: EXTRA CHARGES & LEAVES

```prisma
model SupplyExtraCharge {
  id BigInt @id @default(autoincrement())

  dailySupplyId BigInt     @map("daily_supply_id")
  amount        Decimal    @db.Decimal(10, 2)  // non-zero; positive = charge, negative = discount
  comment       String     @db.Text            // mandatory reason
  addedByUserId BigInt?    @map("added_by_user_id")
  addedByRole   ActorRole? @map("added_by_role")

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  dailySupply DailySupply @relation(fields: [dailySupplyId], references: [id], onDelete: Cascade)
  addedByUser User?       @relation("SupplyExtraChargeAddedBy", fields: [addedByUserId], references: [id], onDelete: SetNull)

  @@index([dailySupplyId])
  @@index([addedByUserId])
  @@index([createdAt])
  @@map("supply_extra_charges")
}

model Leave {
  id BigInt @id @default(autoincrement())

  supplyListCustomerId BigInt    @map("supply_list_customer_id")
  startDate            DateTime  @map("start_date") @db.Date
  endDate              DateTime  @map("end_date") @db.Date
  leaveType            LeaveType @default(CUSTOMER_REQUESTED) @map("leave_type")
  reason               String?   @db.Text
  createdByUserId      BigInt?   @map("created_by_user_id")

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  subscription  SupplyListCustomer @relation(fields: [supplyListCustomerId], references: [id], onDelete: Cascade)
  createdByUser User?              @relation("LeaveCreatedBy", fields: [createdByUserId], references: [id], onDelete: SetNull)

  @@index([supplyListCustomerId])
  @@index([startDate])
  @@index([endDate])
  @@index([createdByUserId])
  @@index([startDate, endDate])
  @@map("leaves")
}
```

### Back-relations to add on existing models (non-breaking)

```prisma
// Vendor:             dailySupplies        DailySupply[]
// SupplyList:         dailySupplies        DailySupply[]
// SupplyListCustomer: dailySupplies        DailySupply[]
//                     leaves               Leave[]
// User:               dailySuppliesMarked  DailySupply[]       @relation("DailySupplyMarkedBy")
//                     supplyOverridesMade  SupplyOverride[]    @relation("SupplyOverrideChangedBy")
//                     extraChargesAdded    SupplyExtraCharge[] @relation("SupplyExtraChargeAddedBy")
//                     leavesCreated        Leave[]             @relation("LeaveCreatedBy")
```

### Index notes (mandatory-index audit)
- `daily_supplies`: no `deletedAt` — this is an operational ledger; rows are `CANCELLED`, never soft-deleted (matches canonical SQL, which has no `deleted_at`). `createdAt` not separately indexed because `serviceDate`/composite indexes cover all query paths; add `@@index([createdAt])` only if Dev finds a sort need.
- `supply_overrides`: append-only, no soft delete (correct).
- `leaves`: no soft delete in canonical; cancellation is a hard delete (see OQ-5). FK + range indexes present.
- All FKs indexed; all `vendorId`/list composite indexes present for the reporting queries in §5.

### Migration
`prisma/migrations/<ts>_create_delivery_tracking/` — creates 3 enums, 4 tables, indexes, the partial-unique already covered by the plain unique `(supply_list_customer_id, service_date)`. Review generated SQL against db-design 07/08 before deploy.

---

## 5. API Endpoints

Base: `/api/v1/vendors/:vendorId/...` (vendor-scoped, multi-tenant; `identifyUserRole` resolves `RoleContext`, wrong tenant → 404). All responses use the global `{ success, data, meta? }` envelope; errors carry `correlationId`. **All IDs serialize as strings.** `service_date` as `YYYY-MM-DD`.

| # | Method & Path | CQS | Auth / Permission |
|---|---------------|-----|-------------------|
| 1 | `GET  /vendors/:vendorId/deliveries/today` | Query | member; owner=all, staff=assigned lists only |
| 2 | `GET  /vendors/:vendorId/supply-lists/:listId/deliveries` | Query | member; staff must be assigned (else 404) |
| 3 | `PATCH /vendors/:vendorId/deliveries/:deliveryId/mark` | Command | owner OR staff w/ `mark_deliveries` (+ `mark_leaves` for leave) on the list |
| 4 | `POST /vendors/:vendorId/deliveries/mark-bulk` | Command | same as #3, scoped to one list |
| 5 | `POST /vendors/:vendorId/extra-charges` | Command | owner OR staff w/ `add_extra_charges` on the list |
| 6 | `POST /vendors/:vendorId/leaves` | Command | owner OR staff w/ `mark_leaves` on the list(s) |
| 7 | `GET  /vendors/:vendorId/leaves` | Query | member; staff scoped to assigned lists |
| 8 | `DELETE /vendors/:vendorId/leaves/:leaveId` | Command | owner OR staff w/ `mark_leaves` (own future leave) |
| 9 | `GET  /vendors/:vendorId/deliveries/calendar` | Query | owner only |
| 10 | `GET  /vendors/:vendorId/deliveries/date/:date` | Query | owner only |
| 11 | `POST /vendors/:vendorId/deliveries/generate` | Command | owner only (manual trigger; also invoked by cron internally) |

> **Path decision**: I keep vendor-scoped paths (`/vendors/:vendorId/deliveries/:deliveryId/mark`) rather than the story's bare `/deliveries/:id/mark`, for consistency with every shipped module and to drive multi-tenant isolation through one middleware chain. The `:deliveryId` is still validated to belong to `:vendorId` in the service (404 mask). See OQ-2.

### Endpoint contracts

**1. GET `/deliveries/today?listId=&staffId=&date=`** (Query)
- `date` optional, defaults to "today" in vendor TZ (OQ-4). Owner sees all lists; staff is force-filtered to assigned lists regardless of `listId`/`staffId`.
- 200:
```json
{ "success": true, "data": {
  "date": "2026-04-12",
  "summary": { "totalDeliveries": 185, "delivered": 150, "onLeave": 15, "pending": 20, "autoMarked": 0, "revenue": "9250.00", "conflicts": 3 },
  "byList": [ { "listId": "10", "listName": "Morning Milk", "startTime": "06:00", "staff": [{ "staffId": "10", "name": "Raju" }], "totalCustomers": 52, "delivered": 45, "onLeave": 3, "pending": 4, "revenue": "2450.00" } ],
  "conflicts": [ { "deliveryId": "10", "customerName": "Anil Kumar", "listName": "Morning Milk", "reason": "Staff marked delivered; customer marked leave" } ]
} }
```

**2. GET `/supply-lists/:listId/deliveries?date=&filter[status]=&search[query]=`** (Query)
- Per-customer delivery cards for one list/day. Staff revenue fields omitted unless `RoleContext.role==='owner'` (financial data is owner-only — story note).
- 200: `data: { listId, listName, date, progress:{ total, delivered, onLeave, pending }, deliveries:[ { id, customer:{ id, name, address, phoneNumber }, quantity, unit, ratePerUnit?, amount?, status, markedBy:{ userId, name, role }|null, markedAt|null, hasConflict, otherLists:["Evening Milk"] } ] }`.
- `ratePerUnit`/`amount` are present only for owners.

**3. PATCH `/deliveries/:deliveryId/mark`** (Command)
- Body: `{ "status": "DELIVERED" | "LEAVE", "quantity"?: number }` (`quantity` optional override on delivered).
- `markedByUserId`/`markedByRole` are derived **server-side** from `RoleContext` — NOT accepted from the client (story's body field is rejected for security).
- Flow: load delivery (tenant+list scoped, else 404) → permission check (owner; or staff assigned to list with the right grant) → `entity.markDelivered()/markLeave()` (validates transition, recomputes amount, detects conflict, appends override) → persist in tx → audit log → emit events → return updated delivery.
- 200: `data: { delivery: { ...full object }, hasConflict: boolean }`.
- Errors: 400 invalid transition, 403 missing grant, 404 wrong tenant/list/missing, 409 (none — re-mark is idempotent-ish, handled as override).

**4. POST `/deliveries/mark-bulk`** (Command)
- Body: `{ "supplyListId": "10", "date": "2026-04-12", "status": "DELIVERED", "excludeDeliveryIds"?: ["10","11"] }`.
- Marks all `PENDING` (and optionally `AUTO_MARKED`) rows for that list+date not in the exclude set, in one transaction; appends an override per row; one audit entry with count.
- 200: `data: { updated: 42, skipped: 2 }`.

**5. POST `/extra-charges`** (Command)
- Body: `{ "dailySupplyId": "10", "amount": 20.00, "comment": "Extra milk" }`. `comment` mandatory & non-empty; `amount` non-zero.
- Resolves parent daily supply (tenant scoped). Rejects if parent `status===LEAVE` (OQ-3) or `CANCELLED`. Inserts charge, recomputes `finalAmount` atomically, audit log.
- 201: `data: { id, dailySupplyId, amount, comment, addedBy:{...}, createdAt }`.
- **Note**: keyed by `dailySupplyId` (the canonical FK), not the story's `(customerId, supplyListId, deliveryDate)` triple — the daily supply already encodes all three. See OQ-2.

**6. POST `/leaves`** (Command)
- Body: `{ "customerId": "10", "supplyListIds": ["10","11"], "startDate": "2026-04-15", "endDate": "2026-04-17", "reason"?: "Travel" }`.
- Resolves the customer's active subscription on each list (404 if none). Creates one `Leave` per subscription; transactionally pre-marks any existing `DailySupply` rows in range to `LEAVE` (amount→0, override appended, `leaveType=VENDOR_MARKED`/`CUSTOMER_REQUESTED` per actor).
- 201: `data: { created: 2, leaves:[ { id, customerId, supplyListId, startDate, endDate, leaveType } ], affectedDeliveries: 6 }`.

**7. GET `/leaves?status=today|upcoming&staffId=`** (Query)
- 200: `data: { today:[ { id, customerName, listName, date } ], upcoming:[ { id, customerName, listName, startDate, endDate, daysCount } ] }`. Staff scoped to assigned lists.

**8. DELETE `/leaves/:leaveId`** (Command)
- Cancels a future leave (hard delete, OQ-5). Only future-dated leaves deletable; reverts in-range future `DailySupply` rows from `LEAVE` back to `PENDING` if they have no other covering leave.
- 200: `data: { revertedDeliveries: 3 }`.

**9. GET `/deliveries/calendar?month=YYYY-MM&listId=&customerId=`** (Query, owner)
- 200: `data: { month, summary:{ totalDeliveries, totalLeaves, revenue }, days:{ "2026-04-01": { status:"completed"|"has_leaves"|"pending"|"has_conflicts", delivered, leaves, revenue } } }`. Day `status` precedence: `has_conflicts` > `pending` > `has_leaves` > `completed`.

**10. GET `/deliveries/date/:date`** (Query, owner)
- 200: `data: { date, summary:{...}, byList:[...], extraCharges:[...], leaves:[ { customerName, listName, markedBy } ] }`.

**11. POST `/deliveries/generate`** (Command, owner)
- Body: `{ "date"?: "YYYY-MM-DD" }` (defaults today). Manual trigger of the generation use case **scoped to the caller's vendor** (the cron runs it for all vendors internally — see §7). Idempotent: skips dates that already have rows.
- 202: `data: { generated: 180, skipped: 5, date }`.

### Error contract (all endpoints)
| Status | Code | When |
|--------|------|------|
| 400 | VALIDATION_ERROR | Zod failure (bad date, missing comment, zero amount) |
| 400 | BAD_REQUEST | Invalid state transition (e.g. mark CANCELLED) |
| 401 | UNAUTHORIZED | No/invalid token |
| 403 | FORBIDDEN | Staff missing grant / not assigned to list |
| 404 | NOT_FOUND | Wrong tenant, unknown delivery/leave/list (existence masked) |
| 422 | UNPROCESSABLE | Extra charge on a LEAVE/CANCELLED supply; leave on ended subscription |

---

## 6. Module Structure

`src/modules/delivery/` (mirrors the shipped `supply-list` layout):

```
delivery/
├── domain/
│   ├── daily-supply.entity.ts            # Aggregate root: state machine, amount calc, conflict, override emission
│   ├── daily-supply.types.ts             # Props, DailySupplyStatus, transition map
│   ├── daily-supply.errors.ts            # InvalidDeliveryTransitionError, ChargeOnLeaveError, etc.
│   ├── leave.entity.ts                   # Aggregate root: DateRange invariant
│   ├── leave.types.ts
│   ├── value-objects/
│   │   ├── service-date.value-object.ts
│   │   ├── delivery-status.value-object.ts
│   │   ├── actor-role.value-object.ts
│   │   ├── date-range.value-object.ts    # delivery-local copy
│   │   ├── quantity.value-object.ts      # delivery-local copy
│   │   └── rate-money.value-object.ts    # delivery-local copy
│   └── events/
│       ├── daily-supply-marked.domain-event.ts
│       ├── daily-supply-conflict-detected.domain-event.ts
│       ├── extra-charge-added.domain-event.ts
│       ├── daily-supply-cancelled.domain-event.ts
│       ├── leave-created.domain-event.ts
│       └── leave-cancelled.domain-event.ts
├── database/
│   ├── daily-supply.repository.port.ts
│   ├── daily-supply.repository.ts        # adapter (overrides, charges, focused updates, P2002→Conflict)
│   ├── daily-supply.mapper.ts            # toDomain/toPersistence/toResponse (whitelist)
│   ├── leave.repository.port.ts
│   ├── leave.repository.ts
│   ├── leave.mapper.ts
│   └── reporting.projection.ts           # read-side aggregates for today/calendar/day-detail (CQS query side, raw SQL/groupBy)
├── ports/
│   ├── supply-list-reader.port.ts        # read supply lists + subscriptions + staff assignment (into supply-list ctx)
│   └── customer-directory.port.ts        # read customer name/address/phone (into customer ctx)
├── adapters/
│   ├── supply-list-reader.adapter.ts     # Prisma over supply_lists / supply_list_customers / supply_list_staff
│   ├── customer-directory.adapter.ts
│   └── delivery-stats.adapter.ts         # implements supply-list's DeliveryStatsPort (REPLACES the zero stub)
├── generation/
│   ├── generate-daily-supplies.service.ts # the fan-out use case (per-vendor, idempotent)
│   └── delivery-generation.cron.ts        # node-cron registration (00:00 + 01:00 jobs)
├── commands/
│   ├── mark-delivery/mark-delivery.service.ts
│   ├── mark-bulk/mark-bulk.service.ts
│   ├── add-extra-charge/add-extra-charge.service.ts
│   ├── create-leave/create-leave.service.ts
│   └── cancel-leave/cancel-leave.service.ts
├── queries/
│   ├── get-today/get-today.service.ts
│   ├── get-list-deliveries/get-list-deliveries.service.ts
│   ├── get-leaves/get-leaves.service.ts
│   ├── get-calendar/get-calendar.service.ts
│   └── get-date-detail/get-date-detail.service.ts
├── delivery.controller.ts
├── delivery.routes.ts                    # composition root
├── delivery.types.ts                     # shared DTOs
├── delivery.validator.ts                 # Zod schemas
└── __tests__/
```

**Files modified outside the module**:
- `prisma/schema.prisma` — add models/enums/back-relations (§4).
- `prisma/seeds/index.ts` — permissions already seeded (`delivery:mark`, `leave:mark`, `charge:add`); add dev faker daily-supply rows.
- `src/app.ts` — mount `delivery.routes` + register cron on server boot (guarded `NODE_ENV !== 'test'`).
- `src/modules/supply-list/supply-list.routes.ts` — **swap** `new DeliveryStatsZeroStubAdapter()` → `new DeliveryStatsAdapter()` from the delivery module. (This is the one cross-module wiring; the supply-list module keeps depending only on its own `DeliveryStatsPort` interface — the concrete is chosen at the composition root.)

---

## 7. Service Layer Design (Commands vs Queries)

### Commands
- **MarkDeliveryService** — load aggregate (tenant+list scoped) → resolve `ActorRole` from `RoleContext` → permission (owner, or staff assigned + grant) → `entity.markDelivered(qty?, actor)` / `entity.markLeave(actor)` → repo persists row + appended override in tx → audit → publish events.
- **MarkBulkService** — fetch all `PENDING`(+`AUTO_MARKED`?) ids for list+date minus excludes → loop transitions in one tx → single audit row with count.
- **AddExtraChargeService** — load parent supply → guard `status ∉ {LEAVE, CANCELLED}` → `entity.addExtraCharge(amount, comment, actor)` (recomputes `finalAmount`) → persist charge + update finalAmount atomically → audit.
- **CreateLeaveService** — resolve subscriptions for `(customerId, supplyListIds)` → for each, `Leave.create(range)` + transactionally pre-mark in-range existing supplies to LEAVE → audit.
- **CancelLeaveService** — load future leave → hard-delete → revert in-range future supplies lacking other leave coverage → audit.
- **GenerateDailySuppliesService** (per vendor): for each active subscription whose `frequency`/schedule matches `date` and not ended and within start/end window → skip if a row exists (unique guard / pre-check) → resolve effective `quantity`/`rate` (subscription override ?? list default) → if an open leave covers the date, create row as `LEAVE` (amount 0) else `PENDING` → `insertMany`. Idempotent by `(supplyListCustomerId, serviceDate)` unique constraint (catch P2002 → skip).

### Queries (CQS read side — bypass domain, use `reporting.projection.ts`)
- **GetTodayService** / **GetListDeliveriesService** / **GetLeavesService** / **GetCalendarService** / **GetDateDetailService** — Prisma `groupBy`/aggregate + targeted joins; map straight to response DTOs; apply staff list-scoping and owner-only financial masking.

### Cron (§ Technical Spec of story)
- `node-cron` (add dependency) registered at server boot:
  - `0 0 * * *` → `generateDailySupplies(today)` for **all** vendors (paginated over active subscriptions; logs a generation summary with `correlationId`).
  - `0 1 * * *` → auto-mark sweep: per vendor with `autoMarkEnabled`, transition still-`PENDING` previous-day rows to `AUTO_MARKED` (story edge-case: backdating allowed until 06:00 — so the sweep targets the day-before-yesterday boundary; see OQ-4).
- Failures logged to `Logs/YYYY-MM-DD.txt` with `correlationId` (per memory: Error Logging). Manual trigger via endpoint #11 for testing.

### Key business rules
1. Effective quantity/rate = subscription override ?? supply-list default; captured onto the daily row at generation time (immutable snapshot for billing).
2. `finalAmount` always = `baseAmount + Σ charges`; recomputed on every charge mutation.
3. `LEAVE` ⟹ amount 0; charges blocked.
4. Conflict = customer override vs vendor override disagreement; owner re-mark resolves.
5. Staff see only assigned lists and no financial fields; owners see everything.
6. Generation never duplicates a `(subscription, date)` row.
7. Subscription ended / customer removed → future rows transition to `CANCELLED` (handled lazily at generation + on subscription-end event, OQ-6).

---

## 8. Validation Rules (Zod — `delivery.validator.ts`)

- **Params**: `vendorIdParamSchema`, `deliveryIdParamSchema`, `leaveIdParamSchema`, `listIdParamSchema` — numeric string → coerced; `dateParamSchema` — `YYYY-MM-DD` regex + valid calendar date.
- **markDeliverySchema** (strict): `{ status: z.enum(['DELIVERED','LEAVE']), quantity: z.number().nonnegative().optional() }`. Reject unknown keys (no client-supplied `markedBy*`).
- **markBulkSchema** (strict): `{ supplyListId: idString, date: dateString, status: z.literal('DELIVERED'), excludeDeliveryIds: z.array(idString).max(1000).optional() }`.
- **addExtraChargeSchema** (strict): `{ dailySupplyId: idString, amount: z.number().refine(n=>n!==0), comment: z.string().trim().min(1).max(500) }`.
- **createLeaveSchema** (strict): `{ customerId: idString, supplyListIds: z.array(idString).min(1), startDate: dateString, endDate: dateString, reason: z.string().max(500).optional() }` + `.refine(endDate>=startDate)`.
- **generateSchema** (strict): `{ date: dateString.optional() }`.
- **Query schemas** (passthrough for query-builder compatibility): `todayQuerySchema` (`date?`, `listId?`, `staffId?`), `listDeliveriesQuerySchema` (`date?`, `filter`, `search`, pagination), `leavesQuerySchema` (`status?: enum(['today','upcoming'])`, `staffId?`), `calendarQuerySchema` (`month: YYYY-MM`, `listId?`, `customerId?`).
- Enums via `z.nativeEnum(DailySupplyStatus)` where a full status is accepted (none on input today, but used in filters).
- Middleware order per route: `authenticateToken → writeLimiter(commands) → validate(params) → validate(body|query) → identifyUserRole('vendorId') → [requireOwnerRole | in-handler PermissionService grant check] → controller`.

---

## 9. Swagger / OpenAPI Tags

Tag: **`Deliveries`** (endpoints 1–4, 9–11) and **`Leaves`** (6–8), **`Extra Charges`** (5).

| Endpoint | Summary |
|----------|---------|
| GET `/deliveries/today` | List today's deliveries summarized by supply list with conflicts |
| GET `/supply-lists/:listId/deliveries` | List per-customer deliveries for a list on a date |
| PATCH `/deliveries/:deliveryId/mark` | Mark a delivery as delivered or leave |
| POST `/deliveries/mark-bulk` | Bulk-mark all pending deliveries in a list for a date |
| POST `/extra-charges` | Add an extra charge to a daily supply |
| POST `/leaves` | Record a planned leave across one or more lists |
| GET `/leaves` | List today's and upcoming leaves |
| DELETE `/leaves/:leaveId` | Cancel a future leave |
| GET `/deliveries/calendar` | Month calendar of delivery status by day (owner) |
| GET `/deliveries/date/:date` | Day detail breakdown by list, charges, leaves (owner) |
| POST `/deliveries/generate` | Manually generate daily supplies for a date (owner) |

All annotated with the `{ success, data, meta? }` envelope, `bearerAuth`, and the error schema with `correlationId`.

---

## 10. Open Questions

> Surfaced with a recommendation + trade-off (per memory: always surface OQs even in auto mode). Pipeline proceeds on the recommended option unless overridden.

**OQ-1 — Customer self-service marking source.** The story's conflict feature ("customer marked leave via their app") requires a customer-facing write path that does not exist yet (no customer app/auth in scope). **Recommendation**: ship the conflict *detection + resolution* machinery now (override actorRole = `CUSTOMER` is supported in schema), but seed customer-origin overrides only via the generation path (open leaves with `leaveType=CUSTOMER_REQUESTED`) and dev seeds; defer the live customer endpoint to the customer-app story. **Trade-off**: conflict UI is testable but real customer-vs-staff conflicts only arise once the customer app lands — acceptable, keeps US-006 self-contained.

**OQ-2 — Endpoint shape vs the story doc.** Story uses bare `/deliveries/:id/mark` and a `(customerId, supplyListId, deliveryDate)` key for extra charges. **Recommendation**: use vendor-scoped paths and key extra charges by `dailySupplyId`. **Trade-off**: diverges from the doc's literal paths, but matches every shipped module's multi-tenant convention and the canonical FK; the frontend (not yet started for US-006) will reconcile against the real contract as it did for US-005.

**OQ-3 — Extra charge on a LEAVE day.** Should a charge be allowed when status is `LEAVE`? **Recommendation**: block it (422) — a leave means no supply, so an extra charge is semantically inconsistent; vendors should mark `DELIVERED` first. **Trade-off**: slightly less flexible; if vendors need "charge despite leave" we relax later. (Negative amounts = discounts are still allowed on delivered days.)

**OQ-4 — Timezone & the "backdate until 6 AM" edge case.** "Today" and the auto-mark sweep boundary depend on vendor timezone, which is not modeled on `Vendor`. **Recommendation**: assume a single app timezone `Asia/Kolkata` (config env `APP_TIMEZONE`, default IST) for all date bucketing in US-006; auto-mark sweep at 01:00 marks rows older than the current service date that are still `PENDING`, honoring the 6 AM grace by running the *finalizing* sweep at 06:05 instead of 01:00. **Trade-off**: per-vendor timezones deferred to US-011 (Vendor Settings); fine for a single-region launch.

**OQ-5 — Leave cancellation: soft vs hard delete.** Canonical `leaves` has no `deleted_at`. **Recommendation**: hard-delete future leaves on cancel (story edge-case 8 explicitly says "delete future leave records"); past/partly-elapsed leaves are not cancelable. **Trade-off**: loses cancellation audit on the leave row itself — mitigated because the revert writes `SupplyOverride` rows (audited) and an AuditLog entry.

**OQ-6 — Reaction to subscription end / customer removal (cross-module).** When a subscription ends (US-005 emits `SubscriptionEnded`) future daily rows should become `CANCELLED`. There is no event bus wired yet. **Recommendation**: handle lazily — the generation job stops creating rows past `endDate`, and a daily cleanup sweep cancels orphaned future `PENDING` rows whose subscription is ended; defer a real event-handler subscription to when an event bus exists (US-007 audit or a dedicated infra story). **Trade-off**: a brief window where a just-ended subscription still shows future `PENDING` rows until the next sweep — acceptable and self-healing.

**OQ-7 — `node-cron` in-process vs external scheduler.** **Recommendation**: in-process `node-cron`, guarded to a single instance via an env flag `ENABLE_CRON=true` (so multi-instance deploys don't double-run), plus the manual `/generate` endpoint for tests/ops. **Trade-off**: not horizontally safe by default; a managed scheduler (pg_cron / external) is the production-hardening follow-up. Flagging clearly so QA tests the manual path and the cron is off in CI.

**OQ-8 — Real-time progress (WebSocket).** Story mentions WebSocket/polling for live progress. **Recommendation**: out of scope for the backend US-006 — return the full updated delivery object on every mark (enables optimistic UI + refetch); WebSocket deferred. **Trade-off**: frontend polls/refetches instead of receiving pushes; lower complexity, no socket infra needed now.

---

## Skills referenced for Dev/Review/QA
`ddd-module-design` · `domain-modeling` · `api-contract-design` · `prisma-schema-design` · `validation-schemas` · `repository-implementation` · `service-implementation` · `error-handling` · `testing-strategy`.

## Performance & Security
- **Indexes**: composite `(supplyListId, serviceDate, status)`, `(vendorId, serviceDate)`, `(serviceDate, status)` cover the today/list/calendar reads; reporting uses `groupBy` not row scans.
- **Generation** paginates active subscriptions; bulk insert via `createMany`; idempotent on the unique constraint.
- **Multi-tenant**: every read/write scoped by `vendorId` from `RoleContext`; wrong tenant masked as 404; staff scoped to assigned lists; financial fields owner-only.
- **Audit**: every mutation writes `AuditLog` + a `SupplyOverride`/charge row carrying `actorRole`.
