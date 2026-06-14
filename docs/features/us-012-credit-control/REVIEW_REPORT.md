# Code Review Report: Credit Control & Outstanding Management (US-012)

## Summary
- **Date**: 2026-06-14
- **Reviewer**: Review Agent
- **Feature Plan**: `docs/features/us-012-credit-control/FEATURE_PLAN.md`
- **Complexity Tier**: Complex
- **Overall Assessment**: Approved with Conditions (pass-with-fixes)

Lint passes (0 errors, 63 warnings — all pre-existing). Build passes cleanly. The architecture
is sound: dependency rule respected, domain layer is framework-free, ports & adapters are
properly defined, mapper whitelists are in place. The blockers are small targeted fixes; no
redesign is needed.

---

## Statistics

| Severity     | Count |
|--------------|-------|
| BLOCKER      | 0     |
| CRITICAL     | 3     |
| MAJOR        | 4     |
| MINOR        | 2     |
| INFO         | 2     |

---

## Findings

### CRITICAL-1: No tests exist for any business logic

- **File**: `src/modules/credit/__tests__/` (directory is absent)
- **Skill Violated**: `testing-strategy.md` — "Domain entity tests exist", "Value object tests exist", "Service unit tests exist", "Integration tests exist"
- **Description**: The `__tests__/` directory expected by the module scaffold is entirely
  absent. There are no unit tests for the three entities, five value objects, or any of the
  seven command/query handlers. There are no integration tests for any of the eleven endpoints.
  The feature plan is a complex tier with rich domain invariants (credit transitions, prepaid
  rules, breach evaluation, reminder idempotency) — none of these are covered.
- **Expected**: At minimum: `domain/customer-credit-settings.entity.test.ts` (factory,
  invariants, `evaluateBreach`, `setPolicy`, `enablePrepaid`), `domain/aging-bucket.vo.test.ts`,
  `domain/collection-priority.vo.test.ts`, unit tests for `SetCreditSettingsCommand` and
  `EnablePrepaidCommand` mocking their ports, and at least one integration test covering the
  happy path + a 404 tenant-isolation path for each tier of endpoint.
- **Fix**: Dev must add tests before QA begins. This is the gate.

---

### CRITICAL-2: Fully-paid customers (balance = 0) incorrectly appear in the priority list

- **File**: `src/modules/credit/queries/get-priority-list/get-priority-list.query.ts:82-86`
- **Skill Violated**: `service-implementation.md` Business Rule compliance; FEATURE_PLAN.md
  aging rule: "Only customers with `balance > 0` are aged."
- **Description**: The code checks `if (balance < 0)` first (advance credit bucket), then
  falls through to `if (balance <= 0)` which catches exactly-zero balances and pushes them
  to the `lowPriority` list with outstanding = 0. A customer who is fully paid (balance = 0)
  should not appear in any priority bucket. The dashboard and aging queries correctly skip
  `balance <= 0`; the priority list is inconsistent.
- **Expected**:
  ```typescript
  // After the advance-credit check (balance < 0):
  if (balance === 0) {
    // Fully paid — omit from all priority buckets
    continue;
  }
  ```
- **Fix**: Replace lines 82-86:
  ```typescript
  if (balance <= 0) {
    // balance < 0 was already caught above; balance === 0 means fully paid — skip
    continue;
  }
  ```

---

### CRITICAL-3: `setCreditLimit` adapter performs an unscoped customer write

- **File**: `src/modules/credit/adapters/credit-customer.adapter.ts:93-101`
- **Skill Violated**: `service-implementation.md` — Multi-tenant check; `error-handling.md`
  defense-in-depth principle
- **Description**: `setCreditLimit` executes `prisma.customer.update({ where: { id: customerId } })`
  without joining on `vendorId`. The comment says the upstream command validates ownership
  first, but the adapter provides no DB-level guard. If a future refactor or test bypass
  skips the upstream check, any `customerId` could have its `credit_limit` mutated regardless
  of which vendor owns it. The customer aggregate is shared (multi-tenant customers can belong
  to multiple vendors), so writing the limit without vendor scoping is a cross-tenant data
  hazard.
