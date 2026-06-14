# Feature: Credit Control & Outstanding Management (US-012)

> Slug: `us-012-credit-control` | Branch: `feat/us-012-credit-control`
> Skills to apply: `ddd-module-design`, `domain-modeling`, `api-contract-design`,
> `prisma-schema-design`, `validation-schemas`, `error-handling`,
> `repository-implementation`, `service-implementation`, `testing-strategy`.
> Companion docs in this folder: `DOMAIN_MODEL.md`, `FEATURE_TASKS.md`, `FEATURE_BUGS.md`, `API_SPEC.md`.

## Complexity Assessment
- **Tier**: Complex
- **Justification**: New bounded context with 2 mutable aggregates + 1 append-only entity,
  6 read models aggregating across delivery/payment/customer, a cross-module breach→block
  reaction, 2 scheduled sweeps, and a messaging ACL (Strategy). See `DOMAIN_MODEL.md`.
- **Directory Structure**: full DDD with mandatory `commands/` + `queries/` slices
  (see `DOMAIN_MODEL.md` → Module Structure). New module: `src/modules/credit/`.

## Reconciliation with shipped code (MUST read)
US-012 is built on the **shipped** US-008 reality, not the legacy `db-design` SQL:
- **Balances are computed**, not stored (`delivery-billing.adapter.ts`):
  `balance = Σ billable daily_supplies.final_amount − Σ payments.amount`.
- **`customers.credit_limit`** and **`customers.payment_score`** already exist (with
  `CreditLimitVO` / `PaymentScoreVO`). We do **not** duplicate them into the new
  `customer_credit_settings` table.
- `PATCH /vendors/:vendorId/customers/:customerId/credit-limit` and the record-payment
  flow already exist in the customer module and are **reused via ports**, not reimplemented.
- No `monthly_bills` / `account_balances` / `transactions` tables exist or are introduced.

The legacy SQL files `09/10/11-*.sql` describe an unbuilt model; this plan supersedes them
for US-012. See Open Questions OQ-1/OQ-2 for the duplicated-column rejections, and the
db-design update note at the bottom.

## Domain Model
(Full detail in `DOMAIN_MODEL.md`.) Summary:
- **Aggregates**: `CustomerCreditSettings` (root), `ReminderConfig` (root).
- **Entities**: `CustomerCreditSettingsEntity`, `ReminderConfigEntity`,
  `PaymentReminderEntity` (append-only).
- **Value Objects**: `CreditType`, `WarningThreshold`, `BreachAction`, `AgingBucket`
  (classifier), `CollectionPriority` (classifier). Reuses customer's `CreditLimitVO`,
  `PaymentScoreVO` via ports (numbers only).
- **Domain Events**: `CustomerCreditSettingsUpdated`, `CustomerPrepaidEnabled`,
  `CustomerCreditBreached`, `ReminderConfigUpdated`, `PaymentReminderSent`.
- **Aggregate Boundaries**: credit settings reference `customerId` by ID; the limit
  *amount* stays on the Customer aggregate. Reminder config references `vendorId` by ID and
  stores `excludedCustomerIds` as a JSON id array (cross-aggregate refs by ID only).

## API Endpoints
All mounted under `/api/v1`. All require Bearer JWT + **owner** role
(`requireOwnerRole()` + `identifyUserRole('vendorId')`), matching the customer module.
Permission strings: `credit:read` (queries), `credit:write` (commands).

| # | Method | Path | CQS | Permission |
|---|--------|------|-----|-----------|
| 1 | GET | `/vendors/:vendorId/collections/dashboard` | Query | `credit:read` |
| 2 | GET | `/vendors/:vendorId/collections/priority-list` | Query | `credit:read` |
| 3 | GET | `/vendors/:vendorId/collections/analytics` | Query | `credit:read` |
| 4 | GET | `/vendors/:vendorId/collections/aging` | Query | `credit:read` |
| 5 | PATCH | `/vendors/:vendorId/customers/:customerId/credit-settings` | Command | `credit:write` |
| 6 | POST | `/vendors/:vendorId/customers/:customerId/enable-prepaid` | Command | `credit:write` |
| 7 | POST | `/vendors/:vendorId/customers/:customerId/reminders` | Command | `credit:write` |
| 8 | GET | `/vendors/:vendorId/customers/:customerId/reminders` | Query | `credit:read` |
| 9 | POST | `/vendors/:vendorId/reminders/send-bulk` | Command | `credit:write` |
| 10 | GET | `/vendors/:vendorId/reminder-config` | Query | `credit:read` |
| 11 | PATCH | `/vendors/:vendorId/reminder-config` | Command | `credit:write` |

