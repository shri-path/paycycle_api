# Code Review Report: US-009 Subscription & Pricing Management

## Summary
- **Date**: 2026-06-12
- **Reviewer**: Review Agent (Claude Sonnet 4.6)
- **Feature Plan**: `docs/features/us-009-subscription-pricing/FEATURE_PLAN.md`
- **Complexity Tier**: Complex
- **Overall Assessment**: CHANGES REQUIRED

Five findings must be fixed before QA: four CRITICAL (domain-event base, dependency rule violations x2, missing entity validate) and one MAJOR (CANCELLED subscription invisible to GET /subscription). Three additional MAJOR findings (test gaps) should be addressed concurrently.

---

## Statistics

| Severity | Count |
|----------|-------|
| BLOCKER  | 0     |
| CRITICAL | 4     |
| MAJOR    | 3     |
| MINOR    | 2     |
| INFO     | 1     |

---

## Findings

### CRITICAL-1: Domain events do not extend `DomainEventBase`

- **Files**: All five event files:
  - `src/modules/subscription/domain/events/subscription-created.domain-event.ts`
  - `src/modules/subscription/domain/events/subscription-upgraded.domain-event.ts`
  - `src/modules/subscription/domain/events/subscription-renewed.domain-event.ts`
  - `src/modules/subscription/domain/events/subscription-cancelled.domain-event.ts`
  - `src/modules/subscription/domain/events/subscription-expired.domain-event.ts`
- **Skill Violated**: `domain-modeling.md` — Domain Events must extend `DomainEventBase`; Memory convention `convention_domain_event_base.md` — "Every domain event class must extend `DomainEventBase`."
- **Description**: All five subscription domain events are bare classes with a plain `payload` constructor and a `readonly eventType` tag. They do not extend `DomainEventBase` from `src/modules/auth/domain/events/domain-event.base.ts`, which provides the mandatory `id: string` (UUID), `aggregateId: string`, `occurredAt: Date`, and `metadata: { correlationId: string; causationId?: string }` fields. Without these, events cannot be dispatched, audited, or consumed downstream consistently. The convention was explicitly flagged as CRITICAL in US-003.
- **Expected**: Each event class must extend `DomainEventBase` and pass `aggregateId` (the subscription ID as string) and `metadata` to the base constructor.
- **Fix**: Replace all five event classes with `DomainEventBase` subclasses. Example for `SubscriptionCreatedEvent`:
  ```ts
  import { DomainEventBase, DomainEventMetadata } from '@/modules/auth/domain/events/domain-event.base';
  export class SubscriptionCreatedEvent extends DomainEventBase {
    readonly type = 'subscription.created' as const;
    constructor(
      public readonly payload: SubscriptionCreatedPayload,
      metadata: DomainEventMetadata
    ) {
      super(payload.vendorSubscriptionId.toString(), metadata);
    }
  }
  ```
  The `metadata.correlationId` must be threaded from the originating command (commands already have `correlationId`). Update all `entity._events.push(new XxxEvent(...))` call sites to pass a metadata object.

---

### CRITICAL-2: `RenewSubscriptionCommand` directly imports the Prisma client — Dependency Rule violation

- **File**: `src/modules/subscription/commands/renew-subscription/renew-subscription.command.ts:19`
- **Skill Violated**: `service-implementation.md` — services must never import infrastructure; Clean Architecture Dependency Rule (dependencies point inward).
- **Description**: Line 19: `import { prisma } from '@/infrastructure/database/prisma.client';`. The command (application layer) queries the database directly on lines 52–73 to find the most-recent expired subscription, bypassing the repository port entirely:
  ```ts
  const expiredRow = await prisma.vendorSubscription.findFirst({
    where: { vendorId, status: VendorSubscriptionStatus.EXPIRED },
    orderBy: { createdAt: 'desc' },
  });
  ```
  This means the application layer depends on infrastructure (Prisma), violating the Dependency Rule. It also means the query cannot be mocked in unit tests.
