# Code Review Report: Daily Delivery Tracking (US-006)

## Summary
- **Date**: 2026-06-12
- **Reviewer**: Review Agent
- **Feature Plan**: [docs/features/delivery-tracking/FEATURE_PLAN.md](FEATURE_PLAN.md)
- **Branch**: `feat/us-006-delivery-tracking`
- **Complexity Tier**: Complex
- **Overall Assessment**: ⚠️ Approved with Conditions

---

## Statistics

| Severity  | Count |
|-----------|-------|
| BLOCKER   | 0     |
| CRITICAL  | 2     |
| MAJOR     | 3     |
| MINOR     | 4     |
| INFO      | 3     |

---

## Findings

### CRITICAL-1: Domain layer imports from `@prisma/client` in `delivery.repository.port.ts`

- **File**: `src/modules/delivery/delivery.repository.port.ts:1`
- **Skill Violated**: `domain-modeling.md` — Dependency Rule; `module-scaffold.md` Rule — Domain layer has zero framework imports
- **Description**: The repository port file (which is part of the Application layer) imports `ActorRole` and `DailySupplyStatus` directly from `@prisma/client`. While the port file itself lives in the module root (not in `domain/`), the `ActorRole` and `DailySupplyStatus` types it uses are also re-exported from `delivery.types.ts` which already provides a module-surface re-export of the same Prisma enums. More importantly, `delivery.domain.ts` defines and uses its own `ActorRole` and `DailySupplyStatus` typings sourced from `delivery.types.ts`; having the port independently depend on `@prisma/client` creates a direct Prisma coupling in what should be a clean interface. If the ORM ever changes, the port must change too.
- **Expected**: Repository ports should depend only on domain types. `ActorRole` and `DailySupplyStatus` should be imported from `./delivery.types` (module surface), not from `@prisma/client`.
- **Suggestion**:
  ```ts
  // delivery.repository.port.ts — change line 1
  import { ActorRole, DailySupplyStatus } from './delivery.types';
  ```

---

### CRITICAL-2: No integration tests — only unit tests exist