- **Expected**: The adapter should add a guard that at minimum verifies the customer belongs
  to the vendor before mutating:
  ```typescript
  async setCreditLimit(customerId: bigint, vendorId: bigint, amount: number): Promise<void> {
    // Verify membership belongs to this vendor before mutating
    const membership = await prisma.vendorCustomer.findFirst({
      where: { customerId, vendorId, deletedAt: null },
    });
    if (!membership) {
      throw new NotFoundError('Customer not found');
    }
    await prisma.customer.update({
      where: { id: customerId },
      data: { creditLimit: amount },
    });
  }
  ```
- **Note**: The severity is CRITICAL (not BLOCKER) because the upstream `getCustomer()` call
  does enforce the tenant check today, but absence of defense-in-depth in the adapter is a
  structural gap that must be fixed.

---

### MAJOR-1: `toPriorityCard` hardcodes `creditType: 'normal'`

- **File**: `src/modules/credit/credit.mapper.ts:161`
- **Skill Violated**: `module-scaffold.md` — "Response DTOs use whitelist (no entity
  spreading)"; the whitelist must include correct data.
- **Description**: The mapper always returns `creditType: 'normal'` for every customer in the
  priority card. PREPAID and UNLIMITED customers will show the wrong credit type in the frontend.
  The `CustomerCreditRow` returned by `CreditCustomerPort` does not carry `creditType` (that
  lives in `customer_credit_settings`), but the mapper should not silently lie by hardcoding it.
- **Expected**: Either (a) load credit type from `CreditSettingsRepository` in the query and
  pass it to the mapper, or (b) omit `creditType` from the card until it can be correctly
  populated. The API spec includes `creditType` in the priority card response so the field
  must be accurate.
- **Suggested fix** (option a — preferred): In `GetPriorityListQuery.execute`, after loading
  customers, fetch a `Map<customerId, CreditTypeEnum>` from the settings repo and pass it
  through to `_buildCard`. Extend the mapper param accordingly:
  ```typescript
  static toPriorityCard(params: {
    customer: CustomerCreditRow;
    balance: number;
    daysOverdue: number;
    utilizationPercent: number;
    creditType: string; // from customer_credit_settings
  }) { ... }
  ```
  Default to `'normal'` only when no settings row exists.

---

### MAJOR-2: Bulk reminder `processed` counter does not account for `failed` rows

- **File**: `src/modules/credit/commands/send-bulk-reminders/send-bulk-reminders.command.ts:72,141`
- **Skill Violated**: `service-implementation.md` — Focused, correct business logic
- **Description**: The `processed` counter increments only after the reminder-insert block
  (including the `failed` path at line 135). But `failed` increments when the
  notification port returns `FAILED` _and_ the DB insert succeeds. The overall
  cap of `MAX_PER_BATCH = 50` applies to "attempted sends", which is the right intent.
  However, when the `insert` throws (caught at line 136 → `skipped++`), `processed` also
  increments (line 141 runs). This is a minor accounting issue: a duplicate-detect
  mid-batch counts toward the 50 cap as if it were an attempted send, which is actually
  correct (idempotency guard still consumed a slot). The real bug is: `failed++` at line 135
  and `skipped++` at line 138 both fall through to `processed++` at line 141, so all three
  paths advance the cap counter. This is the **correct** behavior — the issue is that
  `failed` rows should also be counted in the cap. Reviewing again this is actually correct.
  
  The actual bug: when `insert` throws at line 136 (duplicate), the notification was already
  sent (port.send called at line 114) before the insert fails. The skip counter is incremented
  but the notification was delivered. In practice with the log-stub this is benign; with a
  real provider this would be a double-send. Document as a MAJOR for when a real provider is
  wired. The `existsForDate` check at line 98 should prevent the duplicate in normal flow,
  but a race condition between two concurrent bulk sends could cause this.
