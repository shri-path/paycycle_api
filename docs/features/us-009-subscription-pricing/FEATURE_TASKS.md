# Feature Tasks: Subscription & Pricing Management (US-009)

## Complexity: Complex — Skills to follow
`prisma-schema-design.md` · `domain-modeling.md` · `validation-schemas.md` ·
`repository-implementation.md` · `service-implementation.md` · `error-handling.md` ·
`module-scaffold.md` · `testing-strategy.md`

Module path: `src/modules/subscription/`. `commands/` and `queries/` subdirs are **mandatory**.
Read `FEATURE_PLAN.md` + `DOMAIN_MODEL.md` before any task. The plan wins over any skill conflict.

Reconciliations already decided (do not re-litigate): `0 = unlimited`; `auto_renewal`;
`subscription_plan_id`; UPPERCASE enums; `end_date NULL = active`; BigInt PKs; history table for
plan changes; `subscription_invoices` added net-new.

---

## Parallel Workstream Plan

> Each Phase starts only after all streams in the prior phase complete. Streams in a phase own
> non-overlapping files and run simultaneously.

---

### Phase 1 (parallel — no cross-stream dependencies)

#### Stream A: Data Foundation
**Files owned**: `prisma/schema.prisma`, `prisma/migrations/`, `prisma/seeds/index.ts`,
`project_documents/db-design/14-vendor-subscriptions.sql`
**Skills**: `prisma-schema-design.md`

- **Task A1** — Add Prisma models to `prisma/schema.prisma`:
  `SubscriptionPlan` (`subscription_plans`), `VendorSubscription` (`vendor_subscriptions`),
  `VendorSubscriptionHistory` (`vendor_subscription_history`), `SubscriptionInvoice`
  (`subscription_invoices`). Add enums `BillingCycle`, `VendorSubscriptionStatus`,
  `SubscriptionEventType`, `InvoicePaymentStatus` (all UPPERCASE values per FEATURE_PLAN
  "Data Model Changes"). Add the `subscriptions Subscription[]`-style back-relations on `Vendor`.
  Mandatory indexes: every FK, `createdAt`, `isActive`/`status`, `nextBillingDate`,
  `@@index([vendorId, status])` on `vendor_subscriptions`, `invoiceNumber` unique, `planCode` unique.
  **Output**: updated `schema.prisma`.