- **Expected**: The `ISubscriptionRepository` port must expose a method for this query (e.g., `findLatestExpiredByVendor(vendorId, tx?)`). The command calls only the port.
- **Fix**:
  1. Add to `ISubscriptionRepository` in `database/subscription.repository.port.ts`:
     ```ts
     findLatestExpiredByVendor(vendorId: bigint, tx?: PrismaTransaction): Promise<VendorSubscriptionRow | null>;
     ```
  2. Implement in `SubscriptionRepository`:
     ```ts
     async findLatestExpiredByVendor(vendorId: bigint, tx?: PrismaTransaction) {
       const db = tx ?? prisma;
       const row = await db.vendorSubscription.findFirst({
         where: { vendorId, status: PrismaVendorSubscriptionStatus.EXPIRED },
         orderBy: { createdAt: 'desc' },
       });
       return row ? toRow(row) : null;
     }
     ```
  3. Remove the `import { prisma }` from the command and replace the direct query with `this.subscriptionRepo.findLatestExpiredByVendor(vendorId, tx)`.

---

### CRITICAL-3: Three commands import the concrete `SubscriptionRepository` class to call a static method — Dependency Rule violation

- **Files**:
  - `src/modules/subscription/commands/upgrade-subscription/upgrade-subscription.command.ts:20,99`
  - `src/modules/subscription/commands/renew-subscription/renew-subscription.command.ts:18,97`
  - `src/modules/subscription/commands/expire-or-renew-due/expire-or-renew-due.command.ts:14,63`
- **Skill Violated**: `service-implementation.md` — services must depend on port interfaces, not concrete implementations; Dependency Rule.
- **Description**: All three commands import `SubscriptionRepository` (the Prisma adapter — infrastructure) and call the static method `SubscriptionRepository.generateInvoiceNumber(vendorId, today, tx)`. This makes the application layer depend directly on an infrastructure concrete class. Static method calls cannot be mocked in unit tests and cannot be swapped for alternative implementations.
- **Expected**: `generateInvoiceNumber` must be part of the `ISubscriptionRepository` port as an instance method, and each command calls only `this.subscriptionRepo.generateInvoiceNumber(...)`.
- **Fix**:
  1. Add to `ISubscriptionRepository`:
     ```ts
     generateInvoiceNumber(vendorId: bigint, today: Date, tx: PrismaTransaction): Promise<string>;
     ```
  2. In `SubscriptionRepository`, convert the static method to an instance method (or delegate to it):
     ```ts
     async generateInvoiceNumber(vendorId: bigint, today: Date, tx: PrismaTransaction): Promise<string> {
       return SubscriptionRepository.generateInvoiceNumber(vendorId, today, tx);
     }
     ```
  3. Remove all three `import { SubscriptionRepository }` lines from the commands and replace `SubscriptionRepository.generateInvoiceNumber(...)` with `this.subscriptionRepo.generateInvoiceNumber(...)`.

---

### CRITICAL-4: `VendorSubscriptionEntity` has no `validate()` method; `reconstitute()` does not call validate

- **File**: `src/modules/subscription/domain/subscription.entity.ts:146-153`
- **Skill Violated**: `domain-modeling.md` — entities must call `validate()` in all factory paths; Memory convention `convention_entity_invariants.md` — "`create()` AND `reconstitute()` must call `this.validate()`."
- **Description**: The entity has no `validate()` method. `reconstitute()` (line 146) simply calls `new VendorSubscriptionEntity(...)` with no invariant checking. This means a corrupt database record (e.g., `amountPaid < 0`, `startDate > endDate`, invalid status string) produces an invalid in-memory entity that propagates silently through the system.
- **Expected**: A `private validate()` method must exist and must be called at the end of every factory path (both `createStarter` and `reconstitute`).
- **Fix**:
  ```ts
  private validate(): void {
    if (!Object.values(VendorSubscriptionStatus).includes(this._props.status)) {
      throw new ArgumentInvalidException(`Invalid subscription status: ${this._props.status}`);
    }
    if (!Object.values(BillingCycleEnum).includes(this._props.billingCycle)) {
      throw new ArgumentInvalidException(`Invalid billing cycle: ${this._props.billingCycle}`);
    }
    if (this._props.amountPaid < 0) {
      throw new ArgumentInvalidException('amountPaid must be >= 0');
    }
    if (this._props.endDate && this._props.startDate > this._props.endDate) {
      throw new ArgumentInvalidException('endDate must be >= startDate');
    }
  }
  ```
  Call `this.validate()` at the end of both `createStarter()` (before the event push) and `reconstitute()` (before returning). Import `ArgumentInvalidException` from `@/common/errors/app-error`.

---

### MAJOR-1: `findActiveByVendor` excludes CANCELLED subscriptions — GET /subscription returns 404 after cancel

- **Files**:
  - `src/modules/subscription/database/subscription.repository.ts:23-27,130-143`
  - `src/modules/subscription/queries/get-vendor-subscription/get-vendor-subscription.query.ts:23`
