# Domain Model: Credit Control & Outstanding Management (US-012)

## Complexity Assessment
- **Level**: Complex
- **Justification**: Introduces a new bounded context (`credit`) with two aggregates
  (`CustomerCreditSettings`, `ReminderConfig`), a non-trivial value object
  (`AgingBucket`), multiple read models that aggregate across the delivery, payment and
  customer modules, a cross-module reaction (credit-breach → block deliveries), a
  scheduled background sweep (auto reminders + prepaid low-balance), and an
  Anti-Corruption Layer over the messaging provider (Strategy pattern). It also has
  several invariants (limit transitions, prepaid rules) that warrant a real domain layer.
- **Architecture depth**: Full DDD (Aggregates, VOs, Domain Events, ports/adapters,
  vertical-sliced `commands/` and `queries/`).

---

## Critical Reconciliation Note (read before designing schema)

The shipped codebase **diverges** from the legacy `db-design` SQL (`09-billing.sql`,
`10-payments.sql`, `11-credit-management.sql`). Those files describe `monthly_bills`,
`account_balances`, an immutable `transactions` ledger, and `payments` keyed by
`vendor_customer_id`. **None of that was built.** The shipped reality (US-008) is:

| Concept | Legacy SQL design | **Shipped reality (authoritative)** |
|---|---|---|
| Balance | Stored on `account_balances.current_balance` | **Computed**: Σ billable `daily_supplies.final_amount` − Σ `payments.amount` (see `delivery-billing.adapter.ts`) |
| Payment FK | `payments.vendor_customer_id` | `payments.customer_id` + `payments.vendor_id` |
| Bills | `monthly_bills` table | No table — monthly totals computed on the fly per `YYYY-MM` |
| Credit limit | `credit_limits.credit_limit` | **`customers.credit_limit`** column (+ `CreditLimitVO`) — already shipped |
| Payment score | `account_balances.payment_efficiency_score` | **`customers.payment_score`** column (+ `PaymentScoreVO`) — already shipped |

**US-012 builds on the shipped reality.** We do **not** introduce `account_balances`,
`monthly_bills`, or `transactions`. We do **not** add a `credit_limit` column to the new
`customer_credit_settings` table (that would duplicate `customers.credit_limit`).

The US-012 user-story inline SQL also proposes duplicating `credit_limit`,
`payment_efficiency_score`, and `oldest_unpaid_bill_date` onto tables/columns that already
exist (or are computed). Those duplications are rejected — see Open Questions OQ-1, OQ-2.

---

## Ubiquitous Language

| Term | Definition |
|------|-----------|
| Outstanding | Positive customer balance (customer owes the vendor). Computed, never stored. |
| Advance credit | Negative customer balance (vendor owes / customer prepaid). |
| Net receivable | Σ outstanding − Σ advance credit across a vendor's customers. |
| Aging bucket | Classification of an outstanding balance by `daysOverdue`: `FRESH_0_30`, `OVERDUE_30_60`, `CRITICAL_60_PLUS`. |
| Days overdue | `CURRENT_DATE − oldestUnpaidServiceDate`, where the oldest unpaid service date is the earliest billable delivery date for a customer with a positive balance. |
| Credit type | `NORMAL` \| `PREPAID` \| `UNLIMITED`. Governs whether and how the limit is enforced. |
| Warning threshold | % of credit limit at which the customer is flagged "near limit". |
| Action on breach | `WARN` \| `PAUSE` \| `BLOCK` — what the system does when the limit is exceeded. |
| Payment efficiency score | 0–100 score from the last 20 paid intervals; on-time = paid within 7 days. Lives on `customers.payment_score`. |
| Collection priority | `HIGH` \| `MEDIUM` \| `LOW`, derived from days overdue + utilization. |
| Reminder | A logged message (WhatsApp/SMS/push, currently stub) nudging a customer to pay. |
| Reminder config | Per-vendor automation settings for reminders (schedule, template, exclusions). |

---

## Context Map: `credit` module

