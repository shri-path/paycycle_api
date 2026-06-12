# Feature: Subscription & Pricing Management (US-009)

> Branch: `feat/us-009-subscription-pricing` · Slug: `us-009-subscription-pricing`
> Canonical DB: `project_documents/db-design/14-vendor-subscriptions.sql`

This plan governs implementation. Where a skill disagrees with this plan, **the plan wins**
(escalate to the Architect). All money is INR with 2-decimal precision; all IDs serialize as
strings (BigInt). Every error response carries a `correlationId`.

---

## Complexity Assessment

- **Tier**: **Complex**
- **Justification**:
  - A genuine **platform-billing bounded context** distinct from the customer-billing domain
    (US-008's "subscription" = customer↔supply-list enrollment; this US-009 "subscription" =
    vendor↔platform plan). Naming collision must be firewalled (see Bounded Context section).
  - Owns a small **state machine** (`TRIAL → ACTIVE → PAST_DUE → EXPIRED`, plus `CANCELLED`),
    with non-trivial transitions (upgrade, renew, cancel, expire, auto-renew).
  - Introduces **cross-cutting limit-enforcement middleware** that other modules
    (customer, staff, supply-list) depend on — a new shared infrastructure concern.
  - **Pro-rata money calculation** with edge cases (day-boundary, unlimited plans, free tier).
  - **Two cron jobs** with lifecycle side effects.
  - A pure **`UsageQueryService`** that reads across three other modules' tables (read-only,
    by ID — no cross-aggregate object imports).
- **Directory Structure** (per `ddd-module-design.md`; `commands/` + `queries/` are mandatory):

```
src/modules/subscription/
├── subscription.controller.ts
├── subscription.routes.ts            # composition root
├── subscription.validator.ts         # Zod schemas
├── subscription.types.ts             # DTOs (response whitelist)
├── subscription.mapper.ts            # toDomain / toResponse
├── subscription.cron.ts              # gated behind ENABLE_CRON=true
├── domain/
│   ├── subscription.entity.ts        # VendorSubscriptionEntity (aggregate root)
│   ├── plan.entity.ts                # SubscriptionPlanEntity
│   ├── subscription.errors.ts
│   ├── subscription.types.ts         # domain enums/types (framework-free)
│   ├── value-objects/
│   │   ├── plan-tier.vo.ts           # ordering: STARTER < GROWTH < PRO
│   │   ├── billing-cycle.vo.ts
│   │   ├── plan-limits.vo.ts         # maxCustomers/maxStaff/maxSupplyLists (0 = unlimited)
│   │   └── money.vo.ts               # INR amount guard (>= 0, 2dp)
│   └── events/
│       ├── subscription-upgraded.domain-event.ts
│       ├── subscription-renewed.domain-event.ts
│       ├── subscription-cancelled.domain-event.ts
│       └── subscription-expired.domain-event.ts
├── database/
│   ├── subscription.repository.port.ts
│   ├── subscription.repository.ts    # Prisma adapter
│   ├── plan.repository.port.ts
│   └── plan.repository.ts
├── services/
│   ├── usage-query.service.ts        # live counts (read-only, cross-module by ID)
│   └── prorata.calculator.ts         # pure money math
├── commands/
│   ├── assign-starter-plan/          # called on vendor signup (port-exposed)
│   ├── upgrade-subscription/
│   ├── renew-subscription/
│   ├── cancel-subscription/
│   ├── set-auto-renewal/
│   └── expire-or-renew-due/          # cron worker command
└── queries/
    ├── list-plans/
    ├── get-vendor-subscription/      # plan + live usage + utilization + canAddMore
    ├── list-invoices/
    └── list-subscription-history/

src/infrastructure/middlewares/subscription/
└── enforce-subscription-limit.ts     # enforceSubscriptionLimit('customers'|'staff'|'supplyLists')

src/modules/subscription/ports/
└── usage-counter.port.ts             # interface UsageQueryService implements
```

---

## Bounded Context

**Context name**: `Platform Subscription & Billing` (vendor-as-tenant billing).

**Critical naming firewall** — the word "subscription" is overloaded:
| Term in this module | Meaning | Term elsewhere |
|---|---|---|
| `VendorSubscription` | vendor ↔ platform plan (this US) | — |
| `SupplyListCustomer` | customer ↔ supply-list enrollment (US-005/US-008) | confusingly called "subscription" in customer module DTOs |