> Note on paths: the user story drafted some endpoints as `/api/customers/:customerId/...`
> (no `vendorId`). We standardize on the **vendor-scoped** prefix
> `/vendors/:vendorId/...` to match every other module and enable multi-tenant isolation in
> middleware (see OQ-4). Endpoint 7 (`POST .../reminders`) is the single-customer
> "Remind" action; endpoint 9 is the bulk action.

### Per-endpoint contracts
Full request/response JSON is in `API_SPEC.md`. Validation patterns:
- **Mutations** (5, 6, 9, 11): `z.object(...).strict()`; enums via `z.nativeEnum`.
- **Single-reminder** (7): empty/optional body `{ customMessage? }`, `.strict()`.
- **Queries with params** (2 `sort`, 3 `month`): `.passthrough()` query schema with a
  whitelisted `sort` enum and `month` matching `^\d{4}-\d{2}$`.
- **Path params**: reuse `vendorIdParamSchema` / `customerParamsSchema` shape from the
  customer module (do not import — redefine in `credit.validator.ts` to keep modules
  encapsulated).

### Error scenarios (mapped to error classes)
- `400 VALIDATION_ERROR` — Zod failure (`validate` middleware).
- `400 ARGUMENT_INVALID` — `ArgumentInvalidException` from a VO/entity invariant
  (e.g., threshold out of range, unlimited+block combo, empty schedule with auto on).
- `403 FORBIDDEN` — non-owner (`requireOwnerRole`).
- `404 NOT_FOUND` — `CustomerNotFoundError` (wrong/foreign customer — multi-tenant mask),
  `CreditSettingsNotFoundError` only where a settings row is required.
- `409 CONFLICT` — `InvalidCreditTransitionError` (e.g., enable-prepaid when outstanding
  must be cleared first and `clearOutstandingFirst=true`); reported as a structured
  `clearOutstandingRequired` result, not a hard error (see OQ-3) — but a true illegal
  transition (prepaid→prepaid) returns 409.
- `429 TOO_MANY_REQUESTS` — write rate limiter on commands.

## Data Model Changes (Prisma)
Three new models + three new enums. **No changes to `customers`** (credit limit / payment
score already present). Soft delete is **not** used for these (settings cascade-delete with
the customer; reminders are append-only history). All money is `Decimal(10,2)`.

### Enums
```prisma
enum CreditType { NORMAL PREPAID UNLIMITED @@map("credit_type") }
enum CreditBreachAction { WARN PAUSE BLOCK @@map("credit_breach_action") }
enum ReminderChannel { WHATSAPP SMS PUSH @@map("reminder_channel") }
enum ReminderStatus { SENT DELIVERED FAILED @@map("reminder_status") }
enum ReminderResponseType { NONE FULL_PAYMENT PARTIAL_PAYMENT @@map("reminder_response_type") }
```

### model CustomerCreditSettings  → `customer_credit_settings`
| Field | Type | Notes |
|-------|------|-------|
| id | BigInt PK autoincrement | |
| customerId | BigInt, **@unique**, FK customers.id onDelete: Cascade | one row per customer |
| creditType | CreditType @default(NORMAL) | |
| warningThresholdPercent | Int @default(90) | 0–100 (entity-enforced) |
| actionOnBreach | CreditBreachAction @default(WARN) | |
| minimumBalanceWarning | Decimal(10,2)? | prepaid only |
| createdAt / updatedAt | DateTime | |
- **No `credit_limit` column** (lives on `customers.credit_limit`).
- Indexes: `@@index([customerId])`, `@@index([creditType])`, `@@index([createdAt])`.

