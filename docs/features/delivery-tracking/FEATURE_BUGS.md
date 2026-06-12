# Feature Bugs — US-006 Daily Delivery Tracking

Produced by QA on 2026-06-12 after unit-test pass on branch `feat/us-006-delivery-tracking`.

---

### BUG-1: CANCELLED delivery can be re-cancelled without throwing (terminal state violated)
- **Severity**: High
- **Category**: Domain Invariant
- **Endpoint**: `PATCH /vendors/:vendorId/deliveries/:deliveryId/mark` (also affects any code path that calls `entity.cancel()` twice)
- **Steps to Reproduce**:
  1. Create a `DailySupplyEntity`.
  2. Call `entity.cancel('VENDOR_OWNER', userId)` — status becomes `CANCELLED`.
  3. Call `entity.consumePendingOverride()` to drain the override.
  4. Call `entity.cancel('VENDOR_OWNER', userId)` again.
- **Request**: n/a (domain-layer invariant)
- **Expected**: `InvalidDeliveryTransitionError` — per `FEATURE_PLAN.md §3`: "terminal `CANCELLED` cannot be re-marked"; `TRANSITIONS['CANCELLED'] = []` in the state machine.
- **Actual**: No error is thrown. `DeliveryStatusVO.assertTransition` has an early-return guard `if (from === to) return;` at line 246 of `delivery.domain.ts`, which silently allows a CANCELLED→CANCELLED re-cancellation. A second `_pendingOverride` is written even though the row is terminal.
- **Skill Reference**: `domain-modeling.md` — entity state machines must reject all transitions from terminal states, including self-transitions.
- **Root Cause**: Implementation — the `assertTransition` "same-to-same is a no-op" shortcut should be restricted to non-terminal states, or the guard should check the target is in the allowed-transitions list first.
- **Status**: Open

---

### BUG-2: `CancelLeaveCommand` checks `endDate < today` AFTER loading supply rows (incorrect ordering)
- **Severity**: Medium
- **Category**: Domain Invariant / Edge Case
- **Endpoint**: `DELETE /vendors/:vendorId/leaves/:leaveId`
- **Steps to Reproduce**:
  1. Create a leave whose `endDate` is in the past (e.g., 2020-01-05).
  2. Call `DELETE /vendors/:vendorId/leaves/:leaveId`.
- **Request**: `DELETE /vendors/1/leaves/77`
- **Expected**: `404 NOT_FOUND` ("Only future leaves can be cancelled") — and the check should be performed before executing `findBySubscriptionInRange` to avoid unnecessary DB reads.
- **Actual**: The `endDate < today` guard is at line 48 of `cancel-leave.command.ts`, AFTER `findBySubscriptionInRange` is called at line 41. The command correctly throws `LeaveNotFoundError`, but only after an unnecessary DB query is executed. Additionally, the guard sits inside the `execute` method rather than before the supply-range fetch, causing extra I/O on every past-leave cancel attempt.
- **Skill Reference**: `service-implementation.md` — guard clauses should precede all work they would prevent.
- **Root Cause**: Implementation — the temporal validity check should be moved to immediately after loading the leave record (before line 41).
- **Status**: Open

---

### BUG-3: `sweepMorning` passes `{ minQuantity: 0 }` but the port contract documents this as "quantity strictly greater than"
- **Severity**: Medium
- **Category**: Domain Invariant / Edge Case
- **Endpoint**: AutoMarkSweepCommand cron
- **Steps to Reproduce**:
  1. Have a PENDING daily supply with `quantity = 0.000`.
  2. The `sweepMorning` cron fires.
- **Expected per FEATURE_PLAN.md §7**: "morning sweep targets today's PENDING rows with quantity > 0" — zero-quantity rows should be EXCLUDED from the morning sweep (only the overnight sweep should include them).
- **Actual**: `sweepMorning` passes `{ minQuantity: 0 }` to `findPendingIdsForDate`. The port docstring at line 94 of `delivery.repository.port.ts` states "only rows with quantity **strictly greater** are returned" when `minQuantity` is set. So passing `0` should mean qty > 0 (exclude zero-qty rows). This appears correct, BUT the test confirms only that `{ minQuantity: 0 }` is passed — the actual DB filtering logic in `delivery.repository.ts` (Prisma adapter) needs to implement `quantity > minQuantity` (not `>=`). This is a naming ambiguity that could lead to an implementation error.
- **Skill Reference**: `repository-implementation.md` — port contracts must be unambiguous; the boundary between "0 as threshold" and "0 as include-zero" must be explicit.
- **Root Cause**: Design ambiguity — `minQuantity: 0` could mean "include all quantities ≥ 0" (i.e., include zero) in a typical ORM filter, contradicting the "quantity > 0" intent. The repository adapter must implement `gt: minQuantity` not `gte: minQuantity`.
- **Status**: Open

---

### BUG-4: `MarkBulkDeliveryCommand.excluded` returns caller-provided ID count, not actual skipped count
- **Severity**: Low
- **Category**: API Contract
- **Endpoint**: `POST /vendors/:vendorId/deliveries/mark-bulk`
- **Steps to Reproduce**:
  1. Call bulk-mark with `excludeDeliveryIds: ['999', '1000']` (IDs that don't even exist).
  2. 0 records are actually excluded because `findMarkableIds` already filters them out.
- **Request**: `{ "supplyListId": "20", "date": "2026-04-12", "status": "DELIVERED", "excludeDeliveryIds": ["999", "1000"] }`
- **Expected per FEATURE_PLAN.md §5, Endpoint 4**: `data: { updated: N, skipped: M }` — "skipped" implies rows that existed but were intentionally excluded, not an echo of the input array length.
- **Actual**: `MarkBulkDeliveryCommand` returns `excluded: input.excludeDeliveryIds.length` (line 78 of `mark-bulk-delivery.command.ts`), which is the raw count of caller-supplied IDs regardless of whether those IDs actually existed. If the caller passes IDs for another vendor or non-existent IDs, the count is inflated.
- **Skill Reference**: `api-contract-design.md` — response counts should reflect actual DB operations, not echo request parameters.
- **Root Cause**: Implementation — `excluded` should count how many rows in `findMarkableIds` were filtered because they appeared in `excludeDeliveryIds`, not the raw length of the input array.
- **Status**: Open

---

### BUG-5: `GetCalendarQuery` does not enforce owner-only access (non-owner can call it)
- **Severity**: High
- **Category**: Auth / RBAC
- **Endpoint**: `GET /vendors/:vendorId/deliveries/calendar`
- **Steps to Reproduce**:
  1. Authenticate as a staff user (not owner).
  2. Call `GET /vendors/1/deliveries/calendar?month=2026-04`.
- **Expected per FEATURE_PLAN.md §5, Endpoint 9**: "Query | owner only" — staff should receive `403 FORBIDDEN`.
- **Actual**: `GetCalendarQuery.execute` has no role check. The route may enforce `requireOwnerRole` middleware (not tested here at the unit level), but the query service itself applies no guard. If the middleware is ever bypassed or the query is called from another context, the financial calendar is exposed to staff.
- **Skill Reference**: `service-implementation.md` — owner-only commands/queries should validate role at the service layer as a defence-in-depth measure (not rely solely on route middleware).
- **Root Cause**: Missing defence-in-depth check in the query service. The route-level middleware is the only gate.
- **Status**: Open (needs integration-level verification to confirm route middleware is correctly applied)