This module **never** imports the customer module's subscription types. The `UsageQueryService`
counts `SupplyListCustomer` rows but treats them only as opaque "supplyLists usage".

**Upstream dependencies** (consumed by ID, read-only):
- `vendors` (tenant), `vendor_customers`, `vendor_users`, `supply_lists`.

**Downstream consumers**:
- customer / staff / supply-list modules consume the `enforceSubscriptionLimit` middleware.
- vendor signup flow consumes the `AssignStarterPlanCommand` via a port.

---

## Domain Model

### Aggregates

1. **SubscriptionPlan** (aggregate root: `SubscriptionPlanEntity`)
   - Reference data, seeded. Read-mostly. No vendor scoping.
   - Holds `PlanTier`, `PlanLimits` VO, monthly/yearly `Money`, `features` (JSON flags), `isActive`.

2. **VendorSubscription** (aggregate root: `VendorSubscriptionEntity`)
   - Owns its **history rows** (`vendor_subscription_history`) and **invoices**
     (`subscription_invoices`, net-new — see OQ-1) within the aggregate boundary.
   - References `SubscriptionPlan` **by ID only** (`subscriptionPlanId`), never an object relation.
   - References `vendorId` by ID. Lifecycle/state machine lives here.

> History and invoices are written **only** through the `VendorSubscription` aggregate root
> (no standalone history/invoice command). They are append-only.

### Value Objects

| VO | Rules / Guard |
|---|---|
| `PlanTier` | enum `STARTER` `GROWTH` `PRO`; exposes `rank()` (0/1/2) and `isHigherThan(other)`. Derived from `plan_code`. |
| `BillingCycle` | enum `MONTHLY` `YEARLY`. `days()` → 30 / 365 (billing-period length used for pro-rata). |
| `PlanLimits` | `{ maxCustomers, maxStaff, maxSupplyLists }`, each integer ≥ 0; **`0` = unlimited** (canonical). `isUnlimited(resource)`, `allows(resource, currentCount)`. |
| `Money` | non-negative, 2-dp INR amount. Guards: `>= 0`, `<= 99999999.99`. `multiply`, `subtract` (floor at 0). |
| `DateRange` | `{ startDate, endDate }`; `end >= start`; `daysRemaining(from)` (inclusive of `from`, never negative). |

### Entities

**`SubscriptionPlanEntity`** — props: `id`, `planName`, `planCode`, `tier: PlanTier`,
`priceMonthly: Money`, `priceYearly: Money | null`, `limits: PlanLimits`, `features: Record<string,bool>`,
`isActive`. Factory: `fromPersistence(row)`. No mutators (reference data).

**`VendorSubscriptionEntity`** (root) — props: `id`, `vendorId`, `subscriptionPlanId`,
`billingCycle: BillingCycle`, `startDate`, `endDate | null` (**null = currently active** — canonical),
`nextBillingDate | null`, `status`, `amountPaid: Money`, `autoRenewal`, `isTrial`, `trialEndsAt | null`.

Factory methods (each emits a domain event + a history event):
- `static createStarter(vendorId, plan, today)` → `status=ACTIVE`, `billingCycle=MONTHLY`,
  `start=today`, `end=null`, `nextBilling=today+30d`, `amountPaid=0`. Emits `CREATED`.
- `upgradeTo(newPlan, billingCycle, today, prorataAmount)` — guards `newPlan.tier.isHigherThan(current)`;
  closes current period (`endDate=today`, `status=CANCELLED`) and produces a **new** entity for the
  new plan starting `today`. Emits `UPGRADED`. (Old + new persisted in one transaction.)
- `renew(billingCycle, today, amount)` — extends: new period `start=prevEnd or today`,
  `end=null`, `nextBilling=start+cycle.days()`, `status=ACTIVE`, `amountPaid=amount`. Emits `RENEWED`.
- `cancel(today)` — `status=CANCELLED`, `autoRenewal=false`; **stays usable until `nextBillingDate`**
  (does not null `endDate` immediately). Emits `CANCELLED`.
- `expire(today)` — `status=EXPIRED`, `endDate=today`. Emits `EXPIRED`.
- `setAutoRenewal(flag)` — toggles only.

**Invariants** (enforced in entity, not service):
1. Only **one** `status=ACTIVE|TRIAL|PAST_DUE` subscription per vendor at a time
   (enforced by repo partial-unique + entity transition discipline).