### Owned Concepts
- **CustomerCreditSettings**: per-customer credit policy (type, warning threshold, breach action). Owns nothing about the *amount* of the limit (that stays on Customer).
- **ReminderConfig**: per-vendor reminder automation policy.
- **PaymentReminder**: a record of a reminder that was (attempted to be) sent.
- **Read models**: Collections Dashboard, Priority List, Collection Analytics, Aging — all derived, not stored.

### Boundaries
- This module OWNS: credit policy, reminder policy, reminder records, and all
  collections/aging read models.
- This module DOES NOT OWN: the credit **limit amount** (Customer), the **payment score
  value** (Customer), **balances** (computed by Delivery/Payment via a port), **payments**
  (Customer/Payment), **deliveries** (Delivery).
- Module internals are PRIVATE — no other module imports `credit/*`; `credit` reaches other
  modules only through ports.

### Relationships
| Related Context | Relationship | Integration Pattern | Communication | Shared Data |
|----------------|-------------|--------------------|----------------|-------------|
| Auth | Upstream | Conformist | JWT claims (`userId`, `vendorId`, role) | userId, vendorId |
| Customer | Upstream/Downstream | Shared Kernel (IDs only) | Read via `CreditCustomerPort`; writes credit limit via existing customer command (not duplicated) | customerId, creditLimit, paymentScore |
| Delivery + Payment | Upstream | ACL via `CreditBalancePort` | Reuses the existing `getBulkBalances` / `getCustomerBalance` capability and a new `getOldestUnpaidServiceDate` | balances, oldest unpaid date, payment-mode breakdown |
| Delivery (write) | Downstream | ACL via `DeliveryControlPort` | On credit breach with `action = BLOCK/PAUSE`, pause customer deliveries | customerId |
| Messaging (WhatsApp/SMS) | External | ACL + Strategy | `ReminderNotificationPort` with a log-stub adapter (no real provider yet) | masked phone, message body |
| VendorSettings | Upstream | Conformist | Reads `defaultCreditLimit` to seed new credit settings (already shipped) | defaultCreditLimit |

### Cross-Module Communication Strategy
- **Reads** (dashboard, priority, analytics, aging): synchronous port calls into
  `CreditBalancePort` / `CreditCustomerPort` — these are query-side ACLs over existing
  Prisma aggregations, never importing the other modules' classes.
- **Credit-limit changes**: the credit module does NOT re-implement limit mutation. The
  existing `PATCH .../credit-limit` (customer module) remains the single writer of
  `customers.credit_limit`. The credit module's "set credit settings" command writes only
  the *policy* row (`customer_credit_settings`) and, when the limit amount also changes,
  delegates the amount write through `CreditCustomerPort.setCreditLimit()`.
- **Breach → block**: handled inline in the relevant command via `DeliveryControlPort`
  (synchronous, single customer, idempotent). A `CustomerCreditBreached` domain event is
  also emitted for audit/notification consumers.
- **Reminders**: emitted through `ReminderNotificationPort` (log-stub now; Strategy lets a
  real provider drop in later). Never throws into the request/cron path.

---

## Aggregates

