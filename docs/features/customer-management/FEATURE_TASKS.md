# Feature Tasks: US-008 Customer Management

## Implementation Order

### Phase 1 — Schema & Migration

- [ ] T-01  Add `CustomerStatus` and `PaymentMethod` enums to `prisma/schema.prisma`
- [ ] T-02  Extend `Customer` model with new US-008 columns (`phoneCountryCode`, `area`, `languagePreference`, `creditLimit`, `paymentScore`, `customerSince`, `status`, `createdByUserId`) — all nullable-safe or with defaults
- [ ] T-03  Add `Payment` model to `prisma/schema.prisma`
- [ ] T-04  Add back-relations to `User` (`customersCreated`, `paymentsRecorded`) and `Vendor` (`payments`)
- [ ] T-05  Run `npm run migrate:create -- --name add_customer_management_us008` and review generated SQL
- [ ] T-06  Run `npm run migrate:deploy` and `npm run db:generate`
- [ ] T-07  Update seed file to include `customer:read`, `customer:create`, `customer:update`, `customer:delete` permissions (idempotent upsert)

---

### Phase 2 — Domain Layer

- [ ] T-08  Create `src/modules/customer/domain/customer.types.ts` — `CustomerStatus`, `CustomerProps`, `CreateCustomerProps`, `UpdateCustomerProps`
- [ ] T-09  Create value objects:
  - `src/modules/customer/domain/value-objects/customer-phone.vo.ts` — normalizes phone, validates E.164
  - `src/modules/customer/domain/value-objects/credit-limit.vo.ts` — validates `>= 0`, `<= 9999999.99`
  - `src/modules/customer/domain/value-objects/payment-score.vo.ts` — validates `[0, 100]`
  - `src/modules/customer/domain/value-objects/customer-name.vo.ts` — trims, validates 1–100 chars
- [ ] T-10  Create `src/modules/customer/domain/customer.entity.ts`:
  - `CustomerEntity.create()` factory
  - `CustomerEntity.reconstitute()` factory
  - Domain methods: `update()`, `deactivate()`, `reactivate()`, `updateCreditLimit()`
  - `getProps()` returns `Object.freeze(...)` — convention from MEMORY.md
  - `validate()` called from both `create()` and `reconstitute()`
- [ ] T-11  Create `src/modules/customer/domain/customer.errors.ts` — `CustomerNotFoundError`, `CustomerConflictError`, `CustomerAlreadyInactiveError`, `SubscriptionConflictError`, `SubscriptionNotActiveError`
- [ ] T-12  Create domain events:
  - `src/modules/customer/domain/events/customer-created.domain-event.ts`
  - `src/modules/customer/domain/events/customer-deactivated.domain-event.ts`
  - `src/modules/customer/domain/events/payment-recorded.domain-event.ts`
  All events extend `DomainEventBase` from `src/modules/auth/domain/events/domain-event.base.ts`
- [ ] T-13  Write domain unit tests in `src/modules/customer/__tests__/domain/`:
  - `customer.entity.test.ts` — create, update, deactivate, reactivate, credit limit invariants
  - `value-objects.test.ts` — CustomerPhoneVO, CreditLimitVO, PaymentScoreVO, CustomerNameVO

---

### Phase 3 — Repository

- [ ] T-14  Create `src/modules/customer/database/customer.repository.port.ts` — `ICustomerRepository` interface with methods:
  - `findById(id, vendorId, tx?)`: customer + vendor ownership check
  - `findByPhone(phone, vendorId, tx?)`: uniqueness check
  - `insert(entity, vendorCustomerData, tx?)`: creates Customer + VendorCustomer in transaction
  - `update(entity, tx?)`
  - `deactivate(id, tx?)`: sets status + deletedAt + ends subscriptions
  - `listCustomers(params, tx?)`: paginated with filters
  - `getCustomerWithDetail(id, vendorId, tx?)`: customer + subscriptions + recent payments
  - `insertPayment(payment, tx?)`
  - `listPayments(customerId, vendorId, pagination, tx?)`
  - `insertSubscription(data, tx?)`
  - `findActiveSubscription(customerId, supplyListId, tx?)`
  - `endSubscription(subscriptionId, endDate, tx?)`
- [ ] T-15  Create `src/modules/customer/adapters/delivery-billing.adapter.ts`:
  - Implements `IDeliveryBillingPort` from `src/modules/customer/ports/delivery-billing.port.ts`
  - Uses raw Prisma queries on `daily_supplies`, `supply_extra_charges`, `payments` tables
  - `getCustomerBalance(customerId, vendorId)`: sum of all delivered supply amounts + extra charges - payments
  - `getBulkBalances(customerIds, vendorId)`: returns `Map<bigint, number>` for list query efficiency
  - `getMonthlyDeliveries(customerId, vendorId, month)`: group by supplyListId for bill
  - `getCustomerDailySupplies(customerId, vendorId, from, to)`: for calendar
- [ ] T-16  Create `src/modules/customer/database/customer.repository.ts` — Prisma adapter implementing `ICustomerRepository`
- [ ] T-17  Create `src/modules/customer/customer.mapper.ts` — `toPersistence`, `toDomain` (reconstitutes `CustomerEntity`), `toResponse` (whitelist)