- **Expected**: Add a note in code and re-check the idempotency logic order. For the race
  case, the partial-unique index on `(customer_id, reminder_date)` will enforce the DB-level
  guard. The sequence should be: existsForDate → send → insert. The current order is already
  correct. Severity retained as MAJOR for documentation/race awareness.

---

### MAJOR-3: `DomainEventBase` imported from `auth` module domain layer

- **File**: All four domain event files in `src/modules/credit/domain/events/`
- **Skill Violated**: `domain-modeling.md` Rule 9 — "One module = one bounded context — Keep
  modules independent." The domain layer of one module importing from the domain layer of
  another module creates a cross-module domain dependency.
- **Description**: The four credit domain events import `DomainEventBase` from
  `@/modules/auth/domain/events/domain-event.base`. Importing a base class from another
  module's domain creates an invisible coupling: if the auth module moves, renames, or
  changes `DomainEventBase`, all credit events break. The base class should live in a shared
  `/common/domain/` location.
- **Note**: The MEMORY convention `convention_domain_event_base.md` explicitly states this
  path is the approved location for now and every event must extend it. Per MEMORY.md
  override rules, this is the standing decision. Therefore this finding is recorded for
  awareness but is **not actionable** until the MEMORY/Architect revisits the base class
  location. Severity is MAJOR but deferred.

---

### MAJOR-4: `getCollectionTrend` runs 12 sequential DB queries (N+1 on months)

- **File**: `src/modules/credit/adapters/credit-balance.adapter.ts:164-177`
- **Skill Violated**: FEATURE_PLAN.md Performance Considerations ("never N+1")
- **Description**: `getCollectionTrend` iterates 6 months sequentially with `await` inside
  the loop. Each iteration fires 2 Prisma queries (billed + collected) in parallel but the
  months themselves are serial: 6 months × 2 queries = 12 queries chained. The plan defers
  caching but still calls for single-round-trip batch queries for bulk data.
- **Expected**: All 6 months should be fetched concurrently:
  ```typescript
  async getCollectionTrend(vendorId: bigint, months: string[]): Promise<CollectionTrendRow[]> {
    const results = await Promise.all(
      months.map(async (month) => {
        const [billed, collected] = await Promise.all([
          this.getMonthlyBilled(vendorId, month),
          this.getMonthlyCollected(vendorId, month),
        ]);
        return {
          month,
          percentage: billed > 0 ? Math.round((collected / billed) * 100) : 0,
        };
      })
    );
    return results;
  }
  ```
  This collapses 12 sequential round-trips to 12 concurrent ones (2 per month × 6 months).

---

### MINOR-1: Missing `.trim()` on string fields in validation schemas

- **File**: `src/modules/credit/credit.validator.ts`
- **Skill Violated**: `validation-schemas.md` — "All strings use `.trim()`"
- **Description**: `reminderTemplate` (in `updateReminderConfigSchema`), `customMessage`
  (in `singleReminderSchema`, `sendBulkSchema`), and `message` (in `enablePrepaidSchema`)
  are string fields without `.trim()`. User-supplied whitespace could pollute stored templates.
- **Expected**: Add `.trim()` to all optional string fields in command schemas:
  ```typescript
  reminderTemplate: z.string().max(2000).trim().nullable().optional(),
  customMessage: z.string().max(500).trim().optional(),
  message: z.string().max(500).trim().optional(),
  ```

---

### MINOR-2: `sendBulkSchema` `customerIds` array not capped at 100

- **File**: `src/modules/credit/credit.validator.ts:50-64`
- **Skill Violated**: `validation-schemas.md` — "Bulk operations capped at 100 items"
- **Description**: The `selected` discriminated union accepts `customerIds` with `min(1)` but
  no upper bound. The command itself caps processing at `MAX_PER_BATCH = 50`, but Zod should
  reject unreasonably large input before it reaches the command.
- **Expected**:
  ```typescript
  customerIds: z.array(z.string().min(1)).min(1).max(100),
  ```

---

### INFO-1: `GetCollectionAnalytics` imports `prisma` directly in a query handler