### CustomerCreditSettings Aggregate
- **Root Entity**: `CustomerCreditSettingsEntity` (extends nothing; plain aggregate root, matching the project's existing entity style — private ctor + static `create`/`reconstitute` + `getProps`).
- **Nested Entities**: None.
- **Value Objects**: `CreditType`, `WarningThreshold`, `BreachAction`.
- **Invariants** (enforced in `validate()`):
  1. `warningThresholdPercent` ∈ [0, 100].
  2. `creditType` is one of `NORMAL | PREPAID | UNLIMITED`.
  3. `actionOnBreach` is one of `WARN | PAUSE | BLOCK`.
  4. If `creditType = UNLIMITED`, `actionOnBreach` is forced to `WARN` (a limit that is never enforced cannot block).
  5. If `creditType = PREPAID`, `minimumBalanceWarning` ≥ 0.
- **Lifecycle**: Created (on first set, lazily) → Updated. No soft delete needed
  (settings live and die with the customer; cascade on customer delete).
- **Domain Events Emitted**:
  - `CustomerCreditSettingsUpdated` — on any change (audit).
  - `CustomerPrepaidEnabled` — when `creditType` transitions to `PREPAID`.
  - `CustomerCreditBreached` — raised by the breach-evaluation command when balance > limit and the policy says BLOCK/PAUSE.
- **Commands**: `SetCreditSettings`, `EnablePrepaid`.
- **Queries**: read via the dashboard/priority/analytics read models (no dedicated single-settings query endpoint required by the story, but the settings are surfaced inside the priority list / customer detail).

### ReminderConfig Aggregate
- **Root Entity**: `ReminderConfigEntity`.
- **Value Objects**: `ReminderTemplate` (validates placeholder set), `ReminderSchedule` (the 3/15/30-day flags).
- **Invariants**:
  1. At least the template, when provided, only references the allowed placeholder set:
     `{customer_name, month, amount, upi_id, phone, vendor_name}`.
  2. `excludedCustomerIds` is a set of positive integers (deduped).
  3. If `autoRemindersEnabled = true`, at least one schedule flag must be true (otherwise the toggle is a no-op — reject with `ArgumentInvalidException`).
- **Lifecycle**: One row per vendor (unique). Created lazily on first `PATCH`.
- **Domain Events Emitted**: `ReminderConfigUpdated`.
- **Commands**: `UpdateReminderConfig`.
- **Queries**: `GetReminderConfig`.

### PaymentReminder (Entity, not an aggregate root for mutation)
- Append-only record (like `SupplyOverride`). Created by the send-reminder command/cron.
  Has a `status` (`SENT | DELIVERED | FAILED`) and an optional `responseType` /
  `responseAmount` updated later (out of scope for this story's writes; modeled for the
  history read model). No soft delete; immutable except optional response fields.

---

## Entities

### Entity: CustomerCreditSettings
- **Identity**: BigInt autoincrement → string in responses.
- **Fields**:
  | Field | Type | Required | Default | Constraint |
  |-------|------|----------|---------|-----------|
  | id | BigInt | Yes | auto | PK |
  | customerId | BigInt | Yes | - | FK customers.id, **unique** |
  | creditType | CreditType VO | Yes | NORMAL | enum |
  | warningThresholdPercent | WarningThreshold VO | Yes | 90 | 0–100 |
  | actionOnBreach | BreachAction VO | Yes | WARN | enum |
  | minimumBalanceWarning | Decimal(10,2) | No | null | ≥ 0 (prepaid only) |
  | createdAt / updatedAt | DateTime | Yes | now/auto | - |
- **Behavior**:
  - `setPolicy(patch)`: applies creditType/threshold/action/minBalance, enforces invariant 4 & 5, bumps `updatedAt`, emits `CustomerCreditSettingsUpdated`.
  - `enablePrepaid(minimumBalanceWarning)`: sets `creditType = PREPAID`, emits `CustomerPrepaidEnabled`.
  - `evaluateBreach(balance, creditLimit)`: pure domain method → returns `{ breached: boolean, nearLimit: boolean, utilizationPercent }`. `breached = balance > creditLimit` (only for NORMAL/PREPAID; UNLIMITED never breaches). `nearLimit = utilization ≥ warningThresholdPercent`.
- **Invariants**: as listed in the aggregate.

### Entity: ReminderConfig
- **Fields**:
  | Field | Type | Required | Default |
  |-------|------|----------|---------|
  | id | BigInt | Yes | auto |
  | vendorId | BigInt | Yes (unique) | - |
  | autoRemindersEnabled | Boolean | Yes | false |
  | schedule3Days / schedule15Days / schedule30Days | Boolean | Yes | true |
  | reminderTemplate | Text | No | null (system default used) |
  | excludedCustomerIds | Json (number[]) | Yes | [] |
- **Behavior**: `update(patch)` with invariant checks; emits `ReminderConfigUpdated`.

### Entity: PaymentReminder (append-only)
- **Fields**: id, customerId, vendorId, amountDue (Decimal), reminderDate (Date),
  sentVia (enum WHATSAPP/SMS/PUSH), status (enum SENT/DELIVERED/FAILED),
  responseType (enum NONE/FULL_PAYMENT/PARTIAL_PAYMENT, nullable),
  responseAmount (Decimal nullable), createdAt.

---

## Value Objects

### Value Object: CreditType
- **Properties**: value ∈ {NORMAL, PREPAID, UNLIMITED}.
- **Validation**: must be a member of the enum (guard).
- **Equality**: structural.

### Value Object: WarningThreshold
- **Properties**: percent: number.
- **Validation**: integer-ish, 0 ≤ percent ≤ 100.

### Value Object: BreachAction
- **Properties**: value ∈ {WARN, PAUSE, BLOCK}.
- **Validation**: enum membership.

### Value Object: AgingBucket (pure classifier, no persistence)
- **Properties**: bucket ∈ {FRESH_0_30, OVERDUE_30_60, CRITICAL_60_PLUS}, daysOverdue.
- **Factory**: `AgingBucket.fromDaysOverdue(days)` → `days ≤ 30 → FRESH_0_30`; `≤ 60 → OVERDUE_30_60`; else `CRITICAL_60_PLUS`. Days are clamped at 0 (never negative).
- **Equality**: structural.

### Value Object: CollectionPriority (pure classifier)
- **Factory**: `CollectionPriority.evaluate(daysOverdue, utilizationPercent)` →
  `HIGH` if `daysOverdue > 60 || utilization ≥ 95`; `MEDIUM` if `daysOverdue > 30 || utilization ≥ 80`; else `LOW`.

> **Reuse**: `CreditLimitVO` and `PaymentScoreVO` already exist in
> `src/modules/customer/domain/value-objects/`. The credit module imports the *numbers*
> via ports; it does not re-create those VOs (they belong to the Customer aggregate).

---

## Domain Events

| Event | Triggered When | Payload | Consumers |
|-------|----------------|---------|-----------|
| `CustomerCreditSettingsUpdated` | Credit policy changes | { aggregateId=settingsId, customerId, vendorId, creditType, actionOnBreach } | Audit log |
| `CustomerPrepaidEnabled` | creditType → PREPAID | { customerId, vendorId, clearedOutstandingFirst, minimumBalanceWarning } | Audit, Notification (welcome message stub) |
| `CustomerCreditBreached` | balance > limit and action ∈ {PAUSE, BLOCK} | { customerId, vendorId, balance, creditLimit, action } | Delivery (pause), Notification, Audit |
| `ReminderConfigUpdated` | Reminder config changes | { vendorId, autoRemindersEnabled } | Audit |
| `PaymentReminderSent` | A reminder is recorded | { customerId, vendorId, amountDue, sentVia, status } | Audit (optional) |

### Cross-Module Event Flow
- `CustomerCreditBreached` → (in the same command) `DeliveryControlPort.pauseCustomer()`
  for `BLOCK`/`PAUSE`. Modeled as an event for audit/notification fan-out; the actual
  pause is a direct, idempotent port call so the command can report the result
  synchronously to the caller.
- Events are emitted **after** successful persistence, following the existing module
  pattern (entities collect events; the command publishes via the logger-backed bus /
  audit writer used elsewhere — same convention as `staff` and `customer`).

---

## Use Cases (CQS)

### Commands (state-changing)
- **UC-C1 `SetCreditSettings`** — upsert `customer_credit_settings`; if a new limit amount
  is supplied, delegate the amount write through `CreditCustomerPort.setCreditLimit`
  (which calls the existing customer flow). Validates limit ≥ current balance unless
  `creditType = PREPAID` (warn-but-allow when lower — see business rules). Permission `credit:write`.
- **UC-C2 `EnablePrepaid`** — set `creditType = PREPAID`; optionally require outstanding
  cleared first (returns `clearOutstandingRequired` + the amount when `clearOutstandingFirst=true`
  and balance > 0, **without** flipping to prepaid until cleared — see OQ-3). Emits
  `CustomerPrepaidEnabled`. Sends customer notification (stub). Permission `credit:write`.
- **UC-C3 `SendBulkReminders`** — resolve target customers (`customerIds[]` or
  `"all_overdue"`), skip already-paid (balance ≤ 0) and excluded, render template,
  send via `ReminderNotificationPort`, insert `payment_reminders` rows; return
  `{ sent, skipped, failed }`. Idempotency: skip if a reminder for the same
  (customer, date) already exists. Permission `credit:write`.
- **UC-C4 `SendSingleReminder`** — single-customer convenience wrapper over UC-C3 (used by
  the priority-list "Remind" button). Permission `credit:write`.
- **UC-C5 `UpdateReminderConfig`** — upsert `reminder_config`. Permission `credit:write`.
- **UC-C6 `RunScheduledReminders`** (cron, not HTTP) — for each vendor with
  `autoRemindersEnabled`, find customers whose `daysOverdue` equals an enabled schedule day,
  skip excluded/paid, send + record.
- **UC-C7 `RunPrepaidBalanceCheck`** (cron, not HTTP) — for each prepaid customer with
  balance below `minimumBalanceWarning`, send low-balance alert; if balance ≥ limit
  (i.e., owes ≥ creditLimit) or ≤ 0 advance exhausted per policy, pause deliveries via
  `DeliveryControlPort`.

### Queries (read-only)
- **UC-Q1 `GetCollectionsDashboard`** — outstanding overview (aging summary), advance
  credit, net receivable, this-month progress (billed/collected/%/target/gap),
  customers-at-limit. Permission `credit:read`.
- **UC-Q2 `GetPriorityList`** — high/medium/low/advance buckets with per-customer cards;
  sortable. Permission `credit:read`.
- **UC-Q3 `GetCollectionAnalytics`** — monthly summary, payment-mode breakdown, 6-month
  trend, top payers, defaulters, for a `?month=YYYY-MM`. Permission `credit:read`.
- **UC-Q4 `GetReminderHistory`** — per-customer reminder timeline + totals + success rate.
  Permission `credit:read`.
- **UC-Q5 `GetReminderConfig`** — current per-vendor config. Permission `credit:read`.
- **UC-Q6 `GetOutstandingAging`** — standalone aging breakdown (used by dashboard;
  exposed for reuse). Permission `credit:read`.

---

## Mapper Design (`credit.mapper.ts`)

Because the read models are aggregations (not single-entity reads), the mapper is
primarily a **toResponse** whitelist + a small **toDomain/toPersistence** for the two
mutable aggregates.

- **toPersistence (settings)**: `CustomerCreditSettingsEntity` → `{ customerId, creditType,
  warningThresholdPercent, actionOnBreach, minimumBalanceWarning }` (no `creditLimit` — it
  lives on Customer).
- **toDomain (settings)**: Prisma row → entity via `reconstitute`, rebuilding the VOs.
- **toResponse (settings)**: whitelist `{ creditType, creditLimit (joined from customer),
  warningThreshold, actionOnBreach, creditUtilization }`.
- **toPersistence/toDomain (reminderConfig)**: straightforward field map; `excludedCustomerIds`
  is a `number[]` JSON.
- **toResponse (priority card / aging / analytics / reminder history)**: explicit DTO
  builders that select only the frontend-facing fields (ids as strings, money as numbers,
  dates as `YYYY-MM-DD`). Never spread raw rows.

---

## Anti-Corruption Layer

### External Integration: Messaging provider (WhatsApp / SMS)
- **Their model**: provider-specific send payload + delivery webhook.
- **Our model**: `ReminderNotificationPort.send({ customerPhone, channel, body, correlationId }) → Promise<{ status: SENT|FAILED }>`.
- **Port**: `src/modules/credit/ports/reminder-notification.port.ts`.
- **Adapter**: `src/modules/credit/adapters/reminder-notification-log.adapter.ts` (log-stub,
  masks phone, never throws — same pattern as `staff-notification-log.adapter.ts`).
- **Strategy**: the port is the strategy interface; a real `WhatsAppReminderAdapter` can be
  selected at the composition root later. Error translation: provider errors → `{status: FAILED}`,
  never leaked.

### Internal ACL ports (over already-shipped capabilities)
- `CreditBalancePort` (`ports/credit-balance.port.ts`) — adapter wraps the existing
  balance aggregations:
  - `getBulkBalances(customerIds, vendorId)` (reuse logic from `delivery-billing.adapter`),
  - `getOldestUnpaidServiceDate(customerId, vendorId)` (new raw query: MIN(service_date) of
    billable daily_supplies where running balance is still positive — see Performance),
  - `getMonthlyBilled(vendorId, month)`, `getMonthlyCollected(vendorId, month)`,
  - `getPaymentModeBreakdown(vendorId, month)`,
  - `getCollectionTrend(vendorId, sixMonths)`,
  - `getTopPayers(vendorId, month)`.
- `CreditCustomerPort` (`ports/credit-customer.port.ts`) — read customer name/phone/credit
  limit/payment score/status for a vendor; `setCreditLimit(customerId, vendorId, amount)`
  delegating to the existing customer update path.
- `DeliveryControlPort` (`ports/delivery-control.port.ts`) — `pauseCustomer(customerId, vendorId)`
  (idempotent); adapter flips `vendor_customers.status = PAUSED`.

> Adapters live in `src/modules/credit/adapters/` and use raw Prisma — they never import
> `customer/*` or `delivery/*` module classes, preserving module encapsulation.

---

## Module Structure (mandatory commands/ + queries/)

```
src/modules/credit/
├── domain/
│   ├── customer-credit-settings.entity.ts
│   ├── reminder-config.entity.ts
│   ├── payment-reminder.entity.ts
│   ├── credit.types.ts                 # enums: CreditType, BreachAction, SentVia, ...
│   ├── credit.errors.ts                # CreditSettingsNotFoundError, InvalidCreditTransitionError, ...
│   ├── value-objects/
│   │   ├── credit-type.vo.ts
│   │   ├── warning-threshold.vo.ts
│   │   ├── breach-action.vo.ts
│   │   ├── aging-bucket.vo.ts
│   │   └── collection-priority.vo.ts
│   └── events/
│       ├── customer-credit-settings-updated.domain-event.ts
│       ├── customer-prepaid-enabled.domain-event.ts
│       ├── customer-credit-breached.domain-event.ts
│       └── reminder-config-updated.domain-event.ts
├── commands/
│   ├── set-credit-settings/set-credit-settings.command.ts (+ .request.dto.ts)
│   ├── enable-prepaid/enable-prepaid.command.ts (+ .request.dto.ts)
│   ├── send-bulk-reminders/send-bulk-reminders.command.ts (+ .request.dto.ts)
│   ├── send-single-reminder/send-single-reminder.command.ts
│   └── update-reminder-config/update-reminder-config.command.ts (+ .request.dto.ts)
├── queries/
│   ├── get-collections-dashboard/get-collections-dashboard.query.ts
│   ├── get-priority-list/get-priority-list.query.ts
│   ├── get-collection-analytics/get-collection-analytics.query.ts
│   ├── get-reminder-history/get-reminder-history.query.ts
│   ├── get-reminder-config/get-reminder-config.query.ts
│   └── get-outstanding-aging/get-outstanding-aging.query.ts
├── database/
│   ├── credit-settings.repository.port.ts + credit-settings.repository.ts
│   ├── reminder-config.repository.port.ts + reminder-config.repository.ts
│   └── payment-reminder.repository.port.ts + payment-reminder.repository.ts
├── ports/
│   ├── credit-balance.port.ts
│   ├── credit-customer.port.ts
│   ├── delivery-control.port.ts
│   └── reminder-notification.port.ts
├── adapters/
│   ├── credit-balance.adapter.ts
│   ├── credit-customer.adapter.ts
│   ├── delivery-control.adapter.ts
│   └── reminder-notification-log.adapter.ts
├── credit.mapper.ts
├── credit.types.ts                     # shared response DTOs
├── credit.validator.ts                 # Zod schemas
├── credit.controller.ts
├── credit.routes.ts                    # composition root
├── credit.cron.ts                      # RunScheduledReminders + RunPrepaidBalanceCheck (ENABLE_CRON gate)
└── __tests__/
```