---

### Phase 4 — Commands

- [ ] T-18  `src/modules/customer/commands/create-customer/create-customer.command.ts`
  - Validate phone uniqueness for vendor
  - `CustomerEntity.create()` → transaction: insert customer + VendorCustomer + SupplyListCustomer(s)
  - Log `sendInvite` intent to AuditLog if `sendInvite = true`
- [ ] T-19  `src/modules/customer/commands/update-customer/update-customer.command.ts`
  - Load + ownership check → `entity.update(patch)` → re-check phone uniqueness if phone changed → persist
- [ ] T-20  `src/modules/customer/commands/deactivate-customer/deactivate-customer.command.ts`
  - Load → guard already INACTIVE → `entity.deactivate()` → end active subscriptions → persist in transaction
- [ ] T-21  `src/modules/customer/commands/update-credit-limit/update-credit-limit.command.ts`
  - Load → `entity.updateCreditLimit(limit)` → persist → return utilization
- [ ] T-22  `src/modules/customer/commands/record-payment/record-payment.command.ts`
  - Verify customer belongs to vendor → `PaymentEntity.create(...)` → insert payment → return DTO
- [ ] T-23  `src/modules/customer/commands/add-subscription/add-subscription.command.ts`
  - Verify customer + list both belong to vendor → check no active subscription → insert `SupplyListCustomer`
- [ ] T-24  `src/modules/customer/commands/remove-subscription/remove-subscription.command.ts`
  - Load subscription → verify it's active → set endDate + isActive = false
- [ ] T-25  Write unit tests for all commands in `src/modules/customer/__tests__/customer.commands.test.ts`

---

### Phase 5 — Queries

- [ ] T-26  `src/modules/customer/queries/list-customers/list-customers.query.ts`
  - Paginated list; staff scoped; balance + paymentStatus computed; financial gate for owner-only fields
  - Uses `IDeliveryBillingPort.getBulkBalances()` for N+1-free balance fetch
- [ ] T-27  `src/modules/customer/queries/get-customer/get-customer.query.ts`
  - Full detail: subscriptions + current month bill summary + recent payments
  - Staff access guard: at least one subscription in staff's assigned lists
- [ ] T-28  `src/modules/customer/queries/get-customer-bill/get-customer-bill.query.ts`
  - Parse month → aggregate DailySupply by list → aggregate extra charges → compute previousDue → return bill DTO
- [ ] T-29  `src/modules/customer/queries/get-customer-calendar/get-customer-calendar.query.ts`
  - Fetch DailySupply rows for customer+month → return per-day delivery map
- [ ] T-30  `src/modules/customer/queries/list-payments/list-payments.query.ts`
  - Paginated payments for customer + vendor, reverse chronological
- [ ] T-31  Write unit tests for queries in `src/modules/customer/__tests__/customer.queries.test.ts`

---

### Phase 6 — HTTP Layer

- [ ] T-32  Create `src/modules/customer/customer.types.ts` — all DTOs:
  - `CustomerListItemDto`, `CustomerDetailDto`, `CustomerBillDto`, `CustomerCalendarDto`, `PaymentDto`, `SubscriptionDto`
  - BigInt IDs serialized as strings; ISO date strings
- [ ] T-33  Create `src/modules/customer/customer.validator.ts` — Zod schemas:
  - `createCustomerSchema` (`.strict()`), `updateCustomerSchema` (`.strict()`), `recordPaymentSchema` (`.strict()`), `updateCreditLimitSchema` (`.strict()`), `addSubscriptionSchema` (`.strict()`)
  - Query schemas (`.passthrough()`): `listCustomersQuerySchema`, `listPaymentsQuerySchema`
  - Params schemas: `customerParamsSchema`, `monthParamsSchema`, `subscriptionParamsSchema`
- [ ] T-34  Create `src/modules/customer/customer.controller.ts` — 12 thin arrow-function handlers:
  - All handlers follow: `try { ... } catch (e) { next(e) }` pattern
  - Swagger `@openapi` JSDoc annotations on each handler
- [ ] T-35  Create `src/modules/customer/customer.routes.ts` — composition root:
  - Wire: repository → adapter → commands/queries → controller
  - Middleware chain: `authenticate → validate → identifyUserRole → requireOwner / service-enforces`
  - Staff endpoints: EP-1 (list), EP-3 (get), EP-10 (calendar) — gated by RBAC in service layer
  - Owner-only endpoints: EP-2, EP-4, EP-5, EP-6, EP-7, EP-8, EP-9, EP-11, EP-12 — `requireOwner` middleware

---

### Phase 7 — Wire Into App

- [ ] T-36  Register customer router in `src/app.ts`: `app.use('/api/v1/vendors/:vendorId', customerRouter)`
- [ ] T-37  Verify no circular imports (customer module must not import from delivery module directly)

---

### Phase 8 — Quality Gate

- [ ] T-38  `npm run lint:fix` — 0 errors
- [ ] T-39  `npm run build` — clean tsc (0 errors)
- [ ] T-40  `npm test -- --testPathPattern="customer"` — all domain + command + query unit tests pass
- [ ] T-41  Manual smoke test: create customer, update, record payment, get bill, deactivate