2. Upgrade target tier must be strictly higher than current (`UnprocessableEntityError` otherwise).
3. Cannot renew/upgrade an `EXPIRED` subscription via the active-subscription path —
   renew on an expired vendor creates a fresh ACTIVE period (treated as re-activation).
4. `amountPaid >= 0`; pro-rata amount never negative (floor at 0).
5. Cancel is idempotent-guarded: cancelling an already-`CANCELLED` sub → `UnprocessableEntityError`.

### Domain Events

| Event | Triggered when | Consumed by (this iteration) |
|---|---|---|
| `SubscriptionCreatedEvent` | starter assigned / renew-from-expired | history row `CREATED`; (future: welcome notification) |
| `SubscriptionUpgradedEvent` | upgrade succeeds | history row `UPGRADED`; invoice generated |
| `SubscriptionRenewedEvent` | manual or auto renew | history row `RENEWED`; invoice generated |
| `SubscriptionCancelledEvent` | cancel | history row `CANCELLED` |
| `SubscriptionExpiredEvent` | cron expiry | history row `EXPIRED`; (future: expiry notification — log-stub) |

> History rows are the **durable** projection of these events (table
> `vendor_subscription_history`). In this iteration events are handled **in-process,
> synchronously, inside the same transaction** as the state change (no event bus yet) —
> consistent with the delivery module's approach.

### Aggregate Boundaries (owned vs referenced)

- `VendorSubscription` **owns**: its `vendor_subscription_history` rows, its
  `subscription_invoices` rows.
- `VendorSubscription` **references by ID**: `subscriptionPlanId`, `vendorId`,
  `performedByUserId`.
- `UsageQueryService` reads `vendor_customers`, `vendor_users`, `supply_lists` **by `vendorId`
  only** — counts, never hydrates those aggregates.

---

## API Endpoints

All under `/api/v1`. Auth = Bearer JWT on every endpoint. Mount: a **new** `subscriptionRoutes`
router added to `app.ts`. The plan-list endpoint is **not** vendor-scoped; the rest are nested
under `/vendors/:vendorId/subscription`. `vendorId` is resolved via `identifyUserRole('vendorId')`
(wrong tenant → 404 mask). Owner-only endpoints add `requireOwnerRole()`.

| # | Method | Path | CQS | Auth | Permission |
|---|--------|------|-----|------|-----------|
| 1 | GET | `/subscription-plans` | Query | any active member | authenticated (no specific perm) |
| 2 | GET | `/vendors/:vendorId/subscription` | Query | owner or staff | `subscription:read` |
| 3 | POST | `/vendors/:vendorId/subscription/upgrade` | Command | owner only | `subscription:manage` |
| 4 | POST | `/vendors/:vendorId/subscription/renew` | Command | owner only | `subscription:manage` |
| 5 | POST | `/vendors/:vendorId/subscription/cancel` | Command | owner only | `subscription:manage` |
| 6 | PATCH | `/vendors/:vendorId/subscription/auto-renewal` | Command | owner only | `subscription:manage` |
| 7 | GET | `/vendors/:vendorId/subscription/invoices` | Query | owner only | `subscription:read` |
| 8 | GET | `/vendors/:vendorId/subscription/history` | Query | owner only | `subscription:read` |

Request/response shapes, validation, and error codes are fully specified in **`API_SPEC.md`**.
Validation patterns (per `validation-schemas.md`):
- mutations → `.strict()` Zod object schemas; `billingCycle`/enums via `z.enum([...])` (uppercase);
- `newPlanId` is a numeric-string id;
- query endpoints → `.passthrough()` for pagination params (`page`, `limit`).

### Limit-Enforcement Middleware

`enforceSubscriptionLimit(resource: 'customers' | 'staff' | 'supplyLists'): RequestHandler`

- **Placement**: runs **after** `identifyUserRole('vendorId')` (needs `req.roleContext.vendorId`)
  and **before** the controller, on these existing routes:
  - `POST /vendors/:vendorId/customers` → `enforceSubscriptionLimit('customers')`
  - `POST /vendors/:vendorId/staff/invite` → `enforceSubscriptionLimit('staff')`
  - `POST /vendors/:vendorId/supply-lists` → `enforceSubscriptionLimit('supplyLists')`
