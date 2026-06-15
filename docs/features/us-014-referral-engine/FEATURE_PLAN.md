# Feature: US-014 — Referral Engine & Network Growth

> Slug: `us-014-referral-engine` | Branch: `feat/us-014-referral-engine` | Generated: 2026-06-15
> Canonical schema authority: `project_documents/db-design/15-referrals-rewards.sql` (NOT the story's inline SQL)

---

## Complexity Assessment

- **Tier**: **Complex**
- **Justification**:
  - Multiple aggregates with their own invariants: `VendorReferral`, `CustomerReferral`, `VendorCredit` (balance + immutable ledger), `CustomerInvite`, `ReferralLeaderboard`.
  - Strong cross-module event flows: depends on **customer counts** (US-008 / vendor_customers), **subscription invoices** (US-009), and **credit redemption** integrates with **subscription** billing.
  - A money ledger (`credit_transactions`) requiring atomic balance updates, clawback (negative adjustments) and expiry — invariant: `available_credits` must equal the running ledger balance and never go negative.
  - State machines on referral status (`PENDING → SIGNED_UP → QUALIFIED → REWARDED`) and invite status.
  - A monthly cron (revenue share), a daily cron (clawback/expiry/invite auto-resend) and a leaderboard recompute cron.
  - Fraud invariants (self-referral block, qualification gating, clawback windows, rate limiting).
- **Directory Structure**: Full DDD vertical-slice module (`commands/`, `queries/`, `domain/`, `database/`, `adapters/`, `ports/`) per `ddd-module-design.md` Step 5 "Complex Domain Module". Module root: `src/modules/referral/`.
  - Per MEMORY (`feedback_module_file_structure.md`), `commands/` and `queries/` subdirectories are **mandatory** — no flat layout.

---

## Ubiquitous Language

| Term | Definition |
|------|-----------|
| Referrer | The existing vendor (or customer) who shares a code/invite. |
| Referee | The new vendor/customer who signs up using a referral code. Canonical schema column is `referee_*` (story's "referred_*" is renamed to this). |
| Vendor Referral | A tracked vendor→vendor referral with a lifecycle and reward schedule. |
| Customer Referral | A tracked customer→customer referral within a single vendor's book. |
| Qualification | The moment a referee meets the activity bar (≥3 customers within 30 days) that makes rewards payable and clawback-safe. |
| Reward | A credit movement earned by a referrer (signup bonus, milestone, revenue share). |
| Credit | Platform currency earned from referrals; tracked as a per-vendor **balance** (`vendor_credits`) plus an **immutable ledger** (`credit_transactions`). |
| Clawback | A negative `ADJUSTMENT` ledger entry reversing previously earned credit when a referee churns inside the protection window. |
| Redemption | Spending available credits on subscription payment, plan upgrade, or cash withdrawal. |
| Invite | A WhatsApp outreach to a vendor's own customer not yet on PayCycle. |
| Leaderboard | Pre-computed referral ranking per period (weekly/monthly/all-time). |

---

## Context Map: Referral Module

### Owned Concepts
- Vendor-to-vendor referrals (`vendor_referrals`)
- Customer-to-customer referrals (`customer_referrals`)
- Vendor credit balance + ledger (`vendor_credits`, `credit_transactions`)
- Customer invites (`customer_invites` — referral-scoped; **see reconciliation note re: collision with US-013 invites**)
- Referral leaderboard (`referral_leaderboard`)

### Boundaries
- This module OWNS: referral lifecycle, reward computation, credit balance/ledger, clawback, leaderboard, customer-invite outreach for growth.
- This module DOES NOT OWN: vendor identity / `referral_code` generation home (lives on `vendors` — US-003), customer counts (US-008 `vendor_customers`), subscription invoices & plan upgrades (US-009 `subscription`), WhatsApp transport (stubbed notification port), customer records.
- Module internals are PRIVATE — other modules integrate via this module's **inbound ports** (e.g. a `ReferralFacade` the auth/signup flow calls) and via **domain events**, never direct table writes.

### Relationships
| Related Context | Direction | Integration Pattern | Communication | Shared Data |
|---|---|---|---|---|
| Auth / Vendor Signup (US-003) | Upstream | Conformist | Direct call to `ReferralFacade.processVendorSignup()` on signup | `referralCode`, new `vendorId`, owner identity |
| Customer (US-008) | Upstream | ACL (read port) | `CustomerCountPort.activeCustomerCount(vendorId)`; consume `CustomerActivated`-style event or poll in cron | `vendorId`, active customer count |
| Subscription (US-009) | Upstream + Downstream | ACL (read + write ports) | Read paid invoices for revenue share; write a credit-funded payment / upgrade on redemption | `subscription_invoices.totalAmount`, `paymentStatus`, plan price |
| Notification/WhatsApp | Downstream | Anti-Corruption (Strategy port) | `InviteMessagePort.send()` (stubbed/log adapter now) | phone, message body |

### Cross-Module Communication Strategy
- **Inbound (others → referral)**: a thin `ReferralFacade` (application service) exposes `processVendorSignup`, `recordCustomerReferral`. The signup/customer modules call this facade — they do NOT touch referral tables.
- **Outbound (referral → others)**: domain events (`VendorReferralQualified`, `ReferralRewardEarned`, `CreditRedeemed`, `CreditClawedBack`) consumed by Notification (and Audit). Redemption against subscription uses a **write port** (`SubscriptionCreditPort`) implemented by an adapter that calls the subscription module's public service — no direct cross-aggregate Prisma writes.

---

## Domain Model

### Aggregates

#### 1. VendorReferral Aggregate
- **Root**: `VendorReferral`
- **Value Objects**: `ReferralCode`, `Money` (reward amounts)
- **Invariants**:
  1. `referrerVendorId !== refereeVendorId` (self-referral blocked).
  2. Status only advances forward: `PENDING → SIGNED_UP → QUALIFIED → REWARDED`; never backward except clawback marks `qualificationNotes` + reverses credit (status stays `REWARDED`, ledger reverses).
  3. A referee vendor can be attributed to **at most one** referrer (first successful code wins — enforced by partial unique index + app guard).
  4. Milestone rewards are idempotent — each milestone (`signup`, `10`, `50`) issues credit at most once (tracked via ledger `source_type+source_id+description` uniqueness, see reconciliation).
- **Lifecycle**: created on `POST .../referrals/vendor` (PENDING) → `SIGNED_UP` on referee signup → `QUALIFIED` when referee ≥3 customers in 30d → milestone/revenue rewards accrue.
- **Domain Events**: `VendorReferralCreated`, `VendorReferralSignedUp`, `VendorReferralQualified`, `ReferralRewardEarned`, `ReferralRewardClawedBack`.
- **Commands**: CreateVendorReferral, AttributeRefereeSignup, QualifyReferral, AwardMilestone, AwardRevenueShare, ClawbackReferral.
- **Queries**: GetReferralDashboard, ListVendorReferrals.

#### 2. CustomerReferral Aggregate
- **Root**: `CustomerReferral`
- **Invariants**: `referrerCustomerId !== refereeCustomerId`; reward to referrer paid once on qualification; vendor-scoped (both customers belong to the same `vendorId`).
- **Domain Events**: `CustomerReferralRecorded`, `CustomerReferralQualified`.
- **Commands**: RecordCustomerReferral, QualifyCustomerReferral.
- **Queries**: GetCustomerReferralSummary, ListTopReferrers.

#### 3. VendorCredit Aggregate (balance + ledger)
- **Root**: `VendorCredit` (one row per vendor; owns `CreditTransaction[]` ledger as the write log)
- **Value Objects**: `Money`
- **Invariants**:
  1. `availableCredits = lifetimeCreditsEarned − lifetimeCreditsUsed` and **must be ≥ 0** (DB CHECK + domain guard).
  2. `availableCredits` must equal the `balance_after` of the latest `credit_transactions` row (consistency rule, mirrors `account_balances` discipline in module 11).
  3. `credit_transactions` is **append-only / immutable** (INSERT only).
  4. Every balance mutation is **atomic** (Prisma `increment`/`decrement` inside a transaction with the ledger insert).
- **Domain Events**: `CreditEarned`, `CreditRedeemed`, `CreditExpired`, `CreditClawedBack`.
- **Commands**: EarnCredit, RedeemCredit (subscription/upgrade/withdraw), ClawbackCredit, ExpireCredit.
- **Queries**: GetCreditBalance, ListCreditTransactions.

#### 4. CustomerInvite Aggregate
- **Root**: `CustomerInvite`
- **Invariants**: only sent to customers **not** already on PayCycle; max `attempt_count = 3`; auto-resend only after 7 days since `last_attempt_at`.
- **Domain Events**: `CustomerInviteSent`, `CustomerInviteSignedUp`.
- **Commands**: SendBulkInvites, ResendInvite (cron), MarkInviteSignedUp.
- **Queries**: ListInvites, GetInviteSummary.

#### 5. ReferralLeaderboard Aggregate (read model)
- Pre-computed projection. Recomputed by cron; never written on the request path. Query-only for clients.

### Aggregate Boundaries (owned vs referenced-by-ID)
- `VendorCredit` **owns** its `CreditTransaction` rows (Prisma relation, CASCADE).
- Everything else references other aggregates **by ID only**: `referrerVendorId`, `refereeVendorId`, `vendorId`, `referrerCustomerId`, `refereeCustomerId` are plain `BigInt` FKs. No cross-aggregate object navigation into `Customer`/`Vendor`/`SubscriptionInvoice` from referral domain entities (read ports return scalars).

---

## Schema Reconciliation Table (Story inline SQL → Canonical db-design → Decision)

> Pattern follows US-005 / US-012 reconciliation notes. **Canonical `15-referrals-rewards.sql` wins on conflict.**

| # | Concern | Story inline SQL | Canonical `15-referrals-rewards.sql` | Decision & Rationale |
|---|---|---|---|---|
| 1 | PK type | `INT` | `BIGSERIAL` (`BigInt`) | **Canonical.** Project-wide convention is `BigInt` PKs. |
| 2 | Enum casing | lowercase (`'pending'`) | UPPER_SNAKE (`'PENDING'`) | **Canonical.** Matches Prisma enum convention + `z.nativeEnum()`. |
| 3 | Referee naming | `referred_vendor_id`, `referred_phone_number` | `referee_vendor_id`, `referee_phone`, `referee_name` | **Canonical.** Ubiquitous language = "referee". |
| 4 | Referral status values | `pending, signed_up, active, churned` | `PENDING, SIGNED_UP, QUALIFIED, REWARDED` | **Canonical**, with adaptation: "active/churned" are **derived**, not status values. `QUALIFIED` replaces "active" (≥3 customers/30d bar from feature §10.4.11). Churn is detected by cron → triggers clawback (ledger `ADJUSTMENT`), not a status. See OQ-2. |
| 5 | Reward storage | separate `referral_rewards` table (per-reward rows) + `vendor_credits` (per-credit rows) | `credit_transactions` immutable ledger + `vendor_credits` single balance row | **Canonical.** Drop `referral_rewards` and the per-credit `vendor_credits` shape. Each reward becomes one `EARNED` ledger row (`source_type=VENDOR_REFERRAL`, `source_id=vendor_referral.id`, `description` encodes reward kind e.g. `SIGNUP_BONUS`/`MILESTONE_10`/`MILESTONE_50`/`REVENUE_SHARE:2026-05`). Balance lives in `vendor_credits`. This is a cleaner ledger model and matches module 11 discipline. **Reward kind** is captured in a new column (see delta #A). |
| 6 | Milestone date columns | `milestone_10_customers_date`, `milestone_50_customers_date`, `first_customer_date`, `signup_date` on `vendor_referrals` | not present | **Add as net-new columns** on `vendor_referrals` (delta #B). They are idempotency guards for milestone payouts and are referenced by the story's milestone logic. Kept on the referral row (single-aggregate, not cross-aggregate). |
| 7 | Customer invites table | story `customer_invites` (referral outreach, `attempt_count`, `auto_resend`) | **NOT in module 15.** A different `customer_invites` already exists in **module 13** (US-007 onboarding, `invite_code`, `customer_invite_supply_lists`). | **Conflict — resolved by rename.** The US-013/onboarding `customer_invites` is the existing Prisma `CustomerInvite`. To avoid a table collision, the **growth/outreach** invites here use a NEW table **`referral_customer_invites`** (delta #E). Documented as OQ-3. |
| 8 | Vendor credit columns on `vendors` | `total_credits_earned`, `available_credits` on `vendors` | tracked in `vendor_credits` | **Canonical.** Do NOT add credit columns to `vendors`; use `vendor_credits` (`available_credits`, `lifetime_credits_earned`, `lifetime_credits_used`). `vendors.referral_code` + `referred_by_vendor_id` already exist and are reused. |
| 9 | Reward `reward_type` enum | `signup_bonus, milestone_10, milestone_50, revenue_share` | `vendor_reward_type = SUBSCRIPTION_DISCOUNT, CASH_CREDIT, FREE_MONTHS` | **Mismatch.** Canonical `vendor_reward_type` describes *how a referral is rewarded* (form), not the *trigger*. Decision: keep canonical `vendor_reward_type`/`reward_amount` columns on `vendor_referrals` (they record the headline reward), and capture the **trigger kind** in the ledger `credit_transactions.reward_kind` (new column, delta #A) using a new enum `ReferralRewardKind = SIGNUP_BONUS, MILESTONE_10, MILESTONE_50, REVENUE_SHARE, CUSTOMER_REFERRAL`. |
| 10 | Geo / PostGIS | story §Tech: "PostGIS for nearby vendors"; no geo columns in any SQL | no geo columns; `customers.locality`/`area`, `vendors.category` exist (varchar) | **No PostGIS in this iteration.** `customers`/`vendors` have no lat/long and adding PostGIS is a DB-extension + backfill decision out of scope here. Implement `nearby-vendors` as **locality/area string-match** grouping (same `locality` text) + category grouping, returning distance as `null`. Flagged as **OQ-1** (primary geo decision). |
| 11 | Redemption / withdrawal records | story mentions withdraw (min ₹2000, 10% fee) but no table | no withdrawal table | Withdrawals are modeled as a `USED` ledger row with `source_type=MANUAL` + `description='WITHDRAWAL'`; **a payout-execution table is out of scope** (no real bank rail). Withdrawal returns `PENDING_PAYOUT` status echoed from the ledger row. Flagged OQ-5. |
| 12 | `credit_transactions.amount` sign | n/a | CHECK `amount > 0` | **Canonical** kept. Direction is carried by `transaction_type` (`EARNED`/`USED`/`EXPIRED`/`ADJUSTMENT`), amount always positive. Clawback = `ADJUSTMENT` with `transaction_type` semantics "reduce" — to keep `amount>0`, clawback is recorded as a `USED`-like reduction? **Decision:** add no new constraint; use `transaction_type=ADJUSTMENT` and interpret ADJUSTMENT as a *decrease* of available credits (balance_after reflects it). `amount` stays positive (magnitude of reversal). |

### Net-new schema deltas to apply to `15-referrals-rewards.sql` (and Prisma)
- **#A** `credit_transactions.reward_kind referral_reward_kind NULL` + new enum `referral_reward_kind`.
- **#B** `vendor_referrals`: add `signup_date DATE NULL`, `first_customer_date DATE NULL`, `milestone_10_at TIMESTAMPTZ NULL`, `milestone_50_at TIMESTAMPTZ NULL`, `revenue_share_until DATE NULL` (6-month window end), `clawed_back_at TIMESTAMPTZ NULL`.
- **#C** `vendor_referrals`: add **partial unique index** `uq_vendor_referrals_referee ON (referee_vendor_id) WHERE referee_vendor_id IS NOT NULL` (one referrer per referee).
- **#D** `vendor_referrals`: add **CHECK** `chk_vendor_referrals_no_self CHECK (referee_vendor_id IS NULL OR referee_vendor_id <> referrer_vendor_id)`.
- **#E** New table `referral_customer_invites` (growth outreach; avoids collision with module-13 `customer_invites`). Columns: `id BIGSERIAL`, `vendor_id BIGINT NOT NULL`, `customer_id BIGINT NULL`, `phone VARCHAR(15) NOT NULL`, `status referral_invite_status NOT NULL DEFAULT 'SENT'`, `message_language VARCHAR(10)`, `attempt_count INT NOT NULL DEFAULT 1`, `auto_resend BOOLEAN NOT NULL DEFAULT TRUE`, `max_attempts INT NOT NULL DEFAULT 3`, `sent_at TIMESTAMPTZ`, `last_attempt_at TIMESTAMPTZ`, `signed_up_at TIMESTAMPTZ NULL`, `created_at/updated_at/deleted_at`. Enum `referral_invite_status = SENT, DELIVERED, SIGNED_UP, FAILED`. Indexes: `(vendor_id, status)`, `(deleted_at)`, `(created_at)`.
- **#F** `vendor_credits`: add `updated_at` already present; no change. Add index `(vendor_id)` already present.
- **#G** Add `deleted_at TIMESTAMPTZ NULL` to `vendor_referrals`, `customer_referrals` for soft-delete consistency (mandatory per index.md data-integrity rules) + `@@index([deletedAt])`.

> All deltas must be written back into `project_documents/db-design/15-referrals-rewards.sql` (and `index.md` table reference: add `referral_customer_invites`) as part of Stream A, per the architect protocol.

---

## Prisma Schema Deltas + Migration Plan

### Migration
- **Folder**: `prisma/migrations/20260615035636_us014_referral_engine/` (timestamp = current UTC `20260615035636`, verified greater than the last existing migration `20260614200000_us013_language_voice`, so it sorts ascending). Regenerate the real prefix at creation time with `date -u +%Y%m%d%H%M%S` and bump to `last+1s` only if clock skew.
- Generated via `npm run migrate:create -- --name us014_referral_engine`, SQL reviewed, then `migrate:deploy` + `db:generate`.

### New Prisma enums
```
ReferralVendorStatus   { PENDING SIGNED_UP QUALIFIED REWARDED }       @@map("vendor_referral_status")
CustomerReferralStatus { SENT SIGNED_UP QUALIFIED REWARDED }          @@map("customer_referral_status")
VendorRewardType       { SUBSCRIPTION_DISCOUNT CASH_CREDIT FREE_MONTHS } @@map("vendor_reward_type")
CustomerRewardType     { BILL_DISCOUNT FREE_DAYS CASH_CREDIT }         @@map("customer_reward_type")
CreditTransactionType  { EARNED USED EXPIRED ADJUSTMENT }              @@map("credit_transaction_type")
CreditSourceType       { VENDOR_REFERRAL CUSTOMER_REFERRAL SUBSCRIPTION_PAYMENT MANUAL } @@map("credit_source_type")
ReferralRewardKind     { SIGNUP_BONUS MILESTONE_10 MILESTONE_50 REVENUE_SHARE CUSTOMER_REFERRAL } @@map("referral_reward_kind")   // delta #A
ReferralInviteStatus   { SENT DELIVERED SIGNED_UP FAILED }             @@map("referral_invite_status") // delta #E
LeaderboardPeriodType  { WEEKLY MONTHLY ALL_TIME }                     @@map("leaderboard_period_type")
```

### New Prisma models (summary; full column list in `15-referrals-rewards.sql` + deltas)
- `VendorReferral` → `vendor_referrals` (+ delta #B,#C,#D,#G). Mandatory indexes: `referrerVendorId`, `refereeVendorId`, `referralCode`, `status`, `createdAt`, `deletedAt`.
- `CustomerReferral` → `customer_referrals` (+ #G). Indexes: `vendorId`, `referrerCustomerId`, `refereeCustomerId`, `status`, `createdAt`, `deletedAt`.
- `VendorCredit` → `vendor_credits` (unique `vendorId`). Owns `creditTransactions CreditTransaction[]`.
- `CreditTransaction` → `credit_transactions` (+ `rewardKind` #A). Immutable. Indexes: `vendorId`, `transactionType`, `createdAt`.
- `ReferralCustomerInvite` → `referral_customer_invites` (delta #E).
- `ReferralLeaderboard` → `referral_leaderboard` (read model, unique `(vendorId, periodType, periodStart)`).
- `Vendor` back-relations added: `vendorReferralsMade`, `vendorReferralsReceived`, `vendorCredit VendorCredit?`, `creditTransactions`, `referralCustomerInvites`, `referralLeaderboard`. `Customer` back-relations: `customerReferralsMade`, `customerReferralsReceived`.

---

## API Endpoints (CQS classified)

All under `/api/v1/vendors/:vendorId/...`. **Owner-only** (RBAC `referral:*` / `credit:*`). Multi-tenant guard: JWT `vendorId` must equal path `:vendorId` else **404** (mask existence). Full request/response in `API_SPEC.md`.

| # | Method | Path | CQS | Permission | Purpose |
|---|---|---|---|---|---|
| 1 | POST | `/vendors/:vendorId/referrals/vendor` | Command | `referral:create` | Create a vendor referral, return code + shareable message |
| 2 | GET | `/vendors/:vendorId/referrals/dashboard` | Query | `referral:read` | Earnings + per-referral status + milestone progress + customer-growth summary |
| 3 | GET | `/vendors/:vendorId/referrals/vendor` | Query | `referral:read` | Paginated list of vendor referrals |
| 4 | GET | `/vendors/:vendorId/customer-referrals` | Query | `referral:read` | Customer referral summary, top referrers, recent additions |
| 5 | POST | `/vendors/:vendorId/customers/bulk-invite` | Command | `referral:invite` | Bulk WhatsApp invite to customers not on PayCycle |
| 6 | GET | `/vendors/:vendorId/credits` | Query | `credit:read` | Credit balance + lifetime earned/used |
| 7 | GET | `/vendors/:vendorId/credits/transactions` | Query | `credit:read` | Paginated immutable ledger |
| 8 | POST | `/vendors/:vendorId/credits/redeem` | Command | `credit:redeem` | Redeem credits (subscription / upgrade / withdraw) |
| 9 | GET | `/vendors/:vendorId/nearby-vendors` | Query | `referral:read` | Locality/category grouping of nearby PayCycle vendors (NO PostGIS — see OQ-1) |
| 10 | GET | `/vendors/:vendorId/referrals/leaderboard` | Query | `referral:read` | Pre-computed leaderboard for a period |

> Vendor-signup referral attribution and customer-referral recording are **NOT public endpoints** — they are invoked via `ReferralFacade` from the signup/customer flows (internal), per the context map.

---

## Business Rules

### Reward schedule (vendor referral)
- Signup bonus: **₹500** (`SIGNUP_BONUS`) on `SIGNED_UP`.
- Milestone 10 customers: **₹1,000** (`MILESTONE_10`), idempotent via `milestone_10_at`.
- Milestone 50 customers: **₹5,000** (`MILESTONE_50`), idempotent via `milestone_50_at`.
- Revenue share: **10%** of referee's paid subscription invoice, monthly, for **6 months** from `signup_date` (`revenue_share_until`). Only when invoice `paymentStatus=PAID`. Skipped months resume if a later month is paid (within window).

### Qualification & clawback
- A referral is `QUALIFIED` when referee reaches **≥3 active customers within 30 days** of signup (feature §10.4.11). Milestone/revenue rewards may pre-accrue but become **clawback-safe** only after qualification.
- Clawback window: referee **churns within 60 days** → reverse all earned credit for that referral via `ADJUSTMENT` ledger rows; set `clawed_back_at`. (OQ-2 defines "churn".)
- Self-referral (same owner phone/device or same vendorId) blocked at create + at signup attribution.

### Credit redemption
- `subscription`: apply credits as a `USED` ledger row + call `SubscriptionCreditPort.applyCreditToNextInvoice(vendorId, amount)`.
- `upgrade`: `USED` row + `SubscriptionCreditPort.applyCreditToUpgrade(...)`.
- `withdraw`: min **₹2,000**, **10% fee**; `USED` row for `amount`, fee captured in description; returns `PENDING_PAYOUT`. Blocked below ₹2,000.
- Redemption amount must be `≤ availableCredits` (else `INSUFFICIENT_CREDITS` 409).

### Customer invites
- Target `all_not_on_paycycle` or `specific[customerIds]`. Skip customers already on PayCycle. Inject vendor `referral_code` into message. `auto_resend` after 7 days, stop after `maxAttempts` (default 3). Rate: batch ≤50/min (cron-paced).

### Rate limiting (fraud)
- Vendor referral creation: **max 10/day per vendor** (`referral:create`), enforced in command via count of `vendor_referrals` created today; **429** on breach (`RATE_LIMITED`).

---

## State Machines

**VendorReferral.status**: `PENDING → SIGNED_UP → QUALIFIED → REWARDED`
- Valid: PENDING→SIGNED_UP (referee signs up with code); SIGNED_UP→QUALIFIED (≥3 cust/30d); QUALIFIED→REWARDED (first reward credited). REWARDED is terminal for status; clawback is an out-of-band ledger reversal that sets `clawed_back_at` (status unchanged).
- Invalid: any backward transition; SIGNED_UP without a `referee_vendor_id`; awarding milestone while `clawed_back_at` set.

**ReferralCustomerInvite.status**: `SENT → DELIVERED → SIGNED_UP` | `SENT → FAILED` (retryable until `attempt_count = maxAttempts`).

---

## Sequence Diagrams (text)

### Vendor signup attribution (internal, via facade)
```
Signup(US-003) --processVendorSignup(refereeVendorId, code)--> ReferralFacade
  ReferralFacade -> VendorReferralRepo.findByCode(code, status=PENDING)
  guard self-referral (referrer != referee owner)            [403 BLOCKED → swallowed/logged]
  referral.attributeSignup(refereeVendorId)  // PENDING->SIGNED_UP, set signup_date, revenue_share_until=+6mo
  Tx { referralRepo.save(referral); EarnCreditCmd(referrer, ₹500, SIGNUP_BONUS) }
     EarnCredit: mapper.toPersistence -> vendorCredit.increment + creditTransaction insert (balance_after)
  publish VendorReferralSignedUp, ReferralRewardEarned -> Notification handler
```

### Milestone detection (cron / on customer-count change)
```
Cron(daily) -> for each SIGNED_UP|QUALIFIED referral:
  count = CustomerCountPort.activeCustomerCount(refereeVendorId)
  if count>=3 within 30d and status<QUALIFIED -> referral.qualify(); event VendorReferralQualified
  if count>=10 and milestone_10_at is null -> set milestone_10_at; EarnCreditCmd(₹1000, MILESTONE_10)
  if count>=50 and milestone_50_at is null -> set milestone_50_at; EarnCreditCmd(₹5000, MILESTONE_50)
```

### Monthly revenue share (cron, 1st of month)
```
Cron(monthly) -> for each referral where signup within revenue_share_until window:
  invoice = SubscriptionInvoicePort.paidInvoiceForMonth(refereeVendorId, lastMonth)
  if invoice and not already shared for that month (ledger dedupe key REVENUE_SHARE:<YYYY-MM>):
     EarnCreditCmd(referrer, invoice.totalAmount * 0.10, REVENUE_SHARE, periodTag=lastMonth)
```

### Credit redemption (subscription)
```
POST /credits/redeem {subscription, amount}
 Controller -> RedeemCreditCommand
   load VendorCredit; guard amount<=availableCredits           [409 INSUFFICIENT_CREDITS]
   Tx { vendorCredit.decrement(amount) + creditTransaction(USED, SUBSCRIPTION_PAYMENT);
        SubscriptionCreditPort.applyCreditToNextInvoice(vendorId, amount) }
   publish CreditRedeemed -> Notification
 mapper.toResponse -> { newBalance, applied }
```

---

## Strategy / Port Interfaces (ACL)

| Port | Layer | Purpose | Adapter (now) |
|---|---|---|---|
| `CustomerCountPort.activeCustomerCount(vendorId): number` | application port | qualification + milestones | Prisma adapter counting `vendor_customers` (status ACTIVE, not deleted) |
| `SubscriptionInvoicePort.paidInvoiceForMonth(vendorId, month)` | application port | revenue share | Prisma adapter on `subscription_invoices` (PAID) |
| `SubscriptionCreditPort.applyCreditToNextInvoice / applyCreditToUpgrade(vendorId, amount)` | application port | redemption | adapter delegating to subscription module public service (stub: marks discount) |
| `InviteMessagePort.send({phone, body, language})` | application port (Strategy) | WhatsApp outreach | log/stub adapter (real WhatsApp later) — `id: 'whatsapp-stub'` |
| `ReferralNotificationPort.notify(event)` | application port | referrer notifications | log/stub adapter |

`ReferralFacade` (inbound port) exposes `processVendorSignup`, `recordCustomerReferral`, `markInviteSignedUp` to other modules.

---

## Error Handling Strategy

| Operation | Condition | Error class | HTTP | Code |
|---|---|---|---|---|
| Create vendor referral | self-referral (own phone) | `ForbiddenError` | 403 | `SELF_REFERRAL_BLOCKED` |
| Create vendor referral | >10 today | `TooManyRequestsError` | 429 | `RATE_LIMITED` |
| Create vendor referral | duplicate pending code for same phone | `ConflictError` | 409 | `DUPLICATE_REFERRAL` |
| Any vendor-scoped op | path `:vendorId` ≠ JWT vendor | `NotFoundError` | 404 | `NOT_FOUND` (mask) |
| Redeem | amount > available | `ConflictError` | 409 | `INSUFFICIENT_CREDITS` |
| Redeem withdraw | available < ₹2000 | `BadRequestError` | 400 | `WITHDRAWAL_THRESHOLD` |
| Redeem | invalid `redemptionType` | `BadRequestError` | 400 | `VALIDATION_ERROR` |
| Bulk invite | no eligible customers | returns 200 with `totalSent:0` (not an error) | 200 | — |
| Attribution (internal) | referee already attributed | swallow + log (first-wins) | — | — |

All errors carry `correlationId` and are logged to `Logs/YYYY-MM-DD.txt` per MEMORY (`feedback_error_logging.md`).

### Multi-tenant masking
Any access where JWT vendor ≠ `:vendorId`, or a referral/credit row not owned by the JWT vendor, returns **404 NOT_FOUND** — never 403, never revealing existence.

---

## Cron Jobs

Registered in `src/modules/referral/referral.cron.ts`, gated behind `ENABLE_CRON=true`, timezone `Asia/Kolkata` (matches credit/subscription cron pattern).

| Schedule | Job | Action |
|---|---|---|
| `0 2 * * *` (daily 02:00) | MilestoneSweep | Recompute referee customer counts; qualify + pay milestones idempotently |
| `0 3 * * *` (daily 03:00) | ClawbackExpirySweep | Detect referee churn within 60d → clawback; expire credits older than 1 year |
| `0 9 * * *` (daily 09:00) | InviteResendSweep | Auto-resend invites >7d old, `attempt_count < maxAttempts` |
| `0 1 1 * *` (monthly, 1st 01:00) | RevenueShareSweep | 10% of last month's paid referee invoices within 6-month window |
| `0 4 * * 1` (weekly Mon 04:00) | LeaderboardRecompute | Rebuild `referral_leaderboard` (WEEKLY/MONTHLY/ALL_TIME) |

---

## Integration Points (existing modules)

- **Customer (US-008)**: `CustomerCountPort` counts `vendor_customers` (ACTIVE, `deleted_at IS NULL`) for qualification + milestones. No referral table writes from customer module.
- **Subscription (US-009)**: `SubscriptionInvoicePort` reads `subscription_invoices.paymentStatus=PAID` for revenue share; `SubscriptionCreditPort` applies redeemed credit to next invoice / upgrade.
- **Credit (US-012)**: distinct concept — US-012 is *customer↔vendor* receivables; this module is *vendor platform credits*. No table overlap (`vendor_credits`/`credit_transactions` here vs `account_balances`/`transactions` in module 11). Naming proximity noted in OQ-4.
- **Auth/Signup (US-003)**: calls `ReferralFacade.processVendorSignup`. `vendors.referral_code` is generated at vendor creation (already a column); referral module reads it, does not own generation. OQ-6.
- **Notification / Language (US-013)**: invite + reward messages should use `language_templates` where possible; stubbed for now.

---

## Security Considerations
- Owner-only RBAC on every endpoint; new permissions seeded (`referral:create/read/invite`, `credit:read/redeem`).
- Self-referral & rate-limit guards prevent reward farming.
- Credit ledger immutable + atomic → no balance tampering / race double-spend.
- Multi-tenant masking (404) on all cross-tenant access.
- Withdrawal is gated and stubbed (no live bank rail) to avoid premature money-movement risk.

## Performance Considerations
- Mandatory indexes on all FKs + `(vendorId, status)` composites.
- Leaderboard & dashboard are read-heavy → leaderboard pre-computed by cron; dashboard cached 5-min TTL (story §Performance) at the query handler.
- Bulk invite batched ≤50/min via cron pacing.
- Revenue-share & milestone sweeps iterate only candidate referrals (status-filtered, windowed) — indexed scans.
- `nearby-vendors` (locality string match) is a cheap indexed query on `customers.locality` / `vendors.category`; revisit if PostGIS adopted (OQ-1).

---

## Open Questions

**Q1 (geo / nearby-vendors)**: No PostGIS columns or lat/long exist on `vendors`/`customers` (only `locality`/`area` varchar). How should "nearby vendors within Nkm" work?
**Recommended**: Ship v1 as **locality/area string-match + category grouping**, returning `distance: null` and `radius` ignored (echoed back). Defer PostGIS to a follow-up US (adds `earth_distance`/`postgis` extension, lat/long columns on `vendors`, an address-geocode backfill, and a GIST index).
**Trade-off**: Gains: no DB extension, no backfill, ships now, matches the wireframe's category-grouped layout. Loses: true radius accuracy and the `radius` query param is cosmetic until PostGIS lands. *(Provisional default applied in API_SPEC.)*

**Q2 (churn definition for clawback)**: The 60-day clawback needs a precise "churned" definition. Candidates: (a) referee vendor soft-deleted; (b) referee subscription status `CANCELLED`/`EXPIRED`; (c) referee fell below 3 active customers.
**Recommended**: **(b) subscription `CANCELLED`/`EXPIRED` within 60 days of signup** as the canonical churn signal (objective, already tracked in US-009), with (a) as a hard override.
**Trade-off**: Gains: deterministic, uses existing subscription lifecycle. Loses: a vendor who keeps a subscription but goes inactive isn't clawed back (acceptable — they're still a paying platform user). *(Provisional default applied.)*

**Q3 (invite table collision)**: A `customer_invites` table already exists (module 13, US-007 onboarding). The story's growth "customer_invites" is a different concept.
**Recommended**: Create a **new `referral_customer_invites`** table for growth outreach; leave module-13 `customer_invites` untouched.
**Trade-off**: Gains: no breaking change to onboarding; clear separation of concerns. Loses: two invite tables — slight conceptual overlap; a future consolidation US may merge them. *(Provisional default applied; new table added to db-design.)*

**Q4 (credit naming collision)**: US-012 already has `credit` semantics (customer receivables: `account_balances`, `transactions`, permission `credit:*`). This module also uses "credit" (`vendor_credits`, `credit_transactions`) and proposes `credit:read`/`credit:redeem` permissions.
**Recommended**: Keep canonical table names but **namespace permissions as `vendor_credit:read` / `vendor_credit:redeem`** to avoid clashing with US-012's `credit:*`; module folder `src/modules/referral/`.
**Trade-off**: Gains: no RBAC ambiguity with the existing credit-control module. Loses: slightly longer permission strings; frontend must use `vendor_credit:*`. *(Provisional — applied in API_SPEC as `vendor_credit:*`. Confirm preferred string.)*

**Q5 (cash withdrawal execution)**: No bank-payout rail or payout table exists. How real should withdrawal be in v1?
**Recommended**: Model withdrawal as a `USED` ledger entry returning status `PENDING_PAYOUT` (10% fee recorded), **no actual money movement**; a real payout integration is a separate US.
**Trade-off**: Gains: unblocks the redemption UI and credit math now; safe. Loses: funds aren't actually transferred — needs an ops/manual or future gateway step. *(Provisional default applied.)*

**Q6 (referral code ownership)**: `vendors.referral_code` already exists but may be unpopulated for existing vendors; the story has a generation algorithm (`[PREFIX][4DIGITS]`).
**Recommended**: Generate the code **lazily on first referral creation** if `vendors.referral_code` is null (and persist it back to `vendors`), using the story's `[BUSINESSPREFIX][4DIGITS]` uniqueness loop. Backfill for all vendors is a separate chore.
**Trade-off**: Gains: no migration backfill needed; codes exist exactly when needed. Loses: a vendor has no code until they first refer (acceptable — dashboard can also trigger lazy generation). *(Provisional default applied.)*

**Q7 (customer referral reward funding)**: AC says "Customer receives ₹50 credit (PayCycle pays)". There is no customer-credit wallet in scope (US-012 is receivables, not a customer reward wallet).
**Recommended**: Record the customer-referral reward as a `customer_referrals.referrer_reward_amount = 50` + a `BILL_DISCOUNT` reward_type (applied as a bill adjustment in the vendor's book), **not** a separate customer wallet, for v1.
**Trade-off**: Gains: reuses existing billing; no new wallet table. Loses: not a true cash credit to the customer — it's a bill discount. Revisit if a customer wallet is introduced. *(Provisional default applied.)*

**Q8 (revenue-share base amount)**: Story uses `subscription_invoices.amount`; canonical invoice has `amount`, `tax`, `total_amount`. 10% of which?
**Recommended**: 10% of **`amount`** (pre-tax subscription fee), not `total_amount` — revenue share shouldn't pay out platform tax.
**Trade-off**: Gains: economically correct (share of revenue, not tax). Loses: marginally lower payout than 10% of total. *(Provisional default applied.)*

---

## Skills Referenced (for Dev/Review)
`ddd-module-design.md`, `domain-modeling.md`, `prisma-schema-design.md` (current-timestamp migration prefix), `api-contract-design.md`, `validation-schemas.md`, `error-handling.md`, `repository-implementation.md`, `service-implementation.md`, `module-scaffold.md`, `testing-strategy.md`.
