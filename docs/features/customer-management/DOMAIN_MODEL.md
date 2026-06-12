# Domain Model: Customer Management (US-008)

## Complexity Assessment

- **Level**: Complex
- **Justification**: Two domain entities with business rules (CustomerEntity with lifecycle + invariants, PaymentEntity immutable after creation), cross-module dependency for balance computation (DailySupply data), multi-tenant RBAC (owner vs staff), financial field-level gates, derived billing concepts (balance, utilization, paymentStatus)
- **Architecture depth**: Full DDD — domain entities with behavior, value objects, repository ports, command/query separation, mapper

---

## Ubiquitous Language

| Term | Definition |
|------|-----------|
| Customer | A person who subscribes to one or more of the vendor's supply lists |
| Subscription | An active enrollment of a customer in a supply list (`SupplyListCustomer` row with `isActive = true`) |
| Balance | Running total owed by the customer = Σ(delivered DailySupply amounts + extra charges) - Σ(payments) |
| Credit Limit | Maximum balance the vendor is willing to carry for this customer; 0 = no credit allowed |
| Credit Utilization | `(balance / creditLimit) × 100`; 0 when creditLimit = 0 |
| Payment Status | Derived: PAID (balance ≤ 0), PENDING (0 < balance ≤ creditLimit), OVERDUE (balance > creditLimit) |
| Monthly Bill | Aggregated deliveries + extra charges for a calendar month, plus previous due (balance at month start) |
| Payment Score | 0–100 score reflecting payment reliability; defaults 100 on creation; manually adjustable |
| Deactivate | Soft-delete: status → INACTIVE, deletedAt set, all active subscriptions ended |
| Vendor Customer | Join-table record linking a Customer to a Vendor (multi-vendor capable; currently one vendor per customer) |

---

## Context Map

### Owned Concepts
- `Customer`: profile, phone, address, credit limit, payment score, status lifecycle
- `Payment`: immutable payment record; amount, date, method, reference
- `Subscription` (write side): create/end `SupplyListCustomer` rows — owned by supply-list aggregate but mutated here as side-effects
- Balance calculation: pure derived value computed from delivery + payment data

### Boundaries
- This module **OWNS**: Customer CRUD, Payment recording, credit management, billing aggregation
- This module **DOES NOT OWN**: `DailySupply` rows (delivery module owns these), `SupplyList` definitions (supply-list module owns them), authentication/JWT (auth module)
- Module internals are **PRIVATE** — no direct imports from/to delivery or supply-list modules (use ports)

### Relationships

| Related Context | Relationship | Integration Pattern | Communication | Shared Data |
|----------------|-------------|-------------------|---------------|-------------|
| Auth | Upstream | Conformist | Direct (JWT roleContext) | userId, vendorId |
| Delivery (US-006) | Upstream (read-only) | ACL via Port | `IDeliveryBillingPort` (Prisma adapter) | DailySupply, ExtraCharge amounts |
| Supply Lists (US-005) | Peer | Open Host | Direct Prisma on `SupplyListCustomer` (write side only) | supplyListId, customerId |
| Staff (US-003/004) | Upstream | Conformist | `roleContext.staffId`, `assignedLists` | staffId, assignedListIds |

### Cross-Module Communication Strategy
- **Synchronous read from delivery**: `DeliveryBillingAdapter` queries `daily_supplies` + `supply_extra_charges` tables directly via Prisma (no delivery module code imported). Port interface ensures the customer domain never depends on delivery infrastructure.
- **Subscription mutation**: Customer module writes directly to `supply_list_customers` table for create/end operations. The supply-list module does not expose a port for this; direct table access is acceptable for the current single-BC boundary.

---

## Aggregates

### CustomerAggregate
- **Root Entity**: `CustomerEntity`
- **Nested Entities**: None (Payment is its own aggregate)
- **Value Objects**: `CustomerPhoneVO`, `CreditLimitVO`, `PaymentScoreVO`, `CustomerNameVO`
- **Invariants** (enforced in `validate()`):
  1. `name` must be 1–100 characters (trimmed)
  2. `phone` must be parseable to a valid phone number
  3. `creditLimit >= 0` and `<= 9999999.99`
  4. `paymentScore` in `[0, 100]`
  5. Once INACTIVE, cannot be deactivated again (422)
- **Lifecycle**: `ACTIVE → INACTIVE` (deactivate); `INACTIVE → ACTIVE` (reactivate)
- **Domain Events Emitted**:
  - `CustomerCreatedEvent` — on creation (carries vendorId, customerId, phone)
  - `CustomerDeactivatedEvent` — on deactivate
- **Commands**: CreateCustomer, UpdateCustomer, DeactivateCustomer, ReactivateCustomer, UpdateCreditLimit
- **Queries**: GetCustomer, ListCustomers, GetCustomerBill, GetCustomerCalendar