### model ReminderConfig → `reminder_config`
| Field | Type | Notes |
|-------|------|-------|
| id | BigInt PK | |
| vendorId | BigInt, **@unique**, FK vendors.id onDelete: Cascade | one per vendor |
| autoRemindersEnabled | Boolean @default(false) | |
| schedule3Days / schedule15Days / schedule30Days | Boolean @default(true) | |
| reminderTemplate | String? @db.Text | null → system default |
| excludedCustomerIds | Json @default("[]") | number[] |
| createdAt / updatedAt | DateTime | |
- Indexes: `@@index([vendorId])`, `@@index([autoRemindersEnabled])`, `@@index([createdAt])`.

### model PaymentReminder → `payment_reminders`
| Field | Type | Notes |
|-------|------|-------|
| id | BigInt PK | |
| customerId | BigInt FK customers.id onDelete: Cascade | |
| vendorId | BigInt FK vendors.id onDelete: Cascade | |
| amountDue | Decimal(10,2) | snapshot at send time |
| reminderDate | DateTime @db.Date | |
| sentVia | ReminderChannel | |
| status | ReminderStatus @default(SENT) | |
| responseType | ReminderResponseType? | nullable |
| responseAmount | Decimal(10,2)? | nullable |
| createdAt | DateTime @default(now()) | append-only, no updatedAt/deletedAt |
- Indexes: `@@index([customerId])`, `@@index([vendorId])`, `@@index([reminderDate])`,
  `@@index([customerId, reminderDate])` (idempotency lookups + history),
  `@@index([vendorId, reminderDate])`, `@@index([status])`.
