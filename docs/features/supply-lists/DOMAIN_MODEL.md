# Domain Model: Supply Lists Management (US-005)

## Complexity Assessment
- **Level**: **Complex**
- **Justification**:
  - Two aggregates (`SupplyList` and `SupplyListCustomer` / subscription) with distinct lifecycles and invariants.
  - Real cross-module integration: this module **replaces the three fail-closed staff-module stubs** (`ListAssignmentPort`, `ListAssignmentWritePort`, and the `assign-list`/`unassign-list` 503 gates) created in US-002/US-004. That is an Anti-Corruption Layer obligation, not plain CRUD.
  - Non-trivial invariants: "one primary staff per list", "amount = effective quantity × effective rate", "soft-delete vs archive when active subscriptions exist", multi-tenant isolation, custom-override semantics.
  - Domain events consumed by Audit and (later) Delivery Tracking / Dashboard.
- **Architecture depth**: Full DDD — Aggregates, Value Objects, Domain Events, Ports & Adapters, vertical-slice commands/queries — mirroring the existing `staff` module layout.

---

## Ubiquitous Language

| Term | Definition |
|------|-----------|
| **Supply List** | A named group of customers receiving one supply type at one time slot (e.g. "Morning Milk"). The core organizational unit. Aggregate root. |
| **Supply Type** | Free-text category of goods: milk, bread, newspaper, water, tiffin, other. |
| **Unit** | Unit of measurement: ltr, kg, pieces, grams, numbers, packets. |
| **Default Quantity / Rate** | List-level defaults applied to a subscription unless the customer has an override. |
| **Frequency** | DAILY / WEEKLY / MONTHLY cadence of the list. WEEKLY/MONTHLY carry schedule rows. |
| **Subscription** (`SupplyListCustomer`) | A customer's enrollment in one supply list, with optional custom quantity/rate and a start/end date. Aggregate root. |
| **Custom Override** | A per-subscription `customQuantity` / `customRatePerUnit` that supersedes the list default. |
| **Effective Quantity / Rate** | The value actually billed: custom override if present, else list default. |
| **Amount** | `effectiveQuantity × effectiveRate` for a subscription. Computed, never stored. |
| **Staff Assignment** (`SupplyListStaff`) | A mapping of a staff `VendorUser` membership to a list, optionally `isPrimary`. Owned by the SupplyList aggregate. |
| **Primary Staff** | The one staff member primarily responsible for a list. At most one per list. |
| **Archive** | Soft-deactivation of a list that still has active subscriptions (`isActive=false`, `deletedAt` set). |

---

## Context Map: Supply Lists

### Owned Concepts
- **SupplyList** — list definition, its staff assignments, and its schedule rules.
- **SupplyListStaff** — assignment of a staff membership to a list (owned child of SupplyList aggregate).
- **SupplyListSchedule** — WEEKLY/MONTHLY day rules (owned child of SupplyList aggregate).
- **SupplyListCustomer (Subscription)** — a customer's enrollment in a list with override pricing.

### Boundaries
- This module **OWNS**: `supply_lists`, `supply_list_staff`, `supply_list_schedule`, `supply_list_customers`.
- This module **DOES NOT OWN**:
  - `vendors` (read-only reference by `vendorId` — from Vendor context / JWT).
  - `customers` / `vendor_customers` (referenced by ID; **US-008 owns Customer Management**). For US-005 we read existing customers but do not create them — see Open Question OQ-1.
  - `vendor_users` (staff memberships — owned by the **staff** bounded context). We reference staff by `vendorUserId` and validate them via a **StaffDirectoryPort** (ACL), never by importing staff internals.
  - `daily_supplies` (delivery ledger — **US-006**). `todayStats` / `monthStats` are sourced via a **DeliveryStatsPort** that is stubbed (zeros) until US-006.
- Module internals are PRIVATE — no cross-module imports except the public ports below.

### Relationships
| Related Context | Relationship | Integration Pattern | Communication | Shared Data |
|----------------|-------------|---------------------|---------------|-------------|
| Auth | Upstream | Conformist | Direct (JWT claims) | `userId`, `vendorId` |
| Staff (RBAC) | Upstream (gates) + Downstream (provides assignment data) | **Anti-Corruption Layer** | Implements staff's `ListAssignmentPort` / `ListAssignmentWritePort`; consumes a `StaffDirectoryPort` | `vendorUserId`, list assignments |
| Customer (US-008) | Downstream of US-008 | Conformist | `CustomerDirectoryPort` (read) | `customerId`, `vendorId` |
| Delivery (US-006) | Downstream | Domain events + `DeliveryStatsPort` (read, stubbed) | `supplyListId`, stats | delivery counts |
| Audit | Downstream | Direct (`AuditLogger`) | mutation records | actor, action |