### PaymentAggregate
- **Root Entity**: `PaymentEntity`
- **Value Objects**: None (amount is a plain Decimal; no currency concerns — all INR)
- **Invariants**:
  1. `amount > 0` (payments are always positive numbers)
  2. `paymentDate` is a valid past-or-today date (tolerance: 1 day future for TZ)
  3. **Immutable** — no update or delete operations
- **Domain Events Emitted**:
  - `PaymentRecordedEvent` — on creation (carries customerId, vendorId, amount, paymentDate)
- **Commands**: RecordPayment
- **Queries**: ListPayments

---

## Entities

### Entity: CustomerEntity
- **Identity**: BigInt (autoincrement), serialized as string in API responses
- **Fields**:
  | Field | Type | Required | Default | Constraint |
  |-------|------|----------|---------|-----------|
  | id | BigInt | Yes | auto | PK |
  | name | CustomerNameVO | Yes | - | 1–100 chars |
  | phone | CustomerPhoneVO | Yes | - | normalized E.164 |
  | phoneCountryCode | string | Yes | "+91" | - |
  | email | string? | No | null | valid email |
  | address | string? | No | null | max 500 |
  | area | string? | No | null | max 100 |
  | languagePreference | string | Yes | "en" | max 10 |
  | creditLimit | CreditLimitVO | Yes | 0 | >= 0 |
  | paymentScore | PaymentScoreVO | Yes | 100 | [0,100] |
  | customerSince | Date? | No | null | past date |
  | status | CustomerStatus | Yes | ACTIVE | enum |
  | createdByUserId | BigInt? | No | null | FK -> User |
  | createdAt | DateTime | Yes | now() | - |
  | updatedAt | DateTime | Yes | auto | - |
  | deletedAt | DateTime? | No | null | soft delete |
- **Behavior**:
  - `update(patch)`: updates mutable profile fields, re-validates
  - `deactivate()`: asserts ACTIVE, transitions to INACTIVE, sets deletedAt
  - `reactivate()`: asserts INACTIVE, transitions to ACTIVE, clears deletedAt
  - `updateCreditLimit(limit)`: validates `>= 0`, sets CreditLimitVO
- **Invariants checked in `validate()`**: name, phone, creditLimit, paymentScore ranges

### Entity: PaymentEntity
- **Identity**: BigInt (autoincrement)
- **Fields**:
  | Field | Type | Required | Default |
  |-------|------|----------|---------|
  | id | BigInt | Yes | auto |
  | customerId | BigInt | Yes | - |
  | vendorId | BigInt | Yes | - |
  | amount | number (Decimal) | Yes | - |
  | paymentDate | Date | Yes | - |
  | paymentMethod | PaymentMethod | Yes | CASH |
  | referenceNumber | string? | No | null |
  | recordedByUserId | BigInt? | No | null |
  | createdAt | DateTime | Yes | now() |
- **Behavior**: `create()` factory only — immutable after creation
- **Invariants**: `amount > 0`; `paymentDate` not too far in the future

---

## Value Objects

### CustomerPhoneVO
- **Properties**: `rawPhone: string`, `countryCode: string`
- **Validation**: strips non-digit characters, validates resulting string is 10 digits (Indian numbers), prepends countryCode; rejects empty or non-numeric
- **Equality**: Structural (normalized phone + countryCode)
- **unpack()**: returns `{ phone: string (full E.164), countryCode: string }`

### CreditLimitVO
- **Properties**: `value: number`
- **Validation**: `>= 0`, `<= 9999999.99`, must be finite
- **Equality**: `value === other.value`
- **unpack()**: `number`

### PaymentScoreVO
- **Properties**: `value: number`
- **Validation**: integer or decimal in `[0, 100]`
- **Equality**: `value === other.value`
- **unpack()**: `number`

### CustomerNameVO
- **Properties**: `value: string`
- **Validation**: trimmed length in `[1, 100]`
- **Equality**: exact string match
- **unpack()**: `string`

---

## Domain Events

| Event | Triggered When | Payload | Consumers |
|-------|---------------|---------|-----------|
| `CustomerCreatedEvent` | New customer created | `{ aggregateId: customerId, vendorId, phone }` | AuditLog |
| `CustomerDeactivatedEvent` | Customer deactivated | `{ aggregateId: customerId, vendorId }` | AuditLog |
| `PaymentRecordedEvent` | Payment recorded | `{ aggregateId: paymentId, customerId, vendorId, amount, paymentDate }` | AuditLog |

All events extend `DomainEventBase` (from `src/modules/auth/domain/events/domain-event.base.ts`).

---

## Use Cases (CQS)

### Commands (State-Changing)

