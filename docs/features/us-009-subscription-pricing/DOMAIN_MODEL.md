# Domain Model — Subscription & Pricing Management (US-009)

Framework-free domain layer. Entities/VOs have **zero** Prisma/Express imports. Cross-aggregate
references are **by ID only**. `0 = unlimited` everywhere (canonical).

---

## Aggregate Map

```
            Platform Subscription & Billing  (bounded context)
 ┌──────────────────────────────────────────────────────────────────────────┐
 │                                                                            │
 │   ┌───────────────────────────┐        references by ID                   │
 │   │  «aggregate root»         │        (subscriptionPlanId)                │
 │   │  SubscriptionPlanEntity   │◄───────────────────────────┐              │
 │   │───────────────────────────│                            │              │
 │   │  id                       │                            │              │
 │   │  planName / planCode      │                            │              │
 │   │  tier:        PlanTier ───┼──vo                        │              │
 │   │  priceMonthly: Money  ────┼──vo                        │              │
 │   │  priceYearly:  Money? ────┼──vo                        │              │
 │   │  limits:      PlanLimits ─┼──vo                        │              │
 │   │  features: {flag:bool}    │                            │              │
 │   │  isActive                 │                            │              │
 │   │  (reference data, no mut.)│                            │              │
 │   └───────────────────────────┘                            │              │
 │                                                             │              │
 │   ┌─────────────────────────────────────────────────────────────────┐    │
 │   │  «aggregate root»  VendorSubscriptionEntity                      │    │
 │   │──────────────────────────────────────────────────────────────────│   │
 │   │  id                                                              │    │
 │   │  vendorId  ────────────────── ref by ID → Vendor (other context) │    │
 │   │  subscriptionPlanId ───────── ref by ID → SubscriptionPlan       │    │
 │   │  billingCycle:  BillingCycle ─vo                                  │    │
 │   │  period:        DateRange ────vo  (startDate, endDate|null)       │    │
 │   │  nextBillingDate: Date|null                                      │    │
 │   │  status:        VendorSubscriptionStatus (state machine)         │    │
 │   │  amountPaid:    Money ────────vo                                  │    │
 │   │  autoRenewal:   bool                                             │    │
 │   │  isTrial / trialEndsAt  (schema-ready, deferred)                 │    │
 │   │                                                                  │    │
 │   │  factory/behavior:                                               │    │
 │   │    createStarter() · upgradeTo() · renew() · cancel()            │    │
 │   │    · expire() · setAutoRenewal()                                 │    │
 │   │  emits: Created/Upgraded/Renewed/Cancelled/Expired events        │    │
 │   │                                                                  │    │
 │   │   owns (append-only, within aggregate boundary):                 │    │
 │   │   ┌──────────────────────────┐   ┌────────────────────────────┐ │    │
 │   │   │ VendorSubscriptionHistory│   │ SubscriptionInvoice         │ │    │
 │   │   │  eventType               │   │  invoiceNumber (unique)     │ │    │
 │   │   │  oldPlanId? newPlanId?   │   │  amount/tax/totalAmount     │ │    │
 │   │   │  reason? performedBy?    │   │  invoiceDate/dueDate        │ │    │
 │   │   │  createdAt (INSERT-only) │   │  paymentStatus              │ │    │
 │   │   └──────────────────────────┘   └────────────────────────────┘ │    │
 │   └──────────────────────────────────────────────────────────────────┘   │
 │                                                                            │
 │   ┌──────────────────────────────────────────────────────────────────┐   │
 │   │  «domain service» UsageQueryService  (read-only, by vendorId)     │   │
 │   │   countCustomers(vendorId)   → COUNT vendor_customers ACTIVE      │   │
 │   │   countStaff(vendorId)       → COUNT vendor_users staff ACTIVE    │   │
 │   │   countSupplyLists(vendorId) → COUNT supply_lists active          │   │
 │   │   (never hydrates those aggregates — counts only)                 │   │
 │   └──────────────────────────────────────────────────────────────────┘   │
 │                                                                            │
 │   ┌──────────────────────────────────────────────────────────────────┐   │
 │   │  «pure» ProrataCalculator.compute(current, new, cycle, today)     │   │
 │   │  «port» IPaymentGateway  (StubPaymentGateway impl this iteration) │   │
 │   │  «port» IUsageCounter    (UsageQueryService impl)                 │   │
 │   └──────────────────────────────────────────────────────────────────┘   │
 └──────────────────────────────────────────────────────────────────────────┘
```

---

## Value Objects

