# Feature Tasks: Credit Control & Outstanding Management (US-012)

## Complexity: Complex — Skills to follow:
`prisma-schema-design`, `domain-modeling`, `validation-schemas`, `repository-implementation`,
`service-implementation`, `api-contract-design`, `error-handling`, `testing-strategy`,
`module-scaffold`.

New module: `src/modules/credit/`. **Mandatory** `commands/` + `queries/` subdirs (per
MEMORY: flat layout is never acceptable). All cross-module access goes through ports in
`src/modules/credit/ports/` with adapters in `src/modules/credit/adapters/` (raw Prisma; no
importing customer/delivery module classes). See `DOMAIN_MODEL.md` and `FEATURE_PLAN.md`.

> Each Phase starts only after all streams in the prior phase complete. Streams within a
> phase own non-overlapping files and run simultaneously.

---

### Phase 1 (parallel — no cross-stream dependencies)

#### Stream A: Data Foundation
**Files owned**: `prisma/schema.prisma`, `prisma/migrations/`, `prisma/seeds/` (credit seed files only)
**Skills**: `prisma-schema-design.md`
- **Task A1**: Add 5 enums (`CreditType`, `CreditBreachAction`, `ReminderChannel`,
  `ReminderStatus`, `ReminderResponseType`) and 3 models (`CustomerCreditSettings`,
  `ReminderConfig`, `PaymentReminder`) to `prisma/schema.prisma` exactly per
  `FEATURE_PLAN.md` → Data Model Changes. Add the back-relation fields to `Customer`
  (`customerCreditSettings?`, `paymentReminders[]`) and `Vendor` (`reminderConfig?`,
  `paymentReminders[]`). **Do NOT add `credit_limit` to `customer_credit_settings`** and
  **do NOT add columns to `customers`** (OQ-1, OQ-2). Include all mandatory indexes listed
  in the plan. Output: updated `schema.prisma`.