| Use Case | Input | Key Steps | Errors |
|---------|-------|-----------|--------|
| CreateCustomer | CreateCustomerInput | validate phone uniqueness → `CustomerEntity.create()` → tx(insert Customer + VendorCustomer + SupplyListCustomer[]) | 409 duplicate phone, 400 validation |
| UpdateCustomer | UpdateCustomerInput + customerId | load → ownership → `entity.update(patch)` → re-check phone if changed → persist | 404, 409, 400 |
| DeactivateCustomer | customerId | load → guard ACTIVE → `entity.deactivate()` → end all active subscriptions → tx | 404, 422 already inactive |
| ReactivateCustomer | customerId | load → guard INACTIVE → `entity.reactivate()` → persist | 404, 422 already active |
| UpdateCreditLimit | customerId + creditLimit | load → `entity.updateCreditLimit()` → persist → return utilization | 404, 400 |
| RecordPayment | RecordPaymentInput + customerId | verify ownership → `PaymentEntity.create()` → insert → return DTO | 404, 400 |
| AddSubscription | customerId + supplyListId + opts | verify both belong to vendor → check no active sub → insert SupplyListCustomer | 404, 409 |
| RemoveSubscription | subscriptionId | load → verify active → set endDate + isActive=false | 404, 422 |

### Queries (Read-Only)

| Use Case | Output | Notes |
|---------|--------|-------|
| ListCustomers | Paginated CustomerListItemDto[] | Staff scoped; financial gate; N+1-free balance via `getBulkBalances` |
| GetCustomer | CustomerDetailDto | Subscriptions + bill summary + payment history; staff guard |
| GetCustomerBill | CustomerBillDto | Aggregate DailySupply + extra charges + previousDue |
| GetCustomerCalendar | CustomerCalendarDto | Per-day DailySupply map |
| ListPayments | Paginated PaymentDto[] | Owner only; reverse chronological |

---

## Mapper Design

### CustomerMapper
- **toPersistence(entity)**: maps CustomerEntity → Prisma `Customer` update/create data (flat VOs)
- **toDomain(record)**: reconstitutes CustomerEntity from Prisma `Customer` row (rebuilds VOs)
- **toResponse(entity)**: whitelisted `CustomerDetailDto` — no `deletedAt`, no `userId`, no `passwordHash`; IDs as strings

---

## Anti-Corruption Layer

### External Integration: Delivery Module (read-only)

- **Their model**: `DailySupply` table with `finalAmount`, `status`, `serviceDate`, `supplyListCustomerId`
- **Our model**: Numeric `balance`, per-month `deliveries` aggregation
- **Port (interface)**: `src/modules/customer/ports/delivery-billing.port.ts` — `IDeliveryBillingPort`
- **Adapter (implementation)**: `src/modules/customer/adapters/delivery-billing.adapter.ts` — raw Prisma queries, no delivery module imports
- **Translation**: Raw SQL aggregation → typed `MonthlyDeliveryRow[]`, `Map<bigint, number>`
- **Error translation**: Prisma errors → domain errors before they surface to application layer

---

## Module Structure

Complex DDD layout (Moderate → Complex; billing logic crosses aggregate boundaries):

```
src/modules/customer/
├── domain/
│   ├── customer.entity.ts
│   ├── customer.errors.ts
│   ├── customer.types.ts
│   ├── value-objects/
│   │   ├── customer-phone.vo.ts
│   │   ├── credit-limit.vo.ts
│   │   ├── payment-score.vo.ts
│   │   └── customer-name.vo.ts
│   └── events/
│       ├── customer-created.domain-event.ts
│       ├── customer-deactivated.domain-event.ts
│       └── payment-recorded.domain-event.ts
├── commands/
│   ├── create-customer/create-customer.command.ts
│   ├── update-customer/update-customer.command.ts
│   ├── deactivate-customer/deactivate-customer.command.ts
│   ├── update-credit-limit/update-credit-limit.command.ts
│   ├── record-payment/record-payment.command.ts
│   ├── add-subscription/add-subscription.command.ts
│   └── remove-subscription/remove-subscription.command.ts
├── queries/
│   ├── list-customers/list-customers.query.ts
│   ├── get-customer/get-customer.query.ts
│   ├── get-customer-bill/get-customer-bill.query.ts
│   ├── get-customer-calendar/get-customer-calendar.query.ts
│   └── list-payments/list-payments.query.ts
├── database/
│   ├── customer.repository.port.ts
│   └── customer.repository.ts
├── ports/
│   └── delivery-billing.port.ts
├── adapters/
│   └── delivery-billing.adapter.ts
├── customer.mapper.ts
├── customer.types.ts
├── customer.validator.ts
├── customer.controller.ts
├── customer.routes.ts
└── __tests__/
    ├── customer.commands.test.ts
    ├── customer.queries.test.ts
    └── domain/
        ├── customer.entity.test.ts
        └── value-objects.test.ts
```