- **Task A2** — Generate the migration; in the migration SQL add the **partial-unique active index**
  by hand (Prisma can't express it):
  `CREATE UNIQUE INDEX uq_vendor_active_subscription ON vendor_subscriptions(vendor_id) WHERE status IN ('TRIAL','ACTIVE','PAST_DUE') AND end_date IS NULL;`
  **Output**: new migration folder under `prisma/migrations/`.
- **Task A3** — Update canonical `project_documents/db-design/14-vendor-subscriptions.sql` to add the
  net-new `subscription_invoices` table + `invoice_payment_status` enum (BigInt PK, uppercase enum,
  FK to `vendor_subscriptions` cascade + `vendors`, unique `invoice_number`, indexes on
  `vendor_subscription_id`, `vendor_id`, `payment_status`, `created_at`). Match FEATURE_PLAN field
  list exactly. **Output**: updated SQL file.
- **Task A4** — Seed in `prisma/seeds/index.ts`: add `seedSubscriptionPlans()` (idempotent upsert by
  `planCode`) with STARTER/GROWTH/PRO per the FEATURE_PLAN seed table (`0 = unlimited`). In the
  non-production block, assign the dev test vendor an ACTIVE Starter subscription + one `CREATED`
  history row + 2 invoices (one PAID, one PENDING). No new permission rows
  (`subscription:manage`/`subscription:read` already exist). **Output**: updated seed.

#### Stream B: Domain Core
**Files owned**: `src/modules/subscription/domain/**`, `src/modules/subscription/services/prorata.calculator.ts`
**Skills**: `domain-modeling.md`, `error-handling.md`

- **Task B1** — Value objects in `domain/value-objects/`: `plan-tier.vo.ts` (STARTER<GROWTH<PRO,
  `rank()`, `isHigherThan()`, `fromCode()`), `billing-cycle.vo.ts` (`days()` 30/365),
  `plan-limits.vo.ts` (`0=unlimited`, `isUnlimited()`, `allows()`, `max()`), `money.vo.ts`
  (≥0, ≤99999999.99, 2dp, `multiply`/`subtract` floored). Pure, no framework imports.
  **Output**: 4 VO files.
- **Task B2** — Entities: `domain/plan.entity.ts` (`SubscriptionPlanEntity.fromPersistence`,
  read-only) and `domain/subscription.entity.ts` (`VendorSubscriptionEntity` root with
  `createStarter`, `upgradeTo`, `renew`, `cancel`, `expire`, `setAutoRenewal`; invariants &
  transition guards per DOMAIN_MODEL state machine). Each mutator returns/records the right domain
  event. **Output**: 2 entity files + `domain/subscription.types.ts` (framework-free enums).
- **Task B3** — Domain events in `domain/events/` (`subscription-created/upgraded/renewed/cancelled/
  expired.domain-event.ts`) carrying `{ vendorSubscriptionId, vendorId, oldPlanId?, newPlanId?,
  performedByUserId?, occurredAt }`. **Output**: 5 event files.
- **Task B4** — Errors in `domain/subscription.errors.ts`: `SubscriptionNotFoundError`,
  `PlanNotFoundError`, `InvalidPlanUpgradeError`, `SubscriptionAlreadyCancelledError` (extend the
  `app-error` base classes per the FEATURE_PLAN error table). Also add `SubscriptionLimitReachedError
  extends AppError` (status 451, code `SUBSCRIPTION_LIMIT_REACHED`, `details={upgradeUrl,limits}`).
  **Output**: 1 errors file.
- **Task B5** — `services/prorata.calculator.ts`: pure `compute(currentPlan, newPlan, cycle, today,
  nextBillingDate)` implementing the FEATURE_PLAN formula (days-remaining × daily-rate-diff, floored
  at 0, 2dp) with documented edge cases. **Output**: 1 file.

#### Stream C: Types & Validation
**Files owned**: `src/modules/subscription/subscription.types.ts`, `src/modules/subscription/subscription.validator.ts`
**Skills**: `validation-schemas.md`

- **Task C1** — `subscription.types.ts`: response DTOs exactly matching `API_SPEC.md`
  (`PlanDto`, `SubscriptionViewDto`, `UpgradeResponseDto`, `RenewResponseDto`, `CancelResponseDto`,
  `AutoRenewalResponseDto`, `InvoiceDto`, `HistoryEventDto`). IDs as strings, money as numbers.
  **Output**: 1 file.
- **Task C2** — `subscription.validator.ts` Zod schemas: `upgradeSchema` (`newPlanId` numeric-string,
  `billingCycle` enum) `.strict()`; `renewSchema` `.strict()`; `autoRenewalSchema` (`autoRenewal`
  boolean) `.strict()`; `cancelSchema` (empty) `.strict()`; `paginationQuerySchema`
  (`page`/`limit`) `.passthrough()`; `vendorIdParamSchema` reuse. Enums via `z.enum([...])`
  uppercase. **Output**: 1 file.

---

### Phase 2 (parallel — after Phase 1 complete)

#### Stream D: Data Access Layer
**Files owned**: `src/modules/subscription/database/**`, `src/modules/subscription/subscription.mapper.ts`
**Skills**: `repository-implementation.md`
**Depends on**: A (schema), B (domain types/entities)

- **Task D1** — Ports: `database/subscription.repository.port.ts` (`ISubscriptionRepository`:
  `findActiveByVendor`, `findDueSubscriptions`, `closeAndOpen`, `persist`, `appendHistory`,
  `insertInvoice`, `listInvoices`, `listHistory`, `transaction`) and
  `database/plan.repository.port.ts` (`ISubscriptionPlanRepository`: `findAllActive`,
  `findActiveById`). Row interfaces per DOMAIN_MODEL. **Output**: 2 port files.
- **Task D2** — Prisma adapters `database/subscription.repository.ts` + `database/plan.repository.ts`:
  vendor-scoped queries, active lookup (`status IN (...) AND endDate null`), due-list query, P2002 on
  the partial-unique index → `ConflictError('Subscription already active')`, append-only history
  insert, invoice insert with `INV-YYYY-MM-<seq>` numbering inside the transaction. Tx support via
  `PrismaTransaction`. **Output**: 2 adapter files.
- **Task D3** — `subscription.mapper.ts`: `toDomain`, `toPersistence`, and all `to*Dto` methods per
  DOMAIN_MODEL mapper contract; field whitelist only, BigInt→string, Decimal→number. **Output**: 1 file.

#### Stream E: Application Layer (services + usage)
**Files owned**: `src/modules/subscription/services/usage-query.service.ts`,
`src/modules/subscription/ports/usage-counter.port.ts`,
`src/modules/subscription/services/payment/payment-gateway.port.ts`,
`src/modules/subscription/services/payment/stub-payment-gateway.ts`
**Skills**: `service-implementation.md`
**Depends on**: B (VOs), port interfaces (defined in DOMAIN_MODEL, available now)

- **Task E1** — `ports/usage-counter.port.ts` (`IUsageCounter`) + `services/usage-query.service.ts`:
  three live indexed COUNT queries (`vendor_customers` ACTIVE, `vendor_users` staff non-owner ACTIVE,
  `supply_lists` active & not soft-deleted) scoped by `vendorId`, run in parallel via `Promise.all`;
  `countAll()` returns `{customers, staff, supplyLists}`. Read-only; counts only (no hydration).
  **Output**: 2 files.
- **Task E2** — `services/payment/payment-gateway.port.ts` (`IPaymentGateway`) +
  `stub-payment-gateway.ts` returning `{ paymentUrl: https://payment.paycycle.app/invoice/<id>,
  gatewayRef: stub_<uuid> }`. **Output**: 2 files.

---

### Phase 3 (parallel — after Phase 2 complete)

#### Stream F: Commands & Queries (use cases)
**Files owned**: `src/modules/subscription/commands/**`, `src/modules/subscription/queries/**`
**Skills**: `service-implementation.md`, `error-handling.md`
**Depends on**: D (repo/mapper), E (usage/payment), B (entities), C (types)

- **Task F1** — `commands/assign-starter-plan/assign-starter-plan.command.ts` (Command): resolve
  STARTER plan, `VendorSubscriptionEntity.createStarter`, persist + append `CREATED` history in one
  txn. Idempotent if vendor already has an active sub (no-op or ConflictError per partial-unique).
- **Task F2** — `commands/upgrade-subscription/upgrade-subscription.command.ts` (Command): full flow
  per FEATURE_PLAN sequence diagram — load active sub + plan, tier guard
  (`InvalidPlanUpgradeError`), pro-rata via calculator, `closeAndOpen` txn, append `UPGRADED`,
  generate invoice via `IPaymentGateway`, return `UpgradeResponseDto`.
- **Task F3** — `commands/renew-subscription/renew-subscription.command.ts` (Command): renew or
  re-activate-from-expired, append `RENEWED`, invoice, return DTO.
- **Task F4** — `commands/cancel-subscription/cancel-subscription.command.ts` (Command): cancel guard
  (`SubscriptionAlreadyCancelledError`), append `CANCELLED`, return `{status, autoRenewal,
  activeUntil}`.
- **Task F5** — `commands/set-auto-renewal/set-auto-renewal.command.ts` (Command): toggle + persist.
- **Task F6** — `commands/expire-or-renew-due/expire-or-renew-due.command.ts` (Command, cron worker):
  `run(today)` over due subscriptions — auto-renew when `autoRenewal` (stub payment succeeds) else
  expire; append history; log-stub notifications. Returns `{renewed, expired}` counts.
- **Task F7** — Queries: `queries/list-plans/`, `queries/get-vendor-subscription/` (compose repo +
  `UsageQueryService` + utilization + canAddMore), `queries/list-invoices/`,
  `queries/list-subscription-history/`. Each a `*.query.ts`. **Output**: 4 query files.

> **Output (Stream F)**: 6 command files + 4 query files, each in its own subdir.

#### Stream G: Interface Layer + middleware wiring
**Files owned**: `src/modules/subscription/subscription.controller.ts`,
`src/modules/subscription/subscription.routes.ts`, `src/modules/subscription/subscription.cron.ts`,
`src/infrastructure/middlewares/subscription/enforce-subscription-limit.ts`,
`src/app.ts`, and edits to **`customer.routes.ts` / `staff.routes.ts` / `supply-list.routes.ts`**
(insert one middleware line each)
**Skills**: `module-scaffold.md` (Steps 5–9)
**Depends on**: F (commands/queries), C (validators), E (usage service)

- **Task G1** — `enforce-subscription-limit.ts`: factory
  `enforceSubscriptionLimit(resource)` returning a `RequestHandler` that runs after
  `identifyUserRole`, loads active sub via `ISubscriptionRepository`, unlimited-skips, live-counts via
  `IUsageCounter`, throws `SubscriptionLimitReachedError` (451) at limit, **fails open + warn-logs**
  when no active sub (OQ-8). Composition of its deps lives here or in a tiny factory module.
- **Task G2** — `subscription.controller.ts`: arrow-function handlers for all 8 endpoints,
  `vendorId` from `req.roleContext`, `try/catch → next(error)`, `sendSuccess`/`sendCreated`,
  Swagger `@openapi` annotations (mirror `customer.controller.ts`).
- **Task G3** — `subscription.routes.ts`: composition root wiring repos, adapters, usage service,
  stub gateway, commands, queries, controller. Two routers: one mounted at `/subscription-plans`
  (plan list), one at `/vendors` for the nested endpoints. Middleware chains: `authenticateToken →
  validate → identifyUserRole('vendorId') → requireOwnerRole() (manage/owner-only) → handler`.
  Reuse `writeLimiter` pattern.
- **Task G4** — `subscription.cron.ts`: `registerSubscriptionCron(expireOrRenewDue, logger)` gated
  behind `ENABLE_CRON=true`, Asia/Kolkata: **01:00** expire/auto-renew due subs; **09:00** renewal
  reminders for subs expiring in ≤7 days (log-stub only). Mirror `delivery.cron.ts` structure.
- **Task G5** — `src/app.ts`: import + mount `subscriptionPlansRoutes` at `${apiPrefix}` (for
  `/subscription-plans`) and `subscriptionRoutes` at `${apiPrefix}/vendors`; register the cron in the
  server bootstrap alongside the delivery cron.
- **Task G6** — Insert `enforceSubscriptionLimit('customers'|'staff'|'supplyLists')` into the three
  existing POST routes **after** `identifyUserRole(...)` and before the controller, in
  `customer.routes.ts` (POST customers), `staff.routes.ts` (POST staff/invite), `supply-list.routes.ts`
  (POST supply-lists). One line each; do not reorder existing middleware.

#### Stream H: Tests
**Files owned**: `src/modules/subscription/__tests__/**`, `tests/integration/subscription.test.ts`
**Skills**: `testing-strategy.md`
**Depends on**: all prior streams

- **Task H1** — Unit: VOs (`PlanTier.isHigherThan`, `PlanLimits.allows`/unlimited, `Money` guards),
  `VendorSubscriptionEntity` transitions + invariants (upgrade-tier guard, cancel idempotency,
  expire), `ProrataCalculator` (free-plan, zero-days, floor-at-0 edge cases), mapper whitelist.
- **Task H2** — Unit: each command/query with mocked ports (upgrade happy + same/lower-tier 422,
  renew-from-expired, cancel-already-cancelled 422, get-subscription utilization & canAddMore,
  usage service counts). Mock `IPaymentGateway`/`IUsageCounter`.
- **Task H3** — Integration (`tests/integration/subscription.test.ts`): HTTP lifecycle for all 8
  endpoints, auth/RBAC (staff 403 on manage), multi-tenant 404 mask, correlationId in errors, and
  the **451** enforcement on POST customers/staff/supply-lists at limit (seed a vendor at Starter
  limit). Verify unlimited (Pro) never 451s.

---

## Implementation order summary
Phase 1 (A, B, C parallel) → Phase 2 (D, E parallel) → Phase 3 (F, then G, then H; F before G before H).
Within Phase 3, F and the query/command set must land before G wires the composition root, and H runs last.

## Definition of Done (backend)
- All 8 endpoints + 451 enforcement implemented and documented in Swagger.
- Migration applies cleanly incl. partial-unique active index; seed runs idempotently with 3 plans +
  dev Starter subscription + invoices.
- Canonical SQL file updated with `subscription_invoices`.
- Lint + build pass (husky gate). Unit + integration tests green.
- `PROGRESS_TRACKER.md` US-009 moved to In Progress (Architect) → Completed when PRs open.