- **Behaviour** (stateless, live counts each call):
  1. Load the vendor's active subscription (`status IN (ACTIVE, TRIAL, PAST_DUE)`, `endDate IS NULL`)
     + its plan limits.
  2. If `PlanLimits.isUnlimited(resource)` → `next()`.
  3. Compute live count via `UsageQueryService`.
  4. If `count < max` → `next()`; else respond **451**:
     ```json
     {
       "success": false,
       "error": {
         "code": "SUBSCRIPTION_LIMIT_REACHED",
         "message": "Your current plan allows up to 20 customers. Please upgrade to add more.",
         "correlationId": "uuid",
         "upgradeUrl": "/subscription/upgrade",
         "limits": { "max": 20, "current": 20 }
       }
     }
     ```
- **Fail-open vs fail-closed**: if **no** active subscription exists (data gap, never expected once
  signup auto-assigns), the middleware **fails open** (`next()`) and logs a warning with
  `correlationId` — it must never block core writes due to a billing-data inconsistency. (See OQ-8.)
- A dedicated error class `SubscriptionLimitReachedError extends AppError` (status 451,
  code `SUBSCRIPTION_LIMIT_REACHED`) carries `details = { upgradeUrl, limits }`. The global
  error handler already serializes `details`; the FE reads `error.details` (or top-level — see
  API_SPEC for exact envelope shape).

---

## Data Model Changes

Prisma models added to `prisma/schema.prisma` (maps to canonical SQL; **reconciliation applied**).
All FK indexes, `createdAt`, `vendorId` indexed. Enums via Prisma `enum` (UPPERCASE).

### `SubscriptionPlan` → `subscription_plans`
| Field | Type | Notes |
|---|---|---|
| `id` | BigInt PK | |
| `planName` | String(50) | "Starter" |
| `planCode` | String(20) **unique** | "STARTER" / "GROWTH" / "PRO" (tier source) |
| `priceMonthly` | Decimal(10,2) | |
| `priceYearly` | Decimal(10,2)? | |
| `maxCustomers` | Int default 0 | **0 = unlimited** |
| `maxStaff` | Int default 0 | 0 = unlimited |
| `maxSupplyLists` | Int default 0 | 0 = unlimited |
| `features` | Json? | flag map |
| `isActive` | Boolean default true | indexed |
| `createdAt`/`updatedAt` | DateTime | |

> No `deletedAt` — plans are deactivated via `isActive=false` (reference data, canonical has no
> soft-delete column). Documented deviation from the "every model has deletedAt" default; acceptable
> for seeded reference data.

### `VendorSubscription` → `vendor_subscriptions`
Mirrors canonical exactly. Key fields: `vendorId` (FK→vendors, indexed), `subscriptionPlanId`
(FK→plans, indexed), `billingCycle` enum, `startDate` Date, `endDate` Date? (**null = active**),
`nextBillingDate` Date? (indexed), `status` enum (indexed), `amountPaid` Decimal(10,2) default 0
(check ≥ 0), `autoRenewal` Boolean default true, `isTrial` Boolean default false, `trialEndsAt` Date?.
Add composite index `@@index([vendorId, status])` for the active-sub lookup.