- **Skill Violated**: API contract compliance (API_SPEC.md endpoint 2), FEATURE_PLAN domain model ("A CANCELLED subscription is still usable until `nextBillingDate`").
- **Description**: `ACTIVE_STATUSES` (line 23) is `[TRIAL, ACTIVE, PAST_DUE]`. After `cancel()`, a subscription has `status=CANCELLED` and `endDate=null`. `findActiveByVendor` will not find it, so `GetVendorSubscriptionQuery.execute()` throws `SubscriptionNotFoundError` (404). The API_SPEC explicitly shows `status: "CANCELLED"` as a valid response from `GET /vendors/:vendorId/subscription` and states the subscription remains usable until `nextBillingDate`.

  Additionally, the `enforceSubscriptionLimit` middleware also calls `findActiveByVendor` — so after cancel, the middleware fails-open (no active subscription found, logs a warning). While fail-open is the documented behavior (OQ-8), in this case the vendor HAS a subscription (CANCELLED but still valid), and the warning log would fire spuriously on every create-customer/staff/supply-list call until the billing date.
- **Expected**: A CANCELLED subscription with `endDate IS NULL` should still be returned by the "find current subscription" lookup (it represents a subscription that is active until `nextBillingDate`).
- **Fix**: Expand `ACTIVE_STATUSES` to include `CANCELLED`:
  ```ts
  const ACTIVE_STATUSES: PrismaVendorSubscriptionStatus[] = [
    PrismaVendorSubscriptionStatus.TRIAL,
    PrismaVendorSubscriptionStatus.ACTIVE,
    PrismaVendorSubscriptionStatus.PAST_DUE,
    PrismaVendorSubscriptionStatus.CANCELLED,
  ];
  ```
  The `endDate: null` filter already ensures this only returns the current period subscription. The enforcement middleware already handles CANCELLED gracefully (PlanLimits still apply) since the vendor is within their paid period.

---

### MAJOR-2: No integration tests for subscription endpoints

- **Files**: `tests/integration/` directory — no `subscription.test.ts` exists
- **Skill Violated**: `testing-strategy.md` — integration tests required for all 8 endpoints; error scenarios (400, 401, 403, 404, 409, 422, 451) must be tested.
- **Description**: All other modules in this codebase have integration tests (`customer.test.ts`, `staff.test.ts`, `delivery.test.ts`, etc.). The subscription module has no HTTP-level integration tests at all. The following flows lack test coverage: plan listing, subscription view, upgrade/renew/cancel/auto-renewal commands, invoices and history paging, and the 451 limit enforcement on the three create endpoints.
- **Expected**: A `tests/integration/subscription.test.ts` covering at minimum:
  - `GET /subscription-plans` → 200 with plan list
  - `GET /vendors/:vendorId/subscription` → 200 / 404
  - `POST .../upgrade` → 200, 404 (no sub), 422 (same tier), 403 (staff)
  - `POST .../cancel` → 200, 422 (already cancelled), 403 (staff)
  - `POST .../renew` → 200
  - `PATCH .../auto-renewal` → 200, 400 (missing field)
  - `GET .../invoices` → 200, 403 (staff)
  - `GET .../history` → 200
  - `POST /customers` (with limit enforcement) → 451 when at limit
- **Fix required**: Dev must add `tests/integration/subscription.test.ts` before QA.

---

### MAJOR-3: No unit tests for commands, queries, or the enforce-limit middleware

- **Files**: `src/modules/subscription/__tests__/` — only `domain/` and `services/` subdirectories exist
- **Skill Violated**: `testing-strategy.md` — service unit tests required with mocked repository ports.
- **Description**: The three most business-critical flows — `UpgradeSubscriptionCommand`, `CancelSubscriptionCommand`, and `enforceSubscriptionLimit` — have zero unit test coverage. These contain the most complex logic (pro-rata application, tier validation, fail-open behavior) and the highest regression risk.
- **Fix required**: Add unit test files in `src/modules/subscription/__tests__/commands/` and `src/modules/subscription/__tests__/middleware/` with mocked repository ports.

---

### MINOR-1: `getProps()` does not include `id`, `createdAt`, `updatedAt` in the frozen snapshot