- **File**: `src/modules/credit/queries/get-collection-analytics/get-collection-analytics.query.ts:1,80`
- **Description**: The query handler imports `prisma` directly to fetch `vendorSettings`. This
  makes the query dependent on Prisma (infrastructure) in addition to ports. The plan's
  sequence diagram shows `VendorSettings/target` as a port call. For now this is a minor
  architectural inconsistency — the query is still read-only and doesn't break the dependency
  rule, but the `GetCollectionsDashboard` query has the same pattern. A `VendorSettingsPort`
  would be cleaner. Deferred.

---

### INFO-2: `credit.cron.ts` instantiates adapters inside each run function

- **File**: `src/modules/credit/credit.cron.ts:57-68, 113-116`
- **Description**: Each cron job function creates new adapter instances (`new CreditBalanceAdapter()`,
  etc.) on every invocation rather than closing over them at registration time. This is benign
  (adapters are stateless) but wastes GC cycles on every run. Consider passing pre-built
  instances from `registerCreditCron`'s call site or closing over module-level singletons.
  Deferred as non-blocking.

---

## Skill Compliance Summary

| Skill                        | Status | Notes                                                                    |
|------------------------------|--------|--------------------------------------------------------------------------|
| module-scaffold.md           | PARTIAL | Structure and routes correct; missing `__tests__/` entirely (CRITICAL-1) |
| prisma-schema-design.md      | PASS   | All tables, indexes, FKs, enums, onDelete policies correct               |
| domain-modeling.md           | PASS   | Entities, VOs, events, factory+reconstitute, Object.freeze — all correct |
| validation-schemas.md        | PARTIAL | `.strict()` / `.passthrough()` / `z.nativeEnum` correct; missing `.trim()` (MINOR-1), missing `max(100)` on bulk (MINOR-2) |
| repository-implementation.md | PASS   | Port + adapter, P2002 caught, focused methods, no business logic         |
| service-implementation.md    | PARTIAL | Commands/queries correct, CQS classified; priority-list bug (CRITICAL-2), setCreditLimit unscoped (CRITICAL-3) |
| error-handling.md            | PASS   | Correct error classes, next(error) propagation, tenant masking as 404    |
| testing-strategy.md          | FAIL   | No tests exist at all (CRITICAL-1)                                       |

---

## Checklist Verification

### Module Structure
- [x] Complexity assessment matches implementation (Complex tier, full DDD with commands/ queries/)
- [x] Directory structure correct (domain/, database/, commands/, queries/, ports/, adapters/)
- [x] Module registered in `src/app.ts` at `/api/v1/vendors`
- [x] Permissions seeded in `prisma/seeds/index.ts` (credit:read, credit:write, owner role granted)
- [x] Files under 200 lines (all reviewed files within limit)
- [ ] `__tests__/` exists with real tests — MISSING (CRITICAL-1)

### Database Schema
- [x] BigInt autoincrement PK on every model
- [x] snake_case columns via @map()
- [x] Table names snake_case plural
- [x] Timestamps present (createdAt, updatedAt; PaymentReminder correctly omits updatedAt/deletedAt)
- [x] Mandatory indexes: all FKs indexed, createdAt indexed, creditType indexed
- [x] Enums with @@map() snake_case names
- [x] Aggregate boundaries respected (customerId by ID only, no cross-aggregate @relation on settings)
- [x] onDelete policy set on all relations (CASCADE where specified)
- [x] Partial unique index on payment_reminders(customerId, reminderDate) added in migration

### Domain Model
- [x] Domain layer has ZERO framework imports
- [x] Entity uses factory method (static create + static reconstitute)
- [x] Entity validates invariants in validate() called from both factories
- [x] Entity exposes behavior (setPolicy, enablePrepaid, evaluateBreach — not setters)
- [x] Entity getProps() returns Object.freeze
- [x] Entity equals() compares by ID
- [x] Value objects are immutable with structural equality
- [x] Value objects use guard-style validation
- [x] Domain events extend DomainEventBase with correlationId metadata
- [x] Domain events use past tense naming (CustomerCreditBreached, not BreachCredit)