> **Partial-unique active constraint** (invariant #1): Prisma cannot express a partial unique index
> in `schema.prisma`. The Dev agent must add it via a **raw SQL** statement in the migration:
> `CREATE UNIQUE INDEX uq_vendor_active_subscription ON vendor_subscriptions(vendor_id) WHERE status IN ('TRIAL','ACTIVE','PAST_DUE') AND end_date IS NULL;`
> This is a hard DB guarantee against double-active subscriptions.

### `VendorSubscriptionHistory` → `vendor_subscription_history`
Mirrors canonical. `vendorSubscriptionId` FK (cascade), `eventType` enum, `oldPlanId`?, `newPlanId`?,
`reason`?, `performedByUserId`?, `createdAt` indexed. **Append-only**.

### `SubscriptionInvoice` → `subscription_invoices` (NET-NEW — see OQ-1)
Architect decision: **add the table** (billing history is an explicit acceptance criterion and a
wireframe section). Reconciled field set (BigInt PKs, uppercase enums):

| Field | Type | Notes |
|---|---|---|
| `id` | BigInt PK | |
| `vendorSubscriptionId` | BigInt FK→vendor_subscriptions (cascade) | indexed; aggregate-owned |
| `vendorId` | BigInt FK→vendors | indexed (vendor-scoped queries) |
| `invoiceNumber` | String(50) **unique** | format `INV-YYYY-MM-<seq>` (see OQ-9) |
| `amount` | Decimal(10,2) | pre-tax |
| `tax` | Decimal(10,2) default 0 | |
| `totalAmount` | Decimal(10,2) | amount + tax |
| `invoiceDate` | Date | |
| `dueDate` | Date | |
| `paymentStatus` | enum `PAID`/`PENDING`/`OVERDUE` default `PENDING` | indexed |
| `paymentDate` | Date? | |
| `paymentMethod` | String(50)? | |
| `paymentReference` | String(100)? | |
| `createdAt`/`updatedAt` | DateTime | |

New enum: `invoice_payment_status` (`PAID`,`PENDING`,`OVERDUE`).

> Canonical `14-vendor-subscriptions.sql` must be **updated** to add this table (the SQL is the
> source of truth). The Dev agent adds it to the SQL file in the same task as the Prisma model.
> See OQ-1.

### Seed data plan
- **Permissions** (`prisma/seeds/index.ts`): `subscription:manage` and `subscription:read`
  already exist in the catalog (lines 39 & 45). Add `subscription:read` to the **staff** role
  subset (currently staff has `subscription:read` from US-005 — confirm it remains; it maps to
  customer subscriptions read, but the same key gates GET subscription view for staff, which is
  desired). No new permission rows needed.
- **Plans** (new `seedSubscriptionPlans()` in `prisma/seeds/index.ts`, idempotent upsert by
  `planCode`): STARTER / GROWTH / PRO per the table below (`0 = unlimited`):

| code | name | maxCustomers | maxStaff | maxSupplyLists | priceMonthly | priceYearly | key features |
|---|---|---|---|---|---|---|---|
| STARTER | Starter | 20 | 1 | 5 | 0.00 | null | basic_delivery_tracking, customer_management |
| GROWTH | Growth | 150 | 3 | 10 | 499.00 | 4990.00 | + staff_management, analytics, whatsapp_notifications, credit_control |
| PRO | Pro | 0 | 0 | 0 | 999.00 | 9990.00 | + advanced_reports, api_access, priority_support |

- **Dev subscription**: in the non-production block, after the test vendor is created, call
  `AssignStarterPlanCommand` (or a direct upsert) so the dev vendor has an ACTIVE Starter
  subscription + one `CREATED` history row. Add 1–2 faker invoices (one PAID, one PENDING) for
  billing-history UI.

---

## Business Rules

### State machine (`vendor_subscription_status`)
```
            createStarter / renew-from-expired
                     │
        ┌────────────▼────────────┐
        │          ACTIVE         │◄──── renew ────┐
        └───┬───────┬─────────┬───┘                │
   upgrade  │       │ cancel  │ payment-fail       │
 (new ACTIVE│       ▼         ▼ (future)           │
  row; old →│   CANCELLED   PAST_DUE ──renew───────┘
  CANCELLED)│   (usable      │
            │    till end)   │ grace lapses (cron)
            ▼                ▼
       (new ACTIVE)       EXPIRED ──renew──► ACTIVE (fresh period)
```
- **TRIAL**: schema-supported (`isTrial`, `trialEndsAt`) but **not exercised** this iteration
  (OQ-7). Treated identically to ACTIVE for limit enforcement.
- **PAST_DUE**: reserved for the real-payment future; with stubbed payments (OQ-2) renew/upgrade
  go straight to ACTIVE. The expiry cron may set EXPIRED directly when `autoRenewal=false`.

Valid transitions: ACTIVE→{CANCELLED, EXPIRED, ACTIVE(via upgrade/renew)}, CANCELLED→ACTIVE(renew),
EXPIRED→ACTIVE(renew). **Invalid** (→ `UnprocessableEntityError`): cancel an already-CANCELLED;
upgrade to same/lower tier; upgrade/renew when no plan row resolvable.

### Cross-aggregate validation
- Upgrade/renew/view never touch customer/staff/supply-list aggregates except via the read-only
  `UsageQueryService` (counts by `vendorId`).
- `newPlanId` must resolve to an `isActive=true` plan, else `NotFoundError('Plan not found')`.

### Multi-tenant isolation
- All `/vendors/:vendorId/...` endpoints rely on `identifyUserRole` → wrong-tenant or no-membership
  is **masked as 404** (never 403/leak). The subscription repo additionally scopes every query by
  `vendorId`; a subscription belonging to another vendor is returned as `null` → `NotFoundError`.

### Pro-rata (formula + edge cases) — see OQ-3
On a **mid-cycle upgrade** the vendor pays the price difference for the **unused** remaining days:
```
dailyRateNew      = newPlan.price(cycle) / cycle.days()        // 30 or 365
dailyRateCurrent  = currentPlan.price(cycle) / cycle.days()
daysRemaining     = max(0, nextBillingDate - today)            // inclusive of today
prorataAmount     = round2( max(0, (dailyRateNew - dailyRateCurrent) * daysRemaining) )
```
Edge cases:
- Current plan is **free** (Starter, price 0) → `dailyRateCurrent = 0`, so vendor pays the full
  pro-rated cost of the new plan for remaining days.
- `nextBillingDate` null or in the past → `daysRemaining = 0` → `prorataAmount = 0` (upgrade is free
  this period; new full price applies at next renewal).
- New plan cheaper per-day than current (shouldn't happen on an upgrade, but guarded) → floor at 0.
- Result rounded to 2 dp (banker's rounding not required; standard `Math.round(x*100)/100`).

### Subscription on vendor signup — see OQ-4
A new vendor is auto-assigned the **Starter** plan. The creation logic lives in **this** module as
`AssignStarterPlanCommand`, exposed via a port the vendor-signup flow calls (recommendation in OQ-4).

---

## Sequence Diagrams (text-based)

### Upgrade (mid-cycle)
```
Controller.upgrade
  → validate body (Zod strict: newPlanId, billingCycle)
  → UpgradeSubscriptionCommand.execute({vendorId, newPlanId, billingCycle, performedByUserId})
       repo.findActiveByVendor(vendorId)            ── null → SubscriptionNotFoundError
       planRepo.findActiveById(newPlanId)           ── null → PlanNotFoundError
       current.tier vs new.tier                     ── !higher → InvalidPlanUpgradeError(422)
       prorata = ProrataCalculator.compute(current, new, cycle, today)   [pure]
       repo.transaction:
           old = current.cancelForUpgrade(today)    → status CANCELLED, endDate today
           new = VendorSubscriptionEntity.upgradeTo(...)  → new ACTIVE row
           repo.closeAndOpen(oldEntity, newEntity)  (toPersistence ×2)
           repo.appendHistory(UPGRADED, oldPlanId, newPlanId, performedBy)
           invoice = InvoiceFactory.forUpgrade(new, prorata, today)
           repo.insertInvoice(invoice.toPersistence())
       → mapper.toUpgradeResponse(newEntity, plan, invoice)  // includes stub paymentUrl
  → sendSuccess(res, dto)
```

### Get vendor subscription (plan + live usage)
```
Controller.getSubscription
  → GetVendorSubscriptionQuery.execute({vendorId})
       repo.findActiveByVendor(vendorId) + plan      ── null → SubscriptionNotFoundError
       usage = UsageQueryService.countAll(vendorId)   // 3 live COUNT queries (parallel)
       util  = utilization(usage, plan.limits)        // 0 when unlimited
       canAddMore = limits.allows(...) per resource
  → mapper.toSubscriptionViewDto(sub, plan, usage, util, canAddMore)
```

### Enforce limit (middleware on POST customers)
```
authenticateToken → validate → identifyUserRole('vendorId') →
  enforceSubscriptionLimit('customers'):
     sub = subscriptionRepo.findActiveByVendor(ctx.vendorId)  ── null → log warn, next() (fail-open)
     if limits.isUnlimited('customers') → next()
     current = UsageQueryService.countCustomers(vendorId)
     if current < max → next()
     else → next(new SubscriptionLimitReachedError({max, current}))   // 451
→ controller.createCustomer
```

### Expiry cron (01:00 daily)
```
ExpireOrRenewDueCommand.run(today):
  due = repo.findDueSubscriptions(today)   // status ACTIVE, nextBillingDate <= today, endDate null
  for sub in due:
     if sub.autoRenewal:                     // stubbed payment = always "succeeds"
        renewed = sub.renew(cycle, today, plan.price)
        repo.persist + appendHistory(RENEWED)
        log "auto-renewed" (notification = log-stub)
     else:
        expired = sub.expire(today)
        repo.persist + appendHistory(EXPIRED)
        log "expired" (notification = log-stub)
```

---

## Strategy Interfaces (external services)

**Payment** is **stubbed** this iteration (OQ-2). Define the seam now so real integration is a drop-in:
```ts
// services/payment/payment-gateway.port.ts
export interface IPaymentGateway {
  createCheckout(input: { vendorId: bigint; invoiceId: bigint; amount: number; currency: 'INR' })
    : Promise<{ paymentUrl: string; gatewayRef: string }>;
}
// StubPaymentGateway → returns { paymentUrl: `https://payment.paycycle.app/invoice/${invoiceId}`, gatewayRef: `stub_${uuid}` }
```
Wired in the composition root; commands depend on the **port**. Real Razorpay/Stripe adapter +
webhook handler are deferred (OQ-2). No webhook route this iteration.

---

## Error Handling Strategy

New error classes in `domain/subscription.errors.ts` (extend `app-error` base classes):

| Operation | Error class | HTTP | code |
|---|---|---|---|
| Active sub not found | `SubscriptionNotFoundError extends NotFoundError` | 404 | `NOT_FOUND` |
| Plan id not found / inactive | `PlanNotFoundError extends NotFoundError` | 404 | `NOT_FOUND` |
| Upgrade to same/lower tier | `InvalidPlanUpgradeError extends UnprocessableEntityError` | 422 | `UNPROCESSABLE_ENTITY` |
| Cancel already-cancelled | `SubscriptionAlreadyCancelledError extends UnprocessableEntityError` | 422 | `UNPROCESSABLE_ENTITY` |
| Renew while ACTIVE not yet due (optional guard) | allowed (creates next period) — no error | — | — |
| Limit reached (middleware) | `SubscriptionLimitReachedError extends AppError(451,'SUBSCRIPTION_LIMIT_REACHED')` | 451 | `SUBSCRIPTION_LIMIT_REACHED` |
| Wrong tenant | masked → `SubscriptionNotFoundError` / `identifyUserRole` 404 | 404 | `NOT_FOUND` |
| Prisma P2002 (active-sub partial unique) | caught in adapter → `ConflictError('Subscription already active')` | 409 | `CONFLICT` |

State-transition errors are thrown **inside the entity** (domain), caught by the command, surfaced
by the global error handler. Multi-tenant masking: never reveal another vendor's subscription —
return 404. All error responses include `correlationId` (added by the existing error handler).

---

## Security Considerations
- All write/manage endpoints are **owner-only** (`requireOwnerRole()`); staff get 403 on
  upgrade/renew/cancel/auto-renewal/invoices/history (they keep read access to the GET subscription
  view per the wireframe usage UI).
- `vendorId` is taken from `req.roleContext`, never trusted from the body.
- The plan-list endpoint exposes only `isActive=true` plans and no vendor data.
- `upgradeUrl` is a **relative path** (`/subscription/upgrade`) — never an absolute attacker-set URL.
- Idempotency on upgrade: the partial-unique active-subscription index + transaction prevents
  duplicate active rows from double-submit (OQ addresses an optional idempotency key — see OQ-10).

## Performance Considerations
- `UsageQueryService` runs 3 indexed `COUNT` queries (on `vendor_customers(vendorId,status)`,
  `vendor_users(vendorId,status)`, `supply_lists(vendorId,isActive,deletedAt)`) — all covered by
  existing composite indexes. Run them in parallel (`Promise.all`).
- Active-subscription lookup uses `@@index([vendorId, status])` + `endDate IS NULL`.
- Invoices/history lists are paginated (`page`/`limit`, default 20, max 50) and ordered by
  `createdAt DESC` (indexed).
- The enforcement middleware adds **one** active-sub query + at most **one** count query per write —
  acceptable for the low write-rate (create customer / invite staff / create list).

---

## Open Questions (with recommendation + trade-off)

> Per memory `feedback_architect_open_questions`, each carries a recommendation. In auto mode,
> proceed with the recommendation; these are surfaced for the user's awareness.

**OQ-1 — `subscription_invoices` table: add net-new or skip in MVP?**
*Recommendation*: **Add the table now.** Billing history is an explicit acceptance criterion and a
wireframe section; modelling invoices later would force a migration + retro-fitting upgrade/renew
flows. Trade-off: more surface area now, but PDF generation and real payment status stay stubbed,
so cost is small. Canonical SQL file `14-vendor-subscriptions.sql` is updated to include it.

**OQ-2 — Payment gateway: integrate Razorpay/Stripe now or stub?**
*Recommendation*: **Stub now** behind `IPaymentGateway`; return a fake `paymentUrl` and mark
invoices `PENDING` (or `PAID` on free/zero-amount). Trade-off: no real money movement this
iteration; FE must treat `paymentUrl` as a placeholder. Real integration + webhook is a follow-up
US (the port makes it a drop-in). **Open for user**: confirm we defer real payments.

**OQ-3 — Pro-rata algorithm**: documented above (days-remaining × daily-rate-difference, floored at 0,
2-dp). *Recommendation*: ship this formula. Trade-off: simple, predictable; ignores partial-day and
yearly-vs-monthly switch mid-cycle (a cycle change on upgrade resets the period rather than
converting). Acceptable for MVP. **Open for user**: confirm "switch cycle on upgrade = new full
period" is acceptable.

**OQ-4 — Which bounded context owns auto-assign-Starter on signup?**
*Recommendation*: **This subscription context owns it** (`AssignStarterPlanCommand`), exposed via a
port that the vendor-signup flow invokes. Rationale: keeps all subscription lifecycle + history +
invariants in one aggregate; vendor module stays free of billing rules. Trade-off: vendor signup
gains a dependency on the subscription port (acceptable — it already composes multiple services).
*Note*: there is no live vendor self-signup endpoint in the repo yet; for now the hook is wired into
the **seed** and exposed as a reusable command for whenever signup lands. **Open for user**: confirm
no existing signup path needs retrofitting.

**OQ-5 — Downgrade mid-cycle: enforced or just not UI-exposed?**
*Recommendation*: **Enforced server-side.** The upgrade endpoint rejects same/lower tier with
`InvalidPlanUpgradeError` (422). There is **no** downgrade endpoint this iteration. Trade-off:
vendors cannot self-downgrade until a future "scheduled plan change at next billing" feature; this
matches the story ("not allowed mid-cycle"). **Open for user**: confirm we ship no downgrade path.

**OQ-6 — Usage counts: live query or `usage_limits` materialised cache?**
*Recommendation*: **Live queries** (`UsageQueryService`), no `usage_limits` table. Rationale:
eliminates an entire class of staleness bugs (the story's own edge cases #4/#5 are cache-sync
hazards); counts are cheap and indexed. Trade-off: a few extra COUNT queries per read/write — far
cheaper than cache-invalidation correctness. The canonical schema already omits `usage_limits`,
so this aligns. **Decided** (no user action needed).

**OQ-7 — Trial period (14-day): support now or defer?**
*Recommendation*: **Schema-ready, behaviour-deferred.** The `isTrial`/`trialEndsAt` columns exist
(canonical) and the entity carries them, but no trial is started this iteration (Starter is a free
ACTIVE plan, which covers the "free tier" need without trial mechanics). Trade-off: trial
onboarding UX is a later US; no migration needed when we enable it. **Decided.**

**OQ-8 — Enforcement middleware when no active subscription exists: fail-open or fail-closed?**
*Recommendation*: **Fail-open + warn-log.** Once signup auto-assigns Starter this never happens; a
billing-data gap must not block a vendor from adding customers (core function). Trade-off: a
mis-seeded vendor could exceed limits silently — caught by the warning log + the daily cron. **Open
for user**: confirm fail-open is the desired safety bias.

**OQ-9 — Invoice number format & sequence source.**
*Recommendation*: `INV-YYYY-MM-<zero-padded-seq>` where `<seq>` is a per-month counter derived from
`COUNT(invoices this month) + 1` inside the same transaction. Trade-off: not globally monotonic and
has a tiny race window under concurrency, mitigated by the `unique(invoiceNumber)` constraint +
retry. Good enough for MVP volume. **Open for user**: confirm format; a DB sequence is the
hardened alternative.

**OQ-10 — Idempotency key on upgrade (story edge case #9).**
*Recommendation*: **Rely on the partial-unique active-subscription index** this iteration rather
than a client idempotency key. Double-submit either no-ops (already on target plan → 422 same-tier)
or is blocked by the unique index (→ 409). Trade-off: no explicit idempotency-key header support;
add it with real payments (where charge-once matters). **Open for user**: confirm deferral.

**OQ-11 — Canonical vs story enum/column reconciliations**: applied as instructed — `0=unlimited`,
`auto_renewal`, `subscription_plan_id`, UPPERCASE enums, `end_date NULL = active`, BigInt PKs,
history table used for plan-change events, `subscription_invoices` added net-new. No open action;
recorded for traceability.