- **File**: `src/modules/subscription/domain/subscription.entity.ts:97-99`
- **Skill Violated**: Memory convention `convention_entity_invariants.md` — "`getProps()` must return `Object.freeze({ ...this._props, id: this._id, createdAt: this._createdAt, updatedAt: this._updatedAt })`"
- **Description**: Current implementation: `Object.freeze({ ...this._props })`. Convention requires `id`, `createdAt`, `updatedAt` to be included in the frozen snapshot. The identity fields are exposed as separate getters so this doesn't create a correctness bug, but it is an explicit deviation from the convention enforced project-wide.
- **Fix**:
  ```ts
  getProps(): Readonly<VendorSubscriptionProps & { id: bigint; createdAt: Date; updatedAt: Date }> {
    return Object.freeze({ ...this._props, id: this._id, createdAt: this._createdAt, updatedAt: this._updatedAt });
  }
  ```

---

### MINOR-2: `status` column in `VendorSubscription` Prisma model missing `@map("status")`

- **File**: `prisma/schema.prisma:852`
- **Skill Violated**: `prisma-schema-design.md` — all columns use `@map()` with snake_case name.
- **Description**: `status VendorSubscriptionStatus @default(ACTIVE)` — no `@map("status")`. Since the camelCase name (`status`) already equals the snake_case name, this has no runtime impact. But it is inconsistent with the codebase convention where every column has an explicit `@map()`.
- **Fix**: `status VendorSubscriptionStatus @default(ACTIVE) @map("status")`

---

### INFO-1: `DateRange` value object described in FEATURE_PLAN not implemented

- **File**: FEATURE_PLAN.md "Value Objects" table
- **Description**: The FEATURE_PLAN lists a `DateRange` VO with `daysRemaining(from)` method. The functionality is covered by `ProrataCalculator.daysRemainingFrom()` and plain `Date` fields in the entity. No bug results from the omission, but the VO abstraction would make the date-math more testable and reusable for future features (e.g., utilization % "days until renewal").
- **Fix**: Optional — add in a follow-up task.

---

## Skill Compliance Summary

| Skill                        | Status | Notes                                                                 |
|------------------------------|--------|-----------------------------------------------------------------------|
| module-scaffold.md           | PASS   | commands/ and queries/ subdirs present; correct file hierarchy        |
| prisma-schema-design.md      | PASS   | BigInt PKs, snake_case maps, indexes present, partial unique in migration |
| domain-modeling.md           | FAIL   | Events don't extend DomainEventBase (CRITICAL-1); no validate() (CRITICAL-4) |
| validation-schemas.md        | PASS   | .strict() on mutations, .passthrough() on queries, z.enum for BillingCycle |
| repository-implementation.md | FAIL   | Port missing generateInvoiceNumber and findLatestExpiredByVendor (CRITICAL-2, CRITICAL-3) |
| service-implementation.md    | FAIL   | Commands import concrete class and prisma client directly (CRITICAL-2, CRITICAL-3) |
| error-handling.md            | PASS   | next(error) in all controllers; SubscriptionLimitReachedError shape correct; fail-open logged |
| testing-strategy.md          | FAIL   | No integration tests; no command/middleware unit tests (MAJOR-2, MAJOR-3) |
| api-contract-design.md       | FAIL   | GET /subscription returns 404 after cancel (MAJOR-1)                  |

---

## Checklist Verification

### Architecture & Structure
- [x] Complexity assessment matches — Complex tier with full DDD structure
- [x] commands/ and queries/ subdirectories present
- [x] Module registered in app.ts (lines 78-79)
- [x] Seed data includes plans + dev subscription
- [ ] CRITICAL-4: Entity validate() missing
- [ ] CRITICAL-1: Domain events don't extend DomainEventBase

### Database Schema
- [x] BigInt autoincrement IDs on all models
- [x] snake_case columns via @map(), table names snake_case plural
- [x] createdAt / updatedAt on all models
- [x] Mandatory indexes present (deletedAt N/A for plans per FEATURE_PLAN)
- [x] Enums have @@map() with snake_case
- [x] Cross-aggregate references by ID only (subscriptionPlanId, vendorId)
- [x] onDelete policies set (Cascade on history/invoices, Restrict on plan/vendor FKs)
- [x] Partial unique index added via raw SQL in migration
- [ ] MINOR-2: status field missing @map("status")

### Domain Model
- [x] Domain layer has ZERO framework imports
- [x] Entity uses factory methods (createStarter, upgradeTo, reconstitute)
- [ ] CRITICAL-4: No validate() method; reconstitute() doesn't validate
- [x] Entity exposes behavior, not setters (cancel, expire, renew, closeForUpgrade)
- [x] getProps() returns frozen object
- [ ] MINOR-1: getProps() missing id, createdAt, updatedAt in freeze
- [ ] CRITICAL-1: Domain events not extending DomainEventBase