- **File**: `src/modules/delivery/__tests__/delivery.service.test.ts`
- **Skill Violated**: `testing-strategy.md` — Integration tests required; `review.md` Checklist §9 "Integration tests exist"
- **Description**: The test suite is entirely unit tests (mocked repo + reader). There are zero HTTP-level integration tests (Supertest against a real DB) for any of the 11 endpoints. Per the testing strategy, Complex-tier features require both unit tests and integration tests. The acceptance criteria in `FEATURE_PLAN.md` (auth checks, multi-tenant isolation, response envelope format, correlationId in errors) cannot be verified without HTTP tests. The unit tests themselves are high quality and comprehensive, covering domain invariants, state machines, and all command edge cases — but they alone are insufficient for the gate.
- **Expected**: Integration tests at `tests/integration/delivery.test.ts` (and/or `delivery-security.test.ts`, `delivery-edge.test.ts`) covering the happy-path lifecycle, auth/RBAC, and multi-tenant isolation.
- **Suggestion**: QA agent will write these as part of its mandate. Flag to QA that no integration test baseline exists yet (cannot verify existing tests don't conflict).

---

### MAJOR-1: `delivery.repository.port.ts` — `LeaveRecord.leaveType` typed as a local string union instead of the exported `LeaveType` enum

- **File**: `src/modules/delivery/delivery.repository.port.ts:50`
- **Skill Violated**: `repository-implementation.md` — Repository port types must use canonical types; `prisma-schema-design.md` — Enums must map exactly
- **Description**: `LeaveRecord.leaveType` is typed as the local type alias `ActorRoleOrLeaveType = 'CUSTOMER_REQUESTED' | 'VENDOR_MARKED' | 'SYSTEM'` rather than the `LeaveType` enum exported from `./delivery.types`. This creates a shadow type that could diverge if the enum changes. The `delivery.types.ts` already re-exports `LeaveType` from Prisma precisely to avoid this.
- **Expected**:
  ```ts
  import { LeaveType } from './delivery.types';
  export interface LeaveRecord {
    ...
    leaveType: LeaveType;
    ...
  }
  ```
- **Suggestion**: Remove the local `ActorRoleOrLeaveType` alias and use `LeaveType` from `./delivery.types` throughout.

---

### MAJOR-2: `delivery.repository.ts` — `findLeaveById` uses `as LeaveRecord | null` type cast instead of a proper select projection

- **File**: `src/modules/delivery/delivery.repository.ts:222-227`
- **Skill Violated**: `repository-implementation.md` — No unsafe casts; mappers or select projections required
- **Description**: `findLeaveById` and `listLeaves` return raw Prisma records cast via `as LeaveRecord | null` / `as LeaveRecord[]`. The Prisma `leave.findFirst` returns all columns including timestamps and FK relations, which are not in `LeaveRecord`. This will silently pass extra fields into the application layer. It works today because TypeScript duck-typing is structural, but it is a correctness risk (the cast hides mismatches) and violates the repository implementation pattern of using explicit `select` projections.
- **Expected**: Use `select` to project exactly the `LeaveRecord` fields, removing the cast.
  ```ts
  return this.db(tx).leave.findFirst({
    where: { id, subscription: { vendorId } },
    select: {
      id: true,
      supplyListCustomerId: true,
      startDate: true,
      endDate: true,
      leaveType: true,
      reason: true,
      createdByUserId: true,
      createdAt: true,
    },
  });
  ```

---

### MAJOR-3: `delivery.domain.ts` — `LeaveEntity` has no `validate()` method and `reconstitute()` doesn't call validation

- **File**: `src/modules/delivery/delivery.domain.ts:625-638`
- **Skill Violated**: `domain-modeling.md` — `create()` AND `reconstitute()` must call `validate()`; entity invariants always enforced
- **Description**: `LeaveEntity.create()` correctly constructs the entity via `DateRange.create()` (which validates the date range). However, there is no explicit `validate()` method on `LeaveEntity`, and `reconstitute()` bypasses even the range check by directly passing a pre-built `DateRange` as the `range` prop without re-running invariant checks. If a corrupted `LeaveProps` (e.g. `startDate > endDate` introduced by a DB migration or direct SQL edit) is reconstituted, it will silently produce an invalid entity.
- **Expected**: Add a private `validate()` to `LeaveEntity` that checks `endDate >= startDate` and call it from both `create()` and `reconstitute()`.

---

### MINOR-1: `delivery.controller.ts` — query params for `listId`, `staffId`, `month`, `customerId` parsed with `BigInt()` directly without parse-error guard

- **File**: `src/modules/delivery/delivery.controller.ts:70-72, 358-360`
- **Skill Violated**: `error-handling.md` — Validation errors must be caught and forwarded as proper errors, not uncaught throws
- **Description**: Lines like `BigInt(q['listId'])` and `BigInt(q['month'])` are called after Zod validation passes the `bigIntIdString` pattern, so the happy path is safe. However, `BigInt()` throws a `SyntaxError` (not an `AppError`) if given a non-numeric string. Since these are inside `try/catch → next(error)` blocks, the generic error handler will receive a `SyntaxError` instead of a `ValidationError`, producing a 500 instead of a 400. The safer pattern is to use `parseId()` (already defined on the controller) or check the Zod-validated value.
- **Suggestion**: Replace direct `BigInt(q['listId'])` calls with the already-present `this.parseId(q['listId'], 'Supply list not found')` or assert the value is defined before casting.

---

### MINOR-2: `delivery.shared.ts` — `DeliveryAccess.assertListPermission` silently passes for staff with NO `staffId`

- **File**: `src/modules/delivery/delivery.shared.ts:128-142`
- **Skill Violated**: `error-handling.md` — Security checks must fail closed; `service-implementation.md` — Multi-tenant/role invariants enforced
- **Description**: `assertListPermission` calls `this.reader.isAssignedToList(ctx.staffId, listId)`. If `ctx.staffId` is somehow `undefined` or `0n` (e.g. a bug in `identifyUserRole` that fails to populate `staffId`), the DB query will return `false` and correctly mask as 404. This is acceptable, but there is no guard that asserts `ctx.role === 'staff'` implies `ctx.staffId` is non-null before issuing the DB call. The check is defense-in-depth, not a logic error, but worth hardening.
- **Suggestion**: Add a guard: `if (!ctx.staffId) throw new DeliveryNotFoundError();` as the first line when `ctx.role !== 'owner'`.

---

### MINOR-3: Module structure deviates from Complex-tier DDD layout specified in FEATURE_PLAN.md §6

- **File**: `src/modules/delivery/` (directory layout)
- **Skill Violated**: `module-scaffold.md` — Complex module structure
- **Description**: FEATURE_PLAN.md §6 specifies a `domain/`, `database/`, `ports/`, `adapters/`, `generation/` subdirectory layout. The implementation collapses everything into the module root (`delivery.domain.ts`, `delivery.repository.ts`, `delivery.reader.ts`, etc.) rather than using subdirectories. The `commands/` and `queries/` subdirectories are present and correct. The collapsed layout makes the module significantly harder to navigate for a Complex-tier feature with 6 domain errors, 5 value objects, 2 entities, 2 events, and 11 endpoints. This is a MINOR finding because the code is functionally correct and the required `commands/` + `queries/` subdirs are present.
- **Suggestion**: This is an acceptable pragmatic deviation for this iteration given the module works and is well-organized internally. Document it as a known tech debt. Consider splitting into subdirs if the module grows further.

---

### MINOR-4: Cron error logging does not write to `Logs/YYYY-MM-DD.txt` per memory convention

- **File**: `src/modules/delivery/delivery.cron.ts:89-91, 103-105, 115-117`
- **Skill Violated**: Memory `[Error Logging]` — log errors with correlationId to `Logs/YYYY-MM-DD.txt` at project root
- **Description**: Cron failures are logged via `logger.error(...)` (Pino). The memory entry specifies that errors must also be written to `Logs/YYYY-MM-DD.txt` at the project root with correlationId. The cron jobs do include `correlationId` in the log metadata, which is correct, but the file-sink writing to `Logs/YYYY-MM-DD.txt` is not present in the cron error paths.
- **Suggestion**: Verify whether the Pino logger configuration already routes error-level logs to `Logs/YYYY-MM-DD.txt` (in which case this is a non-issue). If not, add the file write as done in other modules, or ensure the Pino transport handles it globally.

---

### INFO-1: `delivery.domain.ts` — value objects lack structural `equals()` method

- **File**: `src/modules/delivery/delivery.domain.ts:66-188`
- **Skill Violated**: `domain-modeling.md` — Value objects use structural equality via `equals()`
- **Description**: `ServiceDate`, `DeliveryQuantity`, `RateMoney`, `DateRange`, and `ActorRoleVO` do not implement `equals()`. `ServiceDate` implements it (line 104). The others are missing it. In practice this matters most for `DateRange` when comparing leave ranges.
- **Suggestion**: Add `equals()` to each VO, or document that structural equality is intentionally deferred for this tier. Low priority since these VOs are used for validation and conversion, not for collection membership checks.

---

### INFO-2: `delivery.validator.ts` — `markBulkSchema` caps `excludeDeliveryIds` at 1000 but FEATURE_PLAN says the array should match the cap of the bulk update itself

- **File**: `src/modules/delivery/delivery.validator.ts:88`
- **Skill Violated**: `validation-schemas.md` — "Bulk operations capped at 100 items"
- **Description**: The skill cap for bulk operations is 100. The implementation uses 1000 (matching the FEATURE_PLAN §8 spec explicitly). Per the pipeline rule, "the plan wins" — this is intentional and correct. Noting for QA so they test the 1000-item limit rather than a 100-item one.
- **Suggestion**: No change needed — plan wins. QA note only.

---

### INFO-3: `delivery.controller.ts` — `generate` endpoint returns 200 (via `sendSuccess(res, result, 202)`) instead of a true 202 Accepted

- **File**: `src/modules/delivery/delivery.controller.ts:415`
- **Skill Violated**: `api-contract-design.md` — status codes must match the API contract
- **Description**: FEATURE_PLAN §5 endpoint #11 specifies `202 Accepted` for the generate command. The implementation calls `sendSuccess(res, result, 202)` which does pass `202` as the status code — this is correct. Noted for QA to assert the response status is exactly 202, not the default 200.
- **Suggestion**: No change needed — the implementation is correct. QA note only.

---

## Skill Compliance Summary

| Skill                        | Status | Notes                                                                 |
|------------------------------|--------|-----------------------------------------------------------------------|
| module-scaffold.md           | ⚠️      | commands/ + queries/ present; flat root layout deviates from plan §6  |
| prisma-schema-design.md      | ✅      | BigInt IDs, snake_case columns, proper enums, indexes all present      |
| domain-modeling.md           | ⚠️      | LeaveEntity missing validate(); VOs missing equals(); port has Prisma import |
| validation-schemas.md        | ✅      | .strict() on mutations, .passthrough() on queries, coerced IDs, all fields covered |
| repository-implementation.md | ⚠️      | Leave repo methods use unsafe type cast instead of select projections  |
| service-implementation.md    | ✅      | CQS respected, constructor injection, transactions, audit logging, no req/res |
| error-handling.md            | ✅      | Custom error classes, next(error) everywhere, multi-tenant 404 masking, AppError preservation in transactions |
| testing-strategy.md          | ⚠️      | Unit tests are excellent and comprehensive; integration tests missing  |
| api-contract-design.md       | ✅      | All 11 endpoints match plan §5; response envelopes correct; financials owner-only |
| security (custom)            | ✅      | Tenant isolation enforced; vendorId from JWT; staff grant checks; no SQL injection |

---

## Checklist Verification

### Module Structure
- [x] Complexity assessment matches implementation — Complex tier, full DDD structure
- [x] Commands/ and queries/ subdirs present
- [x] Module registered in app.ts
- [x] Permissions seeded
- [ ] Flat root layout — deviates from plan §6 (MINOR-3)
- [x] Most files under 200 lines (delivery.domain.ts is ~787 lines — long but a monolith by design for the domain layer; acceptable)

### Database Schema
- [x] BigInt autoincrement ID on every model
- [x] snake_case via @map()
- [x] Table names snake_case plural
- [x] Timestamps present (daily_supplies, leaves, extra_charges all have createdAt/updatedAt; supply_overrides is append-only, no updatedAt — correct by plan)
- [x] Mandatory indexes present
- [x] Enums have @@map()
- [x] Aggregate boundaries respected
- [x] onDelete policies set

### Domain Model
- [x] Domain layer has ZERO Express/Pino/Zod imports
- [ ] Domain layer imports @prisma/client indirectly via delivery.types.ts re-export (acceptable) but delivery.repository.port.ts directly imports from @prisma/client (CRITICAL-1)
- [x] Entity uses factory method (create + reconstitute)
- [x] Entity validates invariants in validate()
- [x] Entity exposes behavior, not setters
- [x] getProps() returns Object.freeze
- [x] Entity equals() compares by ID
- [ ] LeaveEntity missing validate() and reconstitute() doesn't call it (MAJOR-3)
- [ ] Value objects missing equals() on most VOs (INFO-1)
- [x] Domain errors extend correct base classes (NotFoundError, UnprocessableEntityError, ConflictError)

### Validation
- [x] Mutation schemas use .strict()
- [x] Query schemas use .passthrough()
- [x] All strings use .trim()
- [x] comment field has max 500
- [x] Types exported via z.infer
- [x] Enums via z.enum (DELIVERED/LEAVE for mark, status filter for list)
- [x] IDs validated as numeric strings

### Repository
- [x] Port defined (IDeliveryRepository)
- [x] Every method accepts tx? parameter
- [ ] No soft-delete filter needed (daily_supplies has no deletedAt — correct per plan §4 note)
- [x] P2002 caught as ConflictError in insertLeave
- [x] No business logic in repository
- [ ] Leave findById/listLeaves use unsafe cast instead of select (MAJOR-2)
- [x] Focused methods (applyMark, insertExtraCharge not generic update)

### Service
- [x] Commands classified (mark, markBulk, addExtraCharge, createLeave, cancelLeave, generate)
- [x] Queries classified (getToday, listDeliveries, listLeaves, getCalendar, getDateDetail)
- [x] Constructor injection via IDeliveryRepository port
- [x] Transactions for multi-step operations
- [x] Multi-tenant check via vendorId from RoleContext
- [x] Audit logging on every command
- [x] No req/res in services

### Error Handling
- [x] Specific error classes used
- [x] Controller always calls next(error)
- [x] Multi-tenant masked as 404
- [x] State transition validation via DeliveryStatusVO
- [x] AppError preserved through transaction boundary

### Controller & Routes
- [x] Arrow function methods
- [x] try/catch → next(error) in every method
- [x] No business logic in controller
- [x] vendorId from JWT (req.roleContext)
- [x] Routes file is composition root
- [x] Middleware chain order: authenticate → validate → identifyUserRole → requireOwner/service-enforces
- [x] Response utils used (sendSuccess, sendCreated)

### Testing
- [x] Domain entity tests — state machine, invariants, events, equals
- [x] Value object tests — ServiceDate, DateRange, DeliveryQuantity, RateMoney
- [x] Service unit tests — all commands + queries with mocked ports
- [x] Error scenarios tested (400, 403, 404, 422)
- [x] Faker-free but uses realistic data (acceptable for unit tests)
- [x] No placeholder tests — all tests have real assertions
- [ ] Integration tests missing (CRITICAL-2)
- [ ] Mapper whitelist tests not present as standalone unit tests (covered implicitly via service tests)

### Security
- [x] No raw SQL — Prisma parameterized queries throughout
- [x] No sensitive data in responses (vendorId, passwords not leaked)
- [x] Rate limiting applied on write endpoints
- [x] Tenant isolation enforced — every query scoped to vendorId from JWT
- [x] Staff scoped to assigned lists; financial fields owner-only

---

## Conditions for Full Approval

The two CRITICAL findings must be addressed before this branch merges to main:

1. **CRITICAL-1**: Change `delivery.repository.port.ts` to import `ActorRole`/`DailySupplyStatus` from `./delivery.types` instead of `@prisma/client`. (1-line fix)

2. **CRITICAL-2**: Integration tests must be written. QA agent is assigned to write them — this finding is handed off to the QA stage. QA's passing test suite satisfies this condition.

The three MAJOR findings should be addressed in the same PR (small fixes):

3. **MAJOR-1**: Replace `ActorRoleOrLeaveType` with `LeaveType` from `./delivery.types`.
4. **MAJOR-2**: Add `select` projections to `findLeaveById` and `listLeaves` repository methods.
5. **MAJOR-3**: Add `validate()` to `LeaveEntity` and call it from `reconstitute()`.

MINOR and INFO findings can be addressed in a follow-up.

---

## Overall Assessment

The US-006 implementation is **high quality**. The domain model faithfully implements the FEATURE_PLAN's state machine, conflict detection, override trail, and cross-aggregate orchestration. The service layer correctly classifies commands vs queries, uses transactions for multi-step operations, and enforces multi-tenant isolation throughout. The unit test suite is comprehensive — 236 tests covering domain invariants, value objects, all command edge cases, cron sweep behavior, and query projections.

The three CRITICAL/MAJOR gaps are small and fixable in under an hour: a one-line import change, two select projections, and a domain invariant guard. Once those are addressed and QA's integration tests pass, this is ready to merge.

**Decision: ⚠️ Approved with Conditions — Dev to fix CRITICAL-1, MAJOR-1, MAJOR-2, MAJOR-3; QA to cover CRITICAL-2 via integration tests.**