```
PlanTier            STARTER(0) < GROWTH(1) < PRO(2)
                    rank():number · isHigherThan(o):bool · fromCode(planCode):PlanTier

BillingCycle        MONTHLY | YEARLY
                    days(): 30 | 365

PlanLimits          { maxCustomers:int>=0, maxStaff:int>=0, maxSupplyLists:int>=0 }   // 0 = unlimited
                    isUnlimited(resource):bool
                    allows(resource, currentCount):bool      // unlimited → always true
                    max(resource):int

Money               INR, >=0, <=99999999.99, 2dp
                    multiply(n):Money · subtract(m):Money(floor 0) · round2()

DateRange           { startDate, endDate|null }   endDate null = currently active
                    daysRemaining(from):int>=0    contains(date):bool
```

---

## State Machine — VendorSubscriptionStatus

```
   [start]
      │ createStarter / renew-from-EXPIRED
      ▼
 ┌─────────┐  upgradeTo (old→CANCELLED, new ACTIVE)   ┌─────────┐
 │ ACTIVE  │ ───────────────────────────────────────► │ ACTIVE' │ (new plan)
 │         │ ◄───────────────── renew ──────────────── │  ...    │
 └──┬───┬──┘                                            └─────────┘
    │   │ cancel                  payment-fail (future)
    │   └────────────► CANCELLED        │
    │                  (usable until    ▼
    │                   nextBilling)  PAST_DUE ──renew──► ACTIVE
    │                       │            │
    │ cron expiry (auto=off)│            │ grace lapses (cron)
    ▼                       ▼            ▼
 EXPIRED  ◄──────────────────────────────
    │
    │ renew  →  fresh ACTIVE period
    ▼
 ACTIVE

 TRIAL : schema-ready, behaves as ACTIVE for limits; not started this iteration.
```

Transition guards (thrown in entity):
- `upgradeTo`  : target tier strictly higher → else `InvalidPlanUpgradeError` (422)
- `cancel`     : current status ∈ {ACTIVE, TRIAL, PAST_DUE} → else `SubscriptionAlreadyCancelledError` (422)
- `expire`     : only from a non-terminal status (idempotent on EXPIRED)
- amounts      : `amountPaid >= 0`, pro-rata floored at 0

---

## Domain Events → History projection

```
event                       → vendor_subscription_history.eventType
SubscriptionCreatedEvent    → CREATED
SubscriptionUpgradedEvent   → UPGRADED   (oldPlanId, newPlanId)
SubscriptionRenewedEvent    → RENEWED
SubscriptionCancelledEvent  → CANCELLED
SubscriptionExpiredEvent    → EXPIRED
```
Handled in-process, synchronously, inside the same DB transaction as the state change (no event bus
this iteration). History is the durable, append-only projection.

---

## Repository Ports (interfaces — domain depends on these, not Prisma)

```
ISubscriptionPlanRepository
  findAllActive(): Plan[]
  findActiveById(id): Plan | null

ISubscriptionRepository
  findActiveByVendor(vendorId, tx?): VendorSubscriptionRow | null     // status active & end_date null
  findDueSubscriptions(today, tx?): VendorSubscriptionRow[]           // ACTIVE & nextBilling <= today
  closeAndOpen(old: Entity, neu: Entity, tx?): {old,new}              // upgrade: 1 txn
  persist(entity, tx?): VendorSubscriptionRow                         // create/update
  appendHistory(input, tx?): void                                    // INSERT-only
  insertInvoice(input, tx?): InvoiceRow
  listInvoices(vendorId, page, limit, tx?): {rows, total}
  listHistory(vendorId, page, limit, tx?): {rows, total}
  transaction<T>(fn): Promise<T>

IUsageCounter   (implemented by UsageQueryService)
  countCustomers(vendorId): number
  countStaff(vendorId): number
  countSupplyLists(vendorId): number
  countAll(vendorId): { customers, staff, supplyLists }

IPaymentGateway (StubPaymentGateway)
  createCheckout({vendorId, invoiceId, amount, currency}): {paymentUrl, gatewayRef}
```

---

## Mapper contracts (`subscription.mapper.ts`)

```
toPlanDto(planRow)                              → PlanDto                       // list-plans
toSubscriptionViewDto(subRow, planRow, usage, util, canAddMore)  → SubscriptionViewDto   // GET subscription
toUpgradeResponseDto(newSubRow, planRow, invoiceRow, paymentUrl) → UpgradeResponseDto
toRenewResponseDto(subRow, planRow, invoiceRow, paymentUrl)      → RenewResponseDto
toInvoiceDto(invoiceRow)                        → InvoiceDto
toHistoryDto(historyRow, oldPlanName, newPlanName) → HistoryEventDto
toDomain(subRow)                                → VendorSubscriptionEntity
toPersistence(entity)                           → Prisma create/update input
```
Whitelist only: never spread raw rows into responses. All BigInt ids → strings; Decimal → number.
For staff calling GET subscription, money/plan fields stay (read view is allowed); manage/invoice/
history endpoints are owner-only at the route layer.