### Validation
- [x] Create/update schemas use .strict()
- [x] Query schemas use .passthrough()
- [ ] All strings use .trim() — MISSING on several optional string fields (MINOR-1)
- [x] Every field has max length
- [x] z.nativeEnum() used for enum validation
- [x] Discriminated union for bulk target (all_overdue vs selected)
- [x] Query params coerced (page/limit use z.coerce.number())
- [ ] Bulk operations capped at 100 — customerIds array uncapped (MINOR-2)

### Repository
- [x] Repository port defined for each aggregate
- [ ] Methods accept tx? PrismaTransaction — NOT present (but repositories don't perform multi-step ops so absence is acceptable for current scope)
- [x] Soft delete enforced where applicable (N/A for these models — correctly omitted)
- [x] P2002 unique constraint caught and thrown as ConflictError
- [x] No business logic in repositories
- [x] Focused methods (findByCustomer, upsert, existsForDate, listByCustomer)

### Service / Commands / Queries
- [x] Every method classified as Command or Query (CQS respected)
- [x] Constructor injection via ports (ICreditSettingsRepository, ICreditBalancePort, etc.)
- [x] Uses domain entity factory for creation
- [x] Uses mapper for responses (CreditMapper.toSettingsResponse etc.)
- [x] No database queries — always through ports/repositories
- [x] No req/res objects in commands/queries
- [x] Multi-tenant check in every command/query that accesses customer data
- [ ] setCreditLimit adapter has no DB-level tenant guard (CRITICAL-3)
- [ ] Priority list includes balance=0 customers in lowPriority (CRITICAL-2)

### Error Handling
- [x] Specific error classes used (NotFoundError, ConflictError, InvalidCreditTransitionError, ArgumentInvalidException)
- [x] Controller always calls next(error)
- [x] Multi-tenant masked as NotFound
- [x] No errors swallowed (catch blocks re-throw or call next)
- [x] Notification failures never fail the command

### Controller & Routes
- [x] Arrow function methods
- [x] try/catch → next(error) in every handler
- [x] No business logic in controller
- [x] vendorId from JWT (req.roleContext.vendorId), never from body
- [x] Routes file is composition root
- [x] Middleware chain: authenticateToken → writeLimiter (writes) → validate → identifyUserRole → requireOwnerRole → handler
- [x] sendSuccess / sendCreated / sendListResponse used consistently

### Security
- [x] Parameterized queries (Prisma ORM + tagged template literals for raw SQL)
- [x] Input validated and trimmed at boundary (partial — see MINOR-1)
- [x] No sensitive data in responses (phone numbers not in responses; only in log-stub masked)
- [x] Phone numbers masked in logs (maskPhone utility)
- [x] Rate limiting applied on write endpoints
- [x] Tenant isolation enforced in every command/query via getCustomer() check

---

## What Needs to Be Fixed Before QA

**Must fix (CRITICAL):**
1. **CRITICAL-1** — Add unit tests for entities, value objects, and commands; add integration tests for the endpoints.
2. **CRITICAL-2** — Remove `balance === 0` customers from the priority list (one-line change in `get-priority-list.query.ts`).
3. **CRITICAL-3** — Add a vendor-membership guard inside `setCreditLimit` in the adapter.

**Should fix (MAJOR):**
4. **MAJOR-1** — Fix hardcoded `creditType: 'normal'` in `toPriorityCard`. Load actual credit type from settings.
5. **MAJOR-4** — Parallelize `getCollectionTrend` over months with `Promise.all`.

**MAJOR-2 and MAJOR-3** are noted but deferred (MAJOR-2 is a race-condition doc note; MAJOR-3 is blocked by MEMORY standing decision).

**Can fix in follow-up (MINOR/INFO):**
6. **MINOR-1** — Add `.trim()` to optional string fields.
7. **MINOR-2** — Add `.max(100)` to `customerIds` array.