- **Task A2**: Create the migration. In the migration SQL, add the **partial unique index**
  on `payment_reminders (customer_id, reminder_date)` (Prisma can't express it) for same-day
  idempotency. Output: new folder under `prisma/migrations/`.
- **Task A3**: Seed permissions `credit:read` and `credit:write` (`resource='credit'`) and
  grant both to the **owner** role. Add faker dev seed: one `reminder_config` (auto off),
  ~5 `customer_credit_settings` rows (mixed type/threshold/action), ~15 `payment_reminders`
  with mixed status/response for the demo vendor. Output: credit seed file(s) under
  `prisma/seeds/`.

#### Stream B: Domain Core
**Files owned**: `src/modules/credit/domain/**`
**Skills**: `domain-modeling.md`
- **Task B1**: Value objects in `domain/value-objects/`: `credit-type.vo.ts`,
  `warning-threshold.vo.ts` (0–100), `breach-action.vo.ts`, `aging-bucket.vo.ts`
  (`fromDaysOverdue`), `collection-priority.vo.ts` (`evaluate`). Self-validating; throw
  `ArgumentInvalidException`. Follow the existing `credit-limit.vo.ts` style.
- **Task B2**: `domain/credit.types.ts` (enums + props interfaces) and
  `domain/customer-credit-settings.entity.ts` with `create`/`reconstitute`/`getProps`,
  `setPolicy`, `enablePrepaid`, `evaluateBreach(balance, creditLimit)`, and `validate()`
  enforcing invariants 1–5 from `DOMAIN_MODEL.md`.
- **Task B3**: `domain/reminder-config.entity.ts` (with template/schedule invariants) and
  `domain/payment-reminder.entity.ts` (append-only, `create`/`reconstitute`).
- **Task B4**: `domain/credit.errors.ts` (`CreditSettingsNotFoundError` 404,
  `InvalidCreditTransitionError` 409, `ReminderConfigNotFoundError` 404) and
  `domain/events/*.domain-event.ts` (4 events per `DOMAIN_MODEL.md`). Follow existing
  `customer/domain/events` and `customer.errors.ts` style.

#### Stream C: Validation Layer
**Files owned**: `src/modules/credit/credit.validator.ts`
**Skills**: `validation-schemas.md`
- **Task C1**: Zod schemas: path params (`vendorIdParamSchema`, `customerParamsSchema`
  redefined locally), `setCreditSettingsSchema` (.strict, ≥1 field, `z.nativeEnum`-style
  enums, threshold 0–100), `enablePrepaidSchema`, `singleReminderSchema`,
  `sendBulkSchema` (discriminated by `target`), `updateReminderConfigSchema` (.strict, ≥1
  field), `prioritySortQuerySchema` (.passthrough, sort enum), `analyticsQuerySchema`
  (`month` `^\d{4}-\d{2}$`), `reminderHistoryQuerySchema` (page/limit). Output: `credit.validator.ts`.

---

### Phase 2 (parallel — after Phase 1 complete)

#### Stream D: Repositories (data access)
**Files owned**: `src/modules/credit/database/**`, `src/modules/credit/credit.mapper.ts`
**Skills**: `repository-implementation.md`
**Depends on**: Stream A (schema), Stream B (domain types/entities)
- **Task D1**: Ports + adapters for the 3 models:
  `credit-settings.repository.{port,ts}` (findByCustomer, upsert),
  `reminder-config.repository.{port,ts}` (findByVendor, upsert),
  `payment-reminder.repository.{port,ts}` (insert, existsForDate, listByCustomer paginated,
  countByCustomer + successRate aggregation). Soft-delete N/A; map P2002 → ConflictError.
- **Task D2**: `credit.mapper.ts` — `toPersistence`/`toDomain` for settings + reminder
  config; `toSettingsResponse`, `toReminderResponse`, and read-model response builders
  (dashboard, priority card, aging, analytics, reminder history). Whitelist fields; ids as
  strings, dates as `YYYY-MM-DD`.

#### Stream E: ACL Ports & Adapters
**Files owned**: `src/modules/credit/ports/**`, `src/modules/credit/adapters/**`
**Skills**: `repository-implementation.md`, `ddd-module-design.md` (ACL section)
**Depends on**: Stream B (types). Independent of Stream D files.
- **Task E1**: `ports/credit-balance.port.ts` + `adapters/credit-balance.adapter.ts` — raw
  Prisma: `getBulkBalances`, `getCustomerBalance`, `getOldestUnpaidServiceDate` (batched,
  FIFO per OQ-6), `getMonthlyBilled`, `getMonthlyCollected`, `getPaymentModeBreakdown`,
  `getCollectionTrend` (6 months), `getTopPayers`. Reuse the balance SQL shape from
  `customer/adapters/delivery-billing.adapter.ts` (copy the logic; do NOT import it).
- **Task E2**: `ports/credit-customer.port.ts` + adapter — read
  name/phone/creditLimit/paymentScore/status by `vendorId`; `setCreditLimit` updating
  `customers.credit_limit` (raw Prisma update scoped by vendor via vendor_customers).
- **Task E3**: `ports/delivery-control.port.ts` + adapter — `pauseCustomer(customerId,
  vendorId)` setting `vendor_customers.status = PAUSED` (idempotent).
- **Task E4**: `ports/reminder-notification.port.ts` +
  `adapters/reminder-notification-log.adapter.ts` — log-stub, masks phone, never throws,
  returns `{status:'SENT'}`. Mirror `staff/adapters/staff-notification-log.adapter.ts`.

---

### Phase 3 (parallel — after Phase 2 complete)

#### Stream F: Command Handlers
**Files owned**: `src/modules/credit/commands/**`
**Skills**: `service-implementation.md`, `error-handling.md`
**Depends on**: Streams B, D, E
- **Task F1**: `set-credit-settings/` (Command) — flow per `FEATURE_PLAN.md` sequence
  (tenant guard via CreditCustomerPort, optional setCreditLimit, upsert policy, breach eval
  + pause, events, mapped result incl. `warning`).
- **Task F2**: `enable-prepaid/` (Command) — clearOutstandingFirst logic (OQ-3), 409 on
  already-prepaid, emit `CustomerPrepaidEnabled`, notification stub.
- **Task F3**: `send-bulk-reminders/` (Command) + `send-single-reminder/` (Command) —
  target resolution, skip rules (paid/excluded/inactive/duplicate-today), template render,
  notification port, insert reminder rows, `{sent,skipped,failed}` / single result.
- **Task F4**: `update-reminder-config/` (Command) — upsert, invariant (auto-on needs a
  schedule), template placeholder validation, emit `ReminderConfigUpdated`.

#### Stream G: Query Handlers
**Files owned**: `src/modules/credit/queries/**`
**Skills**: `service-implementation.md` (Query/CQS), `repository-implementation.md`
**Depends on**: Streams D, E
- **Task G1**: `get-collections-dashboard/`, `get-outstanding-aging/` — aging accumulation
  via `AgingBucket`, net receivable, this-month progress (target from VendorSettings).
- **Task G2**: `get-priority-list/` — priority via `CollectionPriority`, advance-credit
  bucket, sortable by `sort` param.
- **Task G3**: `get-collection-analytics/` — monthly summary, mode breakdown, 6-month
  trend, top payers, defaulters.
- **Task G4**: `get-reminder-history/`, `get-reminder-config/` — paginated history +
  success rate; config with system defaults when none saved.

---

### Phase 4 (parallel — after Phase 3 complete)

#### Stream H: Interface Layer
**Files owned**: `src/modules/credit/credit.controller.ts`, `src/modules/credit/credit.routes.ts`,
`src/modules/credit/credit.cron.ts`, `src/app.ts` (mount), Swagger annotations
**Skills**: `module-scaffold.md` (Steps 5–9), `api-contract-design.md`
**Depends on**: Streams C, F, G
- **Task H1**: `credit.controller.ts` — arrow-fn handlers, `vendorId`/`customerId` from
  validated params, `try/catch → next(error)`, correlationId logging.
- **Task H2**: `credit.routes.ts` — composition root wiring all repos/ports/adapters,
  commands, queries; middleware chain `authenticateToken → validate(params) →
  validate(body/query) → identifyUserRole('vendorId') → requireOwnerRole() → writeLimiter
  (writes)`. Mount the 11 endpoints from `FEATURE_PLAN.md`. Register in `src/app.ts`.
- **Task H3**: `credit.cron.ts` — `RunScheduledReminders` + `RunPrepaidBalanceCheck` gated
  by `ENABLE_CRON=true` (mirror `subscription.cron.ts`). Register in the cron bootstrap.

#### Stream I: Tests
**Files owned**: `src/modules/credit/__tests__/**`, `tests/integration/credit.test.ts`
**Skills**: `testing-strategy.md`
**Depends on**: all prior streams
- **Task I1**: Unit tests — VOs (aging/priority classifiers, threshold bounds), entity
  invariants (unlimited→warn, prepaid transitions, evaluateBreach), mapper whitelist,
  command logic with mocked ports (skip rules, clear-outstanding-first, breach→pause).
- **Task I2**: Integration tests — HTTP lifecycle for all 11 endpoints incl. auth/RBAC
  (owner vs staff 403), multi-tenant isolation (foreign customer → 404), correlationId in
  errors, dashboard/aging/priority/analytics numeric correctness, bulk-reminder skip
  counts, reminder-config defaults.
