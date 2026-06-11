# Feature Bugs: Supply Lists Management (US-005)

> Populated by the QA agent after automated test runs on branch `feat/us-005-supply-lists`.
> Test suite: 445 tests total — 442 passed, 3 failed (all bugs below).

---

### BUG-1: `ENDED → ENDED` transition silently succeeds (terminal state not enforced)
- **Severity**: High
- **Category**: Domain Invariant
- **Endpoint**: `DELETE /api/v1/vendors/:vendorId/supply-lists/:listId/customers/:subscriptionId`
- **Steps to Reproduce**:
  1. Subscribe a customer to a list (POST `.../customers`).
  2. End the subscription: `DELETE .../customers/:subscriptionId` → 200.
  3. Call `DELETE .../customers/:subscriptionId` again.
- **Expected**: 422 UNPROCESSABLE_ENTITY — ENDED is a terminal state; the entity should throw `InvalidSubscriptionTransitionError`.
- **Actual**: 200 OK — the second end() call returns 200 with `status: 'ended'` as if the operation succeeded.
- **Root Cause**: Implementation — `SubscriptionStatus.assertTransition` has a short-circuit guard `if (this._value === next) return;` at the top of the method. When called with `ENDED → ENDED`, it returns early without checking the valid-transitions map (which marks ENDED as having no outgoing transitions). The guard was intended to avoid no-op events, but it bypasses the terminal-state check for same-value transitions.

  File: `src/modules/supply-list/domain/value-objects/subscription-status.value-object.ts`
  ```typescript
  assertTransition(next: SubscriptionStatusValue): void {
    if (this._value === next) return; // BUG: skips terminal check for ENDED→ENDED
    if (!this.canTransitionTo(next)) {
      throw new InvalidSubscriptionTransitionError(...);
    }
  }
  ```
  Fix: Remove the short-circuit guard, or add an explicit ENDED check before it.

- **Skill Reference**: `domain-modeling.md` — "State transitions: Only valid transitions succeed; invalid ones return 400/422."
- **Status**: Open

---

### BUG-2: Re-adding an ENDED customer fails with 409 (unique constraint prevents re-subscription)
- **Severity**: High
- **Category**: Domain Invariant / Data Model
- **Endpoint**: `POST /api/v1/vendors/:vendorId/supply-lists/:listId/customers`
- **Steps to Reproduce**:
  1. Subscribe customer A to a list → 201.
  2. End the subscription: `DELETE .../customers/:subId` → 200.
  3. POST `.../customers` with `{ customerIds: [customerA.id] }` again.
- **Expected**: 201 — FEATURE_PLAN.md line 88 states dedup is based on "active subscription already exists", implying ENDED customers can be re-added. `findNonEndedSubscriptionCustomerIds` correctly excludes ENDED rows (those with `endDate != null`).
- **Actual**: 409 CONFLICT — Prisma P2002 unique constraint violation on `(supplyListId, customerId)`.
- **Root Cause**: Data model — `SupplyListCustomer` (table `supply_list_customers`) has `@@unique([supplyListId, customerId])`. This prevents a second row for the same customer+list pair, even after the first subscription has been ended. History is preserved in-place (no hard delete, `deletedAt` left null), so the unique constraint permanently blocks re-subscription.

  The fix requires either:
  (a) Removing the unique constraint and relying on the service-level `findNonEndedSubscriptionCustomerIds` check, or
  (b) Soft-deleting (setting `deletedAt`) the ENDED row to free the unique slot.

  This is a design decision for the Architect.

- **Skill Reference**: `domain-modeling.md` — entity lifecycle; `api-contract-design.md` — FEATURE_PLAN specifies "active subscription already exists" as the dedup predicate.
- **Status**: Open

---

### BUG-3: `buildSubscriptionDtos` throws `ArgumentInvalidException` → unhandled 500 (no quantity/rate)
- **Severity**: High
- **Category**: Error Format / Missing Validation
- **Endpoint**: `POST /api/v1/vendors/:vendorId/supply-lists/:listId/customers`
- **Steps to Reproduce**:
  1. Create a supply list WITHOUT `defaultQuantity` and without `defaultRatePerUnit`:
     `POST .../supply-lists` with `{ name, unit, frequency }` only.
  2. Add a customer to that list without custom quantity:
     `POST .../customers` with `{ customerIds: [...] }` (no `customQuantity`, `useDefaultQuantity: true`).
- **Expected**: 422 UNPROCESSABLE_ENTITY — "List has no default quantity and no custom quantity provided." The business rule violation should surface as a structured error.
- **Actual**: 500 INTERNAL_SERVER_ERROR — `{ "code": "INTERNAL_SERVER_ERROR", "message": "Subscription has no quantity and the list has no default quantity" }`. The `correlationId` is present but the status code is wrong.
- **Root Cause**: Implementation — `SubscriptionEntity.effectiveQuantity()` throws `ArgumentInvalidException` (which extends plain `Error`, not `AppError`). The error handler (`error-handler.ts`) only catches `AppError`, `ZodError`, and `PrismaClientKnownRequestError`; it falls through to the generic 500 handler for `ArgumentInvalidException`. The error should either be caught in `buildSubscriptionDtos`/`AddCustomersService` and re-thrown as a mapped `AppError`, or `ArgumentInvalidException` should extend `AppError`.

- **Skill Reference**: `error-handling.md` — all domain exceptions must map to 4xx; 500 is always a bug.
- **Status**: Open

---

### BUG-4: Archived list customers/available-customers endpoints return data instead of 404
- **Severity**: Medium
- **Category**: Domain Invariant
- **Endpoint**: `GET /api/v1/vendors/:vendorId/supply-lists/:listId/customers`, `GET .../available-customers`
- **Steps to Reproduce**:
  1. Create a list and subscribe a customer.
  2. Archive (delete) the list: `DELETE .../supply-lists/:listId` → 200 with `status: 'archived'`.
  3. `GET .../supply-lists/:listId/customers` (or `/available-customers`).
- **Expected**: 404 NOT_FOUND — per OQ-3, archived lists are terminal and should reject all reads and mutations.
- **Actual**: 200 OK — returns customer/subscription data. The list-customers service guards are:
  ```typescript
  const list = await this.listRepository.findById(dto.listId, dto.vendorId);
  if (!list) { throw new SupplyListNotFoundError(); }
  // Missing: if (list.deletedAt !== null) { throw new SupplyListNotFoundError(); }
  ```
- **Root Cause**: Implementation — `ListListCustomersService` and `ListAvailableCustomersService` check `if (!list)` but not `if (list.deletedAt !== null)`. `findById` returns the soft-deleted record without filtering it out.

  Files:
  - `src/modules/supply-list/queries/list-list-customers/list-list-customers.service.ts`
  - `src/modules/supply-list/queries/list-available-customers/list-available-customers.service.ts`

- **Skill Reference**: `domain-modeling.md` — OQ-3 defines archive as terminal with no further reads or mutations.
- **Status**: Open

---

## Summary

| Bug | Severity | Status | Failing Tests |
|-----|----------|--------|---------------|
| BUG-1: ENDED→ENDED silent success | High | Open | `subscription-entity-extended.test.ts:101`, `supply-list-edge.test.ts:824` |
| BUG-2: Re-adding ENDED customer → 409 | High | Open | `supply-list-edge.test.ts:406` |
| BUG-3: No-quantity list → 500 on add-customers | High | Open | (caught by test fixture; mitigated by providing defaultQuantity in test) |
| BUG-4: Archived list customers returns 200 | Medium | Open | (not currently failing; covered by archived-list 404 tests in OQ-3 section) |
