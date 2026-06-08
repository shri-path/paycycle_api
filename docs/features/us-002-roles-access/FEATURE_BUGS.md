# Feature Bugs: US-002 — Roles & Access Control

> Populated by the QA agent after Review. Architect provides this skeleton + the
> high-risk areas QA should probe first. Use the template per bug.

## Bug Template
```
### BUG-[number]: [Short title]
- **Severity**: Critical / High / Medium / Low
- **Endpoint**: `METHOD /path`
- **Steps to Reproduce**: ...
- **Expected**: ...
- **Actual**: ...
- **Root Cause**: Architecture / Implementation / Missing validation
- **Status**: Open / Fixed / Verified / Won't Fix
```

---

## High-risk areas for QA to probe (architect guidance)

1. **Multi-tenant isolation** — vendor A's owner requests vendor B's `:staffId`. MUST return **404** (mask), never 403 or 200. Test across list/get/update/delete.
2. **vendorId trust** — confirm `:vendorId` is validated against JWT `vendorIds[]`; a body- or query-supplied vendorId must never override the route.
3. **Permission fail-closed (OQ-1)** — a staff member with `mark_deliveries` grant must still be **denied** list-scoped actions while the `ListAssignmentPort` stub is in place (returns false). Verify owners are unaffected.
4. **Invite token security** — token is CSPRNG (`crypto.randomBytes`, not `Math.random` — memory rule); only the **hash** is persisted; raw token appears once in the link; expired (>7d) → 422; used/unknown → 404; single-use enforced.
5. **State machine** — invalid transitions (e.g. REMOVED→ACTIVE, double-accept) → 422; owner-self disable/remove → 403 ("Cannot remove yourself as owner").
6. **Disabled/removed mid-session** — disabled staff blocked on next request (status re-check in `identifyUserRole`) AND sessions revoked via event handler. Removed staff likewise.
7. **Re-invite (OQ-8)** — inviting an existing ACTIVE staff phone → 409; inviting a previously REMOVED member reactivates (per decision).
8. **Strict Zod completeness** — every field the controller reads from `req.body` is declared in the `.strict()` schema (memory rule — `deviceId`-style omission caused a prior bug).
9. **correlationId on all error paths** — including 404/notFound (memory rule).
10. **Mapper leakage** — `StaffResponseDto`/role response never expose `tokenHash`, `passwordHash`, or raw permission internals; BigInt serialized as string.
11. **Seed idempotency** — `db:seed` runs twice cleanly (upsert/existence checks — memory rule).
12. **getProps() immutability** — entity `getProps()` returns a frozen object (memory rule).
13. **451 subscription path** — with a mocked limit port, invite beyond limit → 451 `SUBSCRIPTION_LIMIT`; stub default (unlimited) lets invites pass.
14. **JWT payload change (OQ-2, if approved)** — refresh-token rotation issues a token with real role+permissions, not empty defaults (memory rule).
15. **Audit completeness** — every staff mutation writes exactly one `audit_logs` row with `performedByUserId`, `action`, `entityType='staff'`, `entityId`, `vendorId`; no double-logging; audit failure does not fail the request.

## Open items carried from FEATURE_PLAN (resolve before/with QA)
- OQ-1 list-port semantics, OQ-2 JWT shape, OQ-3 delete response, OQ-4 accept-invite placement, OQ-5 owner column, OQ-6 owner-self guard, OQ-7 subscription stub, OQ-8 re-invite, OQ-9 today-stats placeholder.

---

## Bugs
_None yet — to be filled by QA._