- **Idempotency**: enforce a partial unique on `(customerId, reminderDate)` via raw SQL in
  the migration (Prisma can't express the partial). Prevents duplicate same-day reminders
  (edge case 8).

> Back-relations: add `customerCreditSettings CustomerCreditSettings?`,
> `paymentReminders PaymentReminder[]` to `Customer`; `reminderConfig ReminderConfig?`,
> `paymentReminders PaymentReminder[]` to `Vendor`. New relation fields only — no field
> type changes to existing models (backward compatible).

### Seed data
- **Permissions** (`prisma/seeds/`): add `credit:read` and `credit:write`
  (`resource='credit'`, actions `read`/`write`); grant both to the **owner** role.
- **Dev seed (faker)**: for the demo vendor, create `reminder_config` (auto off), credit
  settings for ~5 customers (mix of NORMAL/PREPAID/UNLIMITED, varied thresholds/actions),
  and ~15 `payment_reminders` rows across a few customers with mixed status/response so the
  history + analytics screens render.

## Business Rules
- **Aging**: `daysOverdue = max(0, CURRENT_DATE − oldestUnpaidServiceDate)`. Bucket:
  `≤30 FRESH_0_30`, `≤60 OVERDUE_30_60`, else `CRITICAL_60_PLUS`. Only customers with
  `balance > 0` are aged. (Edge case 10: cap display label at "365+" in the frontend; the
  API returns the true integer.)
- **Net receivable** = Σ(positive balances) − Σ(|negative balances|).
- **Priority**: `HIGH` if `daysOverdue > 60 || utilization ≥ 95`; `MEDIUM` if
  `daysOverdue > 30 || utilization ≥ 80`; else `LOW`. Advance-credit customers
  (`balance < 0`) are listed in a separate `advanceCredit` bucket, never in HIGH/MED/LOW.
- **Utilization** = `creditLimit > 0 ? round(balance / creditLimit * 100) : 0`.
- **Credit settings invariants** (entity): threshold 0–100; UNLIMITED forces action=WARN;
  PREPAID requires `minimumBalanceWarning ≥ 0`.
- **Set credit limit lower than current outstanding**: **warn but allow** (return
  `warning: "limit_below_outstanding"` in the result) — edge case 3.
- **Enable prepaid**: if `clearOutstandingFirst=true` and `balance > 0`, do **not** flip to
  prepaid; return `{ clearOutstandingRequired: true, outstanding }` so the UI prompts for
  payment first (OQ-3). If `clearOutstandingFirst=false` or `balance ≤ 0`, flip immediately.
- **Reminder skip rules**: skip customers with `balance ≤ 0` (already paid — edge case 5),
  skip `excludedCustomerIds` (edge 7), skip if a reminder for `(customer, today)` exists
  (edge 8), skip soft-deleted/inactive customers (edge 6).
- **Breach action**: on a credit-limit or balance change evaluation, if
  `balance > creditLimit` and `creditType ≠ UNLIMITED`: `WARN` → flag only; `PAUSE`/`BLOCK`
  → call `DeliveryControlPort.pauseCustomer` (idempotent) + emit `CustomerCreditBreached`.
- **Prepaid daily check**: prepaid customer with balance below `minimumBalanceWarning` →
  low-balance alert; balance exhausted (≤ 0 advance) → pause. Edge 4: allow exactly-zero one
  more delivery is a delivery-module concern; here we only pause when advance is fully
  consumed (`balance ≥ 0` meaning no remaining advance) per policy — documented as OQ-5.
- **Multi-tenant isolation**: every customer-scoped operation filters by `vendorId` from the
  JWT/path; a customer not belonging to the vendor returns `404 NOT_FOUND` (never reveal
  existence).

### State transitions (creditType)
```
NORMAL  ──enable-prepaid──▶ PREPAID
NORMAL  ──set(UNLIMITED)──▶ UNLIMITED
PREPAID ──set(NORMAL)─────▶ NORMAL
UNLIMITED ──set(NORMAL)───▶ NORMAL
PREPAID ──enable-prepaid──▶ ✗ 409 InvalidCreditTransitionError (already prepaid)
```

## Sequence Diagrams (text)

### Collections Dashboard (Query)
```
Controller → GetCollectionsDashboardQuery.execute(vendorId)
  ├─ CreditCustomerPort.listCustomersWithCredit(vendorId)        → [{id,name,creditLimit,paymentScore,status}]
  ├─ CreditBalancePort.getBulkBalances(ids, vendorId)            → Map<id, balance>
  ├─ CreditBalancePort.getOldestUnpaidServiceDate(ids,vendorId)  → Map<id, date> (one batched query)
  ├─ for each customer: AgingBucket.fromDaysOverdue(days), accumulate summary
  ├─ CreditBalancePort.getMonthlyBilled / getMonthlyCollected(vendorId, thisMonth)
  ├─ VendorSettings/target → thisMonthProgress
  └─ credit.mapper.toDashboardResponse(...)                       → whitelisted DTO
Controller → 200 { success, data }
```

### Set Credit Settings (Command)
```
Controller(validate strict) → SetCreditSettingsCommand.execute(input, vendorId, customerId)
  ├─ CreditCustomerPort.getCustomer(customerId, vendorId)  (404 if foreign — tenant mask)
  ├─ if creditLimit supplied: CreditCustomerPort.setCreditLimit(...)  (reuses customer flow)
  ├─ settingsRepo.findByCustomer → entity.setPolicy(patch)  OR  Entity.create(...)
  ├─ entity.validate() (invariants) → settingsRepo.upsert(toPersistence(entity))
  ├─ CreditBalancePort.getCustomerBalance → entity.evaluateBreach(balance, limit)
  │     └─ if breached & action∈{PAUSE,BLOCK}: DeliveryControlPort.pauseCustomer + emit CustomerCreditBreached
  ├─ emit CustomerCreditSettingsUpdated (audit)
  └─ mapper.toSettingsResponse(entity, balance, limit)
Controller → 200 { success, data }
```

### Send Bulk Reminders (Command)
```
Controller → SendBulkRemindersCommand.execute({ customerIds | "all_overdue", customMessage }, vendorId)
  ├─ resolve targets (CreditCustomerPort + CreditBalancePort: balance>0, not excluded, active)
  ├─ reminderConfigRepo.findByVendor → template (or system default)
  ├─ for each target (batch ≤ 50/min):
  │     ├─ skip if reminderRepo.existsForDate(customerId, today)   (idempotency)
  │     ├─ render template (placeholder substitution)
  │     ├─ ReminderNotificationPort.send(...) → {status}
  │     └─ reminderRepo.insert(PaymentReminder.create(...))
  └─ return { sent, skipped, failed }
```

## Strategy Interfaces (external services)
- **`ReminderNotificationPort`** (`ports/reminder-notification.port.ts`):
  `send({ customerPhone, channel, body, correlationId }): Promise<{ status: 'SENT'|'FAILED' }>`.
  - Implementation now: `ReminderNotificationLogAdapter` (log-stub, masks phone, never
    throws — mirrors `staff-notification-log.adapter.ts`).
  - Future: `WhatsAppReminderAdapter` selected at the composition root. Webhook handling
    (delivery status / responses) is **out of scope** for US-012 and noted as future work.
- Internal ACL ports: `CreditBalancePort`, `CreditCustomerPort`, `DeliveryControlPort`
  (see `DOMAIN_MODEL.md` → Anti-Corruption Layer). All adapters use raw Prisma; no
  cross-module class imports.

## Error Handling Strategy
- Reuse `@/common/errors/app-error` classes (`ArgumentInvalidException`,
  `NotFoundError`/module-specific `CustomerNotFoundError`, `ConflictError`,
  `TooManyRequestsError`). New module errors in `credit.errors.ts`:
  `CreditSettingsNotFoundError` (404), `InvalidCreditTransitionError` (409),
  `ReminderConfigNotFoundError` (404, only on GET when none and we choose to 404 vs default).
- Every command/query generates a `correlationId` (randomUUID) and logs with it; errors
  propagate via `next(error)` to the central handler which attaches `correlationId` to the
  response envelope.
- **Per-memory error logging**: on any caught error, write a line to
  `Logs/YYYY-MM-DD.txt` at project root with the `correlationId` (the Dev agent must wire
  this in the central error handler if not already present; verify before adding).
- State-transition errors: prepaid→prepaid → `InvalidCreditTransitionError` (409).
- Multi-tenant masking: foreign customer/vendor → `404`, never `403`/`200`.
- Notification failures never fail the command: `ReminderNotificationPort` returns
  `{status: FAILED}` and the reminder row is written with `status = FAILED`.

## Security Considerations
- All endpoints owner-only; staff cannot view collections (matches story "Owner only").
- `vendorId` always taken from the JWT-validated path context, never trusted from body.
- Phone numbers masked in all logs (reuse mask util pattern).
- `excludedCustomerIds` validated as positive integers to prevent JSON injection of
  arbitrary structures.
- Rate-limit all write endpoints (reuse the customer module's `writeLimiter` config).
- Bulk reminder send capped (≤ 50/min) to avoid spam-flagging and accidental fan-out.

## Performance Considerations
- **Bulk balances**: reuse the single-round-trip `getBulkBalances` raw query; never N+1.
- **Oldest unpaid service date**: one batched raw query keyed by `customerId = ANY(...)`,
  using `daily_supplies(service_date)` — relies on existing
  `@@index([supplyListId, serviceDate, status])` and the new
  `payment_reminders(customerId, reminderDate)` index. The "oldest unpaid" is approximated
  as the MIN billable `service_date` for customers whose computed balance > 0 (FIFO
  assumption — see OQ-6); this avoids needing a per-bill ledger.
- **Analytics**: monthly billed/collected/mode-breakdown/trend are 4–5 grouped aggregations
  per request; acceptable for the dashboard cadence. **Caching (15-min TTL) and
  materialized views are deferred** (OQ-7) — premature without measured load; the story's
  500-customer target is well within a single aggregation pass.
- New composite indexes (above) cover the priority-list and history query patterns.
- Cron sweeps iterate vendors with `autoRemindersEnabled = true` (indexed) and process
  customers in batches.

## Open Questions (with recommendation + trade-off)

**OQ-1: `customer_credit_settings.credit_limit` duplication.**
The story's inline SQL puts `credit_limit` on the new settings table, but
`customers.credit_limit` already exists and is the single source of truth used everywhere
(mapper, utilization, existing PATCH endpoint).
**Recommended**: Do **not** add `credit_limit` to `customer_credit_settings`; keep it on
`customers`. The settings table holds only policy (type/threshold/action/minBalance).
**Trade-off**: One fewer column to migrate and zero risk of two diverging limit values;
the cost is that "set credit settings" must touch two tables (Customer for the amount,
settings for the policy) — handled cleanly via `CreditCustomerPort.setCreditLimit`.

**OQ-2: `oldest_unpaid_bill_date` / `payment_efficiency_score` columns on `customers`.**
The story proposes adding both. `payment_score` already exists. There is no bill table, so
`oldest_unpaid_bill_date` would be a denormalized cache that can go stale.
**Recommended**: Reject both new columns. Compute "oldest unpaid service date" on demand via
a batched query (FIFO assumption). Keep using existing `customers.payment_score`.
**Trade-off**: Slightly more query work per dashboard load vs. guaranteed-correct values and
no stale-cache invalidation logic. If profiling later shows it's hot, add a cached column
with a clear refresh trigger.

**OQ-3: Enable-prepaid with outstanding owed.**
When `clearOutstandingFirst=true` and the customer still owes money, should we (a) block the
switch and tell the UI to collect payment first, or (b) switch anyway?
**Recommended**: (a) — return `{ clearOutstandingRequired: true, outstanding }` and do **not**
flip to prepaid until the balance is cleared (a follow-up call with cleared balance succeeds).
**Trade-off**: Safer (prepaid genuinely means "no dues"), but adds a two-step UX. The
alternative is simpler but lets a "prepaid" customer carry legacy debt, contradicting the term.

**OQ-4: Endpoint path prefix (`/api/customers/...` vs `/vendors/:vendorId/customers/...`).**
The story drafts some endpoints without `vendorId`.
**Recommended**: Use the vendor-scoped prefix everywhere (as in every shipped module) so
multi-tenant isolation is enforced by path + middleware.
**Trade-off**: Frontend URLs are slightly longer, but isolation and consistency are
guaranteed; mixing two URL shapes would be a security and maintenance hazard.

**OQ-5: Prepaid pause threshold.**
"Cannot receive deliveries if balance ≤ 0" — but our balance is *positive = owes*. For a
prepaid customer, "advance exhausted" means `balance ≥ 0` (no remaining credit).
**Recommended**: Pause a prepaid customer when `balance ≥ 0` (advance fully consumed); send a
low-balance alert when remaining advance `|balance|` falls below `minimumBalanceWarning`.
**Trade-off**: This is the only interpretation consistent with the computed-balance sign
convention; if the product intends "one more delivery at exactly zero", that belongs in the
delivery module's auto-mark guard, not here.

**OQ-6: "Oldest unpaid" without a bill ledger (FIFO assumption).**
With computed balances and no per-bill allocation, aging uses the oldest billable
`service_date` while `balance > 0`.
**Recommended**: Accept the FIFO approximation (payments pay down the oldest deliveries first).
**Trade-off**: Exact per-invoice aging would require building the `monthly_bills` +
allocation ledger from the legacy SQL — a much larger effort outside US-012's scope. FIFO is
the standard, intuitive approximation and matches the dashboard's intent.

**OQ-7: Caching / materialized views for analytics.**
The story lists 15-min cache + materialized views as "performance optimizations".
**Recommended**: Defer. Ship straight aggregations; add caching only if profiling at the
500-customer target shows a problem.
**Trade-off**: Simpler, always-fresh data now; potential latency if a vendor grows far
beyond the target — at which point a cache is a small, well-understood addition.

**OQ-8: WhatsApp/SMS provider.**
No real messaging provider is integrated anywhere in the codebase (staff invites also use a
log-stub).
**Recommended**: Ship a `ReminderNotificationLogAdapter` log-stub behind the
`ReminderNotificationPort` Strategy; reminders are recorded with `status = SENT`. Wire a real
provider in a later story.
**Trade-off**: Full flow (records, history, analytics) works end-to-end now without a paid
provider dependency; actual delivery is deferred. Default proceeds with the stub.

## db-design update note
The legacy `db-design` files `09-billing.sql`, `10-payments.sql`, `11-credit-management.sql`
describe an unbuilt model (stored balances, `monthly_bills`, `transactions`,
`vendor_customer_id`-keyed payments) that conflicts with the shipped schema. US-012 does not
adopt them. A follow-up chore should reconcile `11-credit-management.sql` to the shipped
design: drop the duplicated `credit_limit` from the settings table, remove the
`account_balances`/`transactions` dependency for the credit-control feature, and document
that balances are computed. This is flagged here rather than silently rewriting those files,
since they also underpin the (future) full billing-ledger story; the orchestrator/user should
decide whether to refactor them now or when the billing-ledger story is picked up.