### Validation
- [x] Mutation schemas use .strict()
- [x] Query schemas use .passthrough()
- [x] z.enum() for BillingCycle
- [x] Types exported via z.infer

### Repository
- [x] Port defined for both repositories
- [x] Every method accepts tx?: PrismaTransaction
- [x] P2002 caught as ConflictError
- [ ] CRITICAL-3: generateInvoiceNumber not on port interface
- [ ] CRITICAL-2: findLatestExpiredByVendor not on port interface

### Service / Commands
- [x] CQS classification: commands mutate, queries read
- [x] Constructor injection on port interfaces
- [x] Transactions for multi-step operations
- [x] Multi-tenant isolation via vendorId from JWT
- [ ] CRITICAL-2: RenewSubscriptionCommand imports prisma client directly
- [ ] CRITICAL-3: 3 commands import concrete SubscriptionRepository class

### Error Handling
- [x] Specific error classes (SubscriptionNotFoundError, InvalidPlanUpgradeError, etc.)
- [x] Controller uses next(error) in every handler
- [x] Wrong-tenant masked as NotFound via identifyUserRole
- [x] SubscriptionLimitReachedError → 451 with correct details shape
- [x] Fail-open middleware logs warning with correlationId

### Controller & Routes
- [x] Arrow function methods for proper this binding
- [x] try/catch → next(error) in every handler
- [x] No business logic in controller
- [x] vendorId from req.roleContext, never from body
- [x] Routes file is composition root
- [x] Middleware chain: authenticate → validate → identifyUserRole → requireOwnerRole → controller
- [ ] MAJOR-1: CANCELLED subscription not visible via GET /subscription after cancel

### Cron Jobs
- [x] Gated behind ENABLE_CRON=true
- [x] Proper error handling (try/catch, per-subscription isolation)
- [x] No side effects if payment gateway absent (stub always succeeds)
- [x] Correct timezone (Asia/Kolkata)

### Limit Enforcement Middleware
- [x] Runs after identifyUserRole, before controller
- [x] 0 = unlimited correctly handled (isUnlimited check)
- [x] Fail-open with correlationId warning when no subscription
- [x] Wired on POST customers, POST staff/invite, POST supply-lists

### Security
- [x] No raw SQL (parameterized queries via Prisma)
- [x] vendorId from JWT context only
- [x] Owner-only endpoints properly guarded (requireOwnerRole)
- [x] upgradeUrl is relative path, not attacker-controlled

### Testing
- [x] Domain entity tests (createStarter, upgradeTo, cancel, expire, renew)
- [x] Value object tests (PlanTierVO, BillingCycleVO, PlanLimitsVO, MoneyVO)
- [x] ProrataCalculator tests (formula, edge cases, rounding)
- [ ] MAJOR-2: No integration tests
- [ ] MAJOR-3: No command/query unit tests; no enforce-limit middleware test

---

## Required Fixes Before QA

The following four CRITICAL findings and one MAJOR finding must be resolved by the Dev agent before QA begins:

1. **CRITICAL-1** — Make all 5 domain event classes extend `DomainEventBase`, threading `correlationId` from each command.
2. **CRITICAL-2** — Add `findLatestExpiredByVendor` to `ISubscriptionRepository` port; remove direct `prisma` import from `RenewSubscriptionCommand`.
3. **CRITICAL-3** — Add `generateInvoiceNumber` to `ISubscriptionRepository` port as an instance method; remove the three `import { SubscriptionRepository }` lines from commands.
4. **CRITICAL-4** — Add `private validate()` to `VendorSubscriptionEntity`; call it in both `createStarter()` and `reconstitute()`.
5. **MAJOR-1** — Add `CANCELLED` to `ACTIVE_STATUSES` in `subscription.repository.ts` so the current subscription remains visible after cancellation.
6. **MAJOR-2** — Add `tests/integration/subscription.test.ts` covering all 8 endpoints and the 451 limit path.
7. **MAJOR-3** — Add unit tests for `UpgradeSubscriptionCommand`, `CancelSubscriptionCommand`, and `enforceSubscriptionLimit` with mocked ports.

MINOR-1, MINOR-2, and INFO-1 may be addressed in a follow-up or alongside the critical fixes at the developer's discretion.