### Cross-Module Communication Strategy
- **This module satisfies the staff-module stubs.** The staff composition root currently wires `ListAssignmentStubAdapter` (read) and `ListAssignmentWriteStubAdapter` (write, 503). US-005 ships **real adapters** implementing `ListAssignmentPort` and `ListAssignmentWritePort` backed by `supply_list_staff`, and the **staff routes composition root is rewired** to use them (the only edit to staff files).
- **StaffDirectoryPort (ACL, this module's own port)** — used by our services to validate a `vendorUserId` belongs to the vendor and is ACTIVE before assigning. Backed by an adapter that reads `vendor_users` (Prisma) without importing staff domain code.
- **Domain events** emitted by our aggregates are consumed by Audit now and Delivery/Dashboard later. We never call another module's command directly.

---

## Aggregates

### 1. SupplyList Aggregate
- **Root Entity**: `SupplyListEntity` (aggregate root)
- **Nested Entities / owned children**:
  - `SupplyListStaff` assignments (collection) — owned; mutated only through the root.
  - `SupplyListSchedule` rules (collection) — owned; mutated only through the root.
- **Value Objects**: `SupplyUnit`, `SupplyFrequency` (+ schedule rules), `Money`-style rate via `RateMoney`, `Quantity`, `TimeOfDay` (startTime).
- **Invariants** (enforced in `validate()`):
  1. `name` non-empty, ≤ 100 chars.
  2. `unit` is one of the allowed units.
  3. `defaultQuantity` ≥ 0 (nullable allowed; if a subscription has no override the list default must exist — see subscription invariant 3).
  4. `ratePerUnit` ≥ 0 (zero allowed — free item edge case #9).
  5. `frequency` is a valid enum; if WEEKLY, at least one `dayOfWeek` schedule row; if MONTHLY, at least one `dayOfMonth`.
  6. **At most one** assignment with `isPrimary = true`.
  7. `primaryStaffId`, if set, must be among `staffIds`.
  8. All assigned `vendorUserId`s are distinct (DB also enforces `UNIQUE(supply_list_id, vendor_user_id)`).
- **Lifecycle**: `Active (isActive=true)` → `Archived (isActive=false, deletedAt set)`. Archive is terminal for listing purposes; no un-archive in US-005 (OQ-3).
- **Domain Events Emitted**:
  - `SupplyListCreatedEvent`
  - `SupplyListUpdatedEvent`
  - `SupplyListArchivedEvent`
  - `StaffAssignedToListEvent`
  - `StaffUnassignedFromListEvent`
  - `PrimaryStaffChangedEvent`
- **Commands**: CreateSupplyList, UpdateSupplyList, ArchiveSupplyList, AssignStaff, UnassignStaff.
- **Queries**: ListSupplyLists, GetSupplyList.

### 2. SupplyListCustomer (Subscription) Aggregate
- **Root Entity**: `SubscriptionEntity` (aggregate root)
- **Nested Entities**: None.
- **Value Objects**: `Quantity` (custom), `RateMoney` (custom), `DateRange` (start/end), `SubscriptionStatus`.
- **Invariants** (enforced in `validate()`):
  1. `customQuantity` ≥ 0 if present; `customRatePerUnit` ≥ 0 if present.
  2. If `endDate` present, `endDate ≥ startDate`.
  3. **Effective values resolvable**: at persistence time the owning list must have a non-null `defaultQuantity`/`ratePerUnit` OR the subscription must supply the override (a subscription with neither a custom value nor a list default for a field is invalid).
  4. A subscription references exactly one `supplyListId` and one `customerId`; both belong to the same `vendorId` (denormalized `vendorId` must equal the list's vendor).
  5. Status lifecycle: `ACTIVE → PAUSED → ACTIVE` and `ACTIVE|PAUSED → ENDED`. `ENDED` is terminal. (Modeled via `is_active` + `end_date`; see schema mapping below.)
- **Lifecycle**: `ACTIVE` ⇄ `PAUSED` → `ENDED` (sets `endDate = today`, `isActive=false`, `deletedAt` left null to preserve history) → soft-delete only if hard removal requested by admin (not in US-005).
- **Domain Events Emitted**:
  - `CustomerSubscribedEvent`
  - `SubscriptionUpdatedEvent`
  - `SubscriptionEndedEvent`
- **Commands**: AddCustomers (bulk), UpdateSubscription, EndSubscription.
- **Queries**: ListListCustomers, ListAvailableCustomers.

> **Aggregate boundary note**: `customerCount`, `todayStats`, `monthStats` on the SupplyList response are **read projections**, not part of the aggregate state. They are assembled in the query layer (counts from `supply_list_customers`; stats from `DeliveryStatsPort`). Cross-aggregate references are by ID only.

---

## Entities

### Entity: SupplyList (root)
- **Identity**: BigInt autoincrement — serialized as string.
- **Fields**:
  | Field | Type | Required | Default | Constraint |
  |-------|------|----------|---------|-----------|
  | id | BigInt | Yes | auto | PK |
  | vendorId | BigInt | Yes | - | tenant key, indexed |
  | name | String | Yes | - | ≤ 100 |
  | supplyType | String? | No | null | ≤ 50 |
  | unit | SupplyUnit | Yes | - | enum-like VO |
  | defaultQuantity | Decimal? | No | null | ≥ 0 |
  | ratePerUnit | Decimal? | No | null | ≥ 0 |
  | startTime | TimeOfDay? | No | null | HH:mm |
  | frequency | SupplyFrequency | Yes | DAILY | enum |
  | isActive | Boolean | Yes | true | - |
  | staff | SupplyListStaff[] | Yes | [] | ≤1 primary |
  | schedule | SupplyListSchedule[] | Yes | [] | per-frequency rule |
  | createdAt / updatedAt | DateTime | Yes | now | - |
  | deletedAt | DateTime? | No | null | soft delete / archive |
- **Behavior**:
  - `static create(props)` — factory; emits `SupplyListCreatedEvent`.
  - `static reconstitute(data)` — from persistence.
  - `updateDetails(patch, correlationId)` — name/type/unit/qty/rate/time/frequency+schedule; emits `SupplyListUpdatedEvent`. Editing default price does NOT touch subscription overrides (AC + edge #3).
  - `archive(correlationId)` — `isActive=false`, `deletedAt=now`; emits `SupplyListArchivedEvent`.
  - `assignStaff(vendorUserId, isPrimary, assignedByUserId, correlationId)` — adds assignment; if `isPrimary`, demotes others; emits `StaffAssignedToListEvent` (+ `PrimaryStaffChangedEvent` if primary changed). Idempotent re-assign → ConflictError surfaced at DB unique.
  - `unassignStaff(vendorUserId, correlationId)` — removes; if it was primary, leaves no primary (story: "or leave none"); emits `StaffUnassignedFromListEvent`.
  - `setPrimary(vendorUserId, correlationId)` — promote one, demote rest; emits `PrimaryStaffChangedEvent`.
- **Invariants**: as listed in Aggregate section.

### Entity: Subscription (SupplyListCustomer, root)
- **Identity**: BigInt autoincrement.
- **Fields**:
  | Field | Type | Required | Default | Constraint |
  |-------|------|----------|---------|-----------|
  | id | BigInt | Yes | auto | PK |
  | vendorId | BigInt | Yes | - | denorm tenant key |
  | supplyListId | BigInt | Yes | - | FK by ID |
  | customerId | BigInt | Yes | - | FK by ID |
  | customQuantity | Decimal? | No | null | ≥ 0 |
  | customRatePerUnit | Decimal? | No | null | ≥ 0 |
  | startDate | Date? | No | today | - |
  | endDate | Date? | No | null | ≥ startDate |
  | isActive | Boolean | Yes | true | - |
  | createdAt / updatedAt / deletedAt | DateTime | - | - | soft delete |
- **Behavior**:
  - `static create(props)` — emits `CustomerSubscribedEvent`.
  - `updatePricing(quantity?, rate?, correlationId)` — set/clear overrides; emits `SubscriptionUpdatedEvent`.
  - `pause(correlationId)` / `resume(correlationId)` — toggle `isActive` for PAUSED semantics.
  - `end(correlationId)` — `endDate=today`, `isActive=false`; emits `SubscriptionEndedEvent` (history preserved, NOT hard-deleted).
  - `effectiveQuantity(listDefault)` / `effectiveRate(listDefault)` / `amount(listDefaults)` — domain calculation helpers (the `calculateCustomerAmount` business rule lives here).

---

## Value Objects

### Value Object: SupplyUnit
- **Properties**: `value: string`
- **Validation**: must be one of `ltr | kg | pieces | grams | numbers | packets` (case-insensitive in; normalized to lowercase). Uses Guard `isOneOf`.
- **Equality**: structural.

### Value Object: SupplyFrequency (+ ScheduleRule)
- **Properties**: `frequency: 'DAILY'|'WEEKLY'|'MONTHLY'`, `rules: { dayOfWeek?: 1-7; dayOfMonth?: 1-31 }[]`
- **Validation**: DAILY ⇒ no rules; WEEKLY ⇒ ≥1 `dayOfWeek` in 1..7; MONTHLY ⇒ ≥1 `dayOfMonth` in 1..31. `assertUnreachable` on the discriminant.
- **Equality**: structural.

### Value Object: Quantity
- **Properties**: `value: number` (decimal, 3 dp)
- **Validation**: `≥ 0`, finite. Guard `isNonNegative`.

### Value Object: RateMoney
- **Properties**: `amount: number` (decimal, 2 dp), implicit currency INR.
- **Validation**: `≥ 0` (zero allowed — free item). Guard `isNonNegative`.

### Value Object: TimeOfDay
- **Properties**: `hours: 0-23`, `minutes: 0-59`
- **Validation**: parses `HH:mm`; rejects out-of-range. `unpack()` → `"HH:mm"`.

### Value Object: DateRange
- **Properties**: `startDate: Date`, `endDate: Date | null`
- **Validation**: if `endDate` not null, `endDate ≥ startDate`. Past and future starts allowed (edge #7/#8).

### Value Object: SubscriptionStatus
- **Properties**: `value: 'ACTIVE'|'PAUSED'|'ENDED'`
- **Validation**: transition guard (`assertTransition`) mirroring `MembershipStatus` VO in staff module.

---

## Domain Events

| Event | Triggered When | Payload | Consumers |
|-------|----------------|---------|-----------|
| `SupplyListCreatedEvent` | List created | `{ aggregateId, vendorId, name, createdByUserId }` | Audit |
| `SupplyListUpdatedEvent` | List details changed | `{ aggregateId, vendorId, changedFields }` | Audit |
| `SupplyListArchivedEvent` | List archived | `{ aggregateId, vendorId }` | Audit, (Delivery: stop generating) |
| `StaffAssignedToListEvent` | Staff assigned | `{ aggregateId, vendorId, vendorUserId, isPrimary }` | Audit, Staff (reflected in staff screens) |
| `StaffUnassignedFromListEvent` | Staff unassigned | `{ aggregateId, vendorId, vendorUserId }` | Audit, Staff |
| `PrimaryStaffChangedEvent` | Primary staff changed | `{ aggregateId, vendorId, oldPrimaryId, newPrimaryId }` | Audit |
| `CustomerSubscribedEvent` | Customer added to list | `{ aggregateId, vendorId, supplyListId, customerId }` | Audit, (Delivery, Billing later) |
| `SubscriptionUpdatedEvent` | Quantity/rate/status changed | `{ aggregateId, vendorId, changedFields }` | Audit |
| `SubscriptionEndedEvent` | Subscription ended | `{ aggregateId, vendorId, supplyListId, customerId, endDate }` | Audit, (Billing pro-rata later) |

### Cross-Module Event Flow
- `StaffRemovedEvent` (emitted by **staff** module on staff removal) — staff's `RemoveStaffService` already calls `listAssignmentPort.unassignAll(membershipId)`. With US-005's real adapter wired, that call now **really** deletes `supply_list_staff` rows (edge #5: "staff removed → unassign from all lists automatically"). No new handler in US-005 — we satisfy the existing contract.
- Events flow: Command → Aggregate emits Event → published after commit → Audit handler. Never Command → Command.

---

## Use Cases (CQS)

### Commands (State-Changing)
| UC | Method | Permission/Role | Notes |
|----|--------|-----------------|-------|
| UC-C1 CreateSupplyList | `CreateSupplyListService.execute` | Owner only | Validates staff via StaffDirectoryPort; tx: insert list + staff + schedule atomically; emits created event. |
| UC-C2 UpdateSupplyList | `UpdateSupplyListService.execute` | Owner only | Focused update; price edit doesn't touch overrides. |
| UC-C3 ArchiveSupplyList | `ArchiveSupplyListService.execute` | Owner only | If active subscriptions exist → archive (never hard delete); else still archive (always soft). |
| UC-C4 AssignStaff | `AssignStaffService.execute` | Owner only | StaffDirectoryPort validates ACTIVE staff (edge #4 disabled → 422); primary demotion. |
| UC-C5 UnassignStaff | `UnassignStaffService.execute` | Owner only | Promotes none if primary removed. |
| UC-C6 AddCustomers (bulk) | `AddCustomersService.execute` | Owner only | Validates customers belong to vendor (CustomerDirectoryPort); dedupe vs existing active subscription (409); tx per batch ≤100. |
| UC-C7 UpdateSubscription | `UpdateSubscriptionService.execute` | Owner only | quantity/rate/status. |
| UC-C8 EndSubscription | `EndSubscriptionService.execute` | Owner only | status=ENDED, end_date=today, preserve history. |

### Queries (Data Retrieval)
| UC | Method | Permission/Role | Notes |
|----|--------|-----------------|-------|
| UC-Q1 ListSupplyLists | `ListSupplyListsService.execute` | Owner sees all; Staff sees only assigned (`staffId` filter via ListAssignmentPort) | Includes `assignedStaff`, `customerCount`, `todayStats`. |
| UC-Q2 GetSupplyList | `GetSupplyListService.execute` | Owner OR assigned staff (PermissionService.canViewSupplyList) | Includes `monthStats`, `todayStats`. |
| UC-Q3 ListListCustomers | `ListListCustomersService.execute` | Owner OR assigned staff | Subscriptions + computed amount + `otherLists` + custom flags; paginated 50/page. |
| UC-Q4 ListAvailableCustomers | `ListAvailableCustomersService.execute` | Owner only | Vendor customers NOT already actively subscribed to this list. |

---

## Mapper Design (`supply-list.mapper.ts`, `subscription.mapper.ts`)

### SupplyList mapper
- **toPersistence(entity)**: entity props → `supply_lists` row + nested `supply_list_staff` / `supply_list_schedule` create/update payloads. Decimals as Prisma `Decimal`, `startTime` as `"HH:mm"` string column / TIME. `unit`/`frequency` unpacked from VOs.
- **toDomain(record)**: row + relations → `SupplyListEntity.reconstitute()` building VOs (`SupplyUnit`, `SupplyFrequency` from schedule rows, `TimeOfDay`).
- **toResponse(entity, projections)**: **whitelist** → `{ id, name, supplyType, unit, defaultQuantity, defaultRatePerUnit, startTime, frequency, status, assignedStaff[], customerCount, todayStats, monthStats? }`. `status` derived: `isActive ? 'active' : 'archived'`. `deletedAt` NEVER returned. BigInt → string.

### Subscription mapper
- **toPersistence(entity)**: → `supply_list_customers` row (`custom_quantity`, `custom_rate_per_unit`, `start_date`, `end_date`, `is_active`, denorm `vendor_id`).
- **toDomain(record)**: → `SubscriptionEntity.reconstitute()`.
- **toResponse(entity, listDefaults, otherLists)**: whitelist → `{ subscriptionId, customerId, customerName, phoneNumber?, address?, quantity, ratePerUnit, amount, isCustomRate, isCustomQuantity, startDate, status, otherLists[] }`. `amount` computed via domain helper. `otherLists` capped to "and X more" beyond 5 (edge #6) — actually the response returns the full array and the FE truncates; the query caps to first 5 names + count to bound payload (OQ-4).

---

## Anti-Corruption Layer

### Integration 1: Staff context (we IMPLEMENT their ports) — primary ACL obligation
- **Their model**: staff identified by `vendorUserId` (their `VendorMembership` aggregate id).
- **Our model**: `supply_list_staff.vendor_user_id`.
- **Ports implemented (defined in staff module)**:
  - `ListAssignmentPort` (read) → `SupplyListAssignmentReadAdapter` reads `supply_list_staff`.
  - `ListAssignmentWritePort` (write) → `SupplyListAssignmentWriteAdapter` writes `supply_list_staff` (assign/unassign/setPrimary).
- **Composition**: the **staff** routes composition root swaps the two stub adapters for these real adapters. This is the ONLY edit to staff files. The staff `assign-list` / `unassign-list` endpoints stop returning 503 and start performing real writes (US-004 OQ deferral resolved here).
- **Error translation**: our adapter throws domain errors (`NotFoundError`, `ConflictError`) that the staff services already handle; never leak Prisma errors.

### Integration 2: StaffDirectoryPort (our OWN port — read)
- **Purpose**: validate a `vendorUserId` is an ACTIVE member of the vendor before assigning to a list (edge #4).
- **Port**: `src/modules/supply-list/ports/staff-directory.port.ts` — `findActiveMembership(vendorId, vendorUserId): Promise<{ id, status, displayName, phone } | null>`.
- **Adapter**: reads `vendor_users` + `users` via Prisma. No import of staff domain code.

### Integration 3: CustomerDirectoryPort (our OWN port — read)
- **Purpose**: validate `customerId`s belong to the vendor and fetch name/phone/address for responses; list available customers.
- **Port**: `findVendorCustomers(...)`, `assertCustomersBelongToVendor(...)`.
- **Adapter (US-005)**: reads `customers` + `vendor_customers` via Prisma directly (US-008 not built). When US-008 ships, swap to its facade — see OQ-1.

### Integration 4: DeliveryStatsPort (our OWN port — read, STUBBED)
- **Purpose**: supply `todayStats` / `monthStats`.
- **Port**: `getTodayStats(listId, date)`, `getMonthStats(listId, month)`.
- **Adapter (US-005)**: `DeliveryStatsZeroStubAdapter` returns zeroed counts (delivered/onLeave/pending = 0). Real adapter ships in US-006 reading `daily_supplies`. The stub returns valid shapes so the contract is stable for the FE (OQ-2).

### Mapper interface
```typescript
export interface Mapper<DomainEntity, DbRecord, Response> {
  toPersistence(entity: DomainEntity): DbRecord;
  toDomain(record: DbRecord): DomainEntity;
  toResponse(entity: DomainEntity, ...projections): Response;
}
```

---

## Module Structure (Complex — vertical slicing, mirrors `staff`)

```
src/modules/supply-list/
├── domain/
│   ├── supply-list.entity.ts
│   ├── supply-list.types.ts
│   ├── subscription.entity.ts
│   ├── subscription.types.ts
│   ├── supply-list.errors.ts
│   ├── value-objects/
│   │   ├── supply-unit.value-object.ts
│   │   ├── supply-frequency.value-object.ts
│   │   ├── quantity.value-object.ts
│   │   ├── rate-money.value-object.ts
│   │   ├── time-of-day.value-object.ts
│   │   ├── date-range.value-object.ts
│   │   └── subscription-status.value-object.ts
│   └── events/
│       ├── supply-list-created.domain-event.ts
│       ├── supply-list-updated.domain-event.ts
│       ├── supply-list-archived.domain-event.ts
│       ├── staff-assigned-to-list.domain-event.ts
│       ├── staff-unassigned-from-list.domain-event.ts
│       ├── primary-staff-changed.domain-event.ts
│       ├── customer-subscribed.domain-event.ts
│       ├── subscription-updated.domain-event.ts
│       └── subscription-ended.domain-event.ts
├── commands/
│   ├── create-supply-list/        (service + request.dto)
│   ├── update-supply-list/
│   ├── archive-supply-list/
│   ├── assign-staff/
│   ├── unassign-staff/
│   ├── add-customers/
│   ├── update-subscription/
│   └── end-subscription/
├── queries/
│   ├── list-supply-lists/
│   ├── get-supply-list/
│   ├── list-list-customers/
│   └── list-available-customers/
├── database/
│   ├── supply-list.repository.port.ts
│   ├── supply-list.repository.ts
│   ├── subscription.repository.port.ts
│   ├── subscription.repository.ts
│   ├── supply-list.mapper.ts
│   └── subscription.mapper.ts
├── ports/
│   ├── staff-directory.port.ts
│   ├── customer-directory.port.ts
│   └── delivery-stats.port.ts
├── adapters/
│   ├── staff-directory.adapter.ts
│   ├── customer-directory.adapter.ts
│   ├── delivery-stats-zero-stub.adapter.ts
│   ├── supply-list-assignment-read.adapter.ts     # implements staff ListAssignmentPort
│   └── supply-list-assignment-write.adapter.ts    # implements staff ListAssignmentWritePort
├── supply-list.controller.ts
├── supply-list.routes.ts
├── supply-list.types.ts
├── supply-list.validator.ts
└── __tests__/
```
</content>
</invoke>
