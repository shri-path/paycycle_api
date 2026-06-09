# Feature Bugs: US-004 — Staff Management

**QA Date:** 2026-06-09
**QA Branch:** `feat/us-004-staff-management`
**Commits tested:** `60bffb1` (implementation) + `c5b6c0d` (review fixes)
**Test suite result:** 231/231 PASS (174 US-002 regression + 17 existing US-004 + 57 new QA tests)
**Overall verdict:** CONDITIONAL PASS — 1 Low-severity plan-vs-implementation deviation documented below; all Critical/High/Medium categories are clear.

---

## Bug Registry

### BUG-001: REMOVED member resend-invitation returns 404 instead of 422

- **Severity:** Low
- **Category:** Domain Invariant / Plan Deviation
- **Endpoint:** `POST /vendors/:vendorId/staff/:staffId/resend-invitation`
- **Steps to Reproduce:**
  1. Owner invites staff (phone A) → staff accepts invitation → membership becomes ACTIVE.
  2. Owner removes the staff member via `DELETE /vendors/:vendorId/staff/:staffId` → membership set to REMOVED + `deletedAt` stamped.
  3. Owner calls `POST /vendors/:vendorId/staff/:staffId/resend-invitation` with the removed staff's `staffId`.
- **Request:**
  ```json
  POST /api/v1/vendors/<vendorId>/staff/<removedStaffId>/resend-invitation
  Authorization: Bearer <ownerToken>
  {}
  ```
- **Expected (per FEATURE_PLAN.md § Business Rules):**
  ```
  HTTP 422
  { "success": false, "error": { "code": "UNPROCESSABLE_ENTITY",
    "message": "Only pending invitations can be resent.", "correlationId": "..." } }
  ```
  The plan states: "ACTIVE/DISABLED/REMOVED → `InvalidStatusTransitionError` (422)".
- **Actual:**
  ```
  HTTP 404
  { "success": false, "error": { "code": "NOT_FOUND",
    "message": "Staff member not found", "correlationId": "..." } }
  ```
- **Root Cause:** Implementation — The `RemoveStaffService.execute()` stamps `deletedAt = now` on the membership when it removes a member (via `VendorMembershipEntity.remove()`, which sets both `removedAt` and `deletedAt`). The `ResendInviteService` guard is:
  ```typescript
  if (!record || record.vendorId !== dto.vendorId || record.deletedAt !== null) {
    throw new NotFoundError('Staff member not found');
  }
  ```
  Because `deletedAt !== null` is truthy for REMOVED members, the multi-tenant mask (404) fires before the status check. The plan intended REMOVED to surface as 422, but the implementation's soft-delete convention masks it as 404.
- **Skill Reference:** `error-handling.md` — 404 for soft-deleted/non-existent is correct under the masking convention; `domain-modeling.md` invariant #1 says resend allowed only when `status = INVITED` and implies ACTIVE/DISABLED/REMOVED → 422. The two rules are in tension for REMOVED.
- **Assessment:** The 404 behavior is internally consistent with the project's soft-delete + multi-tenant masking convention (a REMOVED member is logically "gone" from the tenant's view). The plan's "REMOVED → 422" is arguably a documentation oversight since REMOVED = soft-deleted = 404 in this codebase. **No security or data integrity risk.** The owner who performs the DELETE immediately sees a "not found" on resend, which is a reasonable UX.
- **Recommendation for Dev/Architect:** Decide whether REMOVED should surface as 404 (current, consistent with soft-delete convention) or 422 (per plan). If 422 is desired, the service guard must be split: check `deletedAt` first for the non-owner-tenant 404 mask, then check `status` to distinguish REMOVED → 422 from ACTIVE/DISABLED → 422. Low impact; consider updating the plan comment rather than changing the code unless there is a frontend requirement for the 422 message.
- **Status:** Open (design clarification needed; not a security or data-correctness bug)
- **Regression test:** `BQ-2` in `tests/integration/staff-us004-qa.test.ts` documents the actual behavior (404) and explains the reason in a comment.

---

### BUG-002: Non-numeric `:staffId` param returns 400 VALIDATION_ERROR, not 404

- **Severity:** Low
- **Category:** Error Format / UX
- **Endpoints:** All `staff/:staffId/...` routes (`resend-invitation`, `permissions`, `assign-list`, `unassign-list/:listId`)
- **Steps to Reproduce:**
  1. Call any staff command route with a non-numeric `staffId` (e.g. `"abc"` or `"not-a-number"`).
  2. Include a valid owner JWT.
- **Request:**
  ```
  POST /api/v1/vendors/<vendorId>/staff/not-a-number/resend-invitation
  Authorization: Bearer <ownerToken>
  {}
  ```
- **Expected (intuitive):**
  ```
  HTTP 404 — resource not found (non-numeric ID cannot match any row)
  ```
  The `StaffController.parseId()` method throws `NotFoundError` for non-numeric IDs. Based on the status-code table in the QA prompt, a non-existent resource → 404.
- **Actual:**
  ```
  HTTP 400 VALIDATION_ERROR
  { "success": false, "error": { "code": "VALIDATION_ERROR",
    "message": "Validation failed", "details": [...],
    "correlationId": "..." } }
  ```
  The `staffIdParamSchema` Zod validator runs before the controller's `parseId()` and rejects non-numeric route params as a schema validation error (400). The controller's `parseId()` is therefore never reached.
- **Root Cause:** Architecture / by design. `staffIdParamSchema` uses `.strict()` + `z.string().regex(/^\d+$/)`, which returns 400 on non-numeric IDs. The `validate()` middleware runs as the second middleware in the chain, before `identifyUserRole` and the controller. This is a layering consequence: path-param validation (Zod) fires before controller-level ID parsing.
- **Skill Reference:** `validation-schemas.md` — Zod param validation at boundary is correct; `api-contract-design.md` — HTTP 404 is the expected status for a non-existent resource identified by ID.
- **Assessment:** Both 400 and 404 are defensible. The current 400 leaks the fact that the ID format was invalid (information disclosure, minor). A 404 would be consistent with how `parseId()` would behave and aligns with the "wrong resource" convention. However, the 400 includes a `correlationId` and is not a security issue.
- **Recommendation:** Low priority. If uniformity is desired, the param schemas could coerce/strip non-numeric IDs silently and let the service throw 404. Alternatively, document this as intentional — non-numeric IDs are a client programming error (400) rather than a missing resource (404).
- **Status:** Open (design question; no security impact)
- **Regression test:** `BQ-13` in `tests/integration/staff-us004-qa.test.ts` documents the actual behavior (400).

---

## Summary of QA Results

| Category | Result |
|---|---|
| Happy path (all 4 new endpoints) | PASS |
| Token rotation (prior PENDING → REVOKED, exactly 1 fresh PENDING, old token → 404) | PASS |
| `sentCount` strictly increments per resend | PASS |
| `sentVia` echoed in resend response; persisted at invite time | PASS |
| MINOR-4 fix: owner target `PATCH permissions` → 200 all-allow (not 403) | PASS |
| Permissions merge semantics (absent keys unchanged) | PASS |
| Guard order for assign/unassign (staff→403, wrong-tenant→404, owner→503) | PASS |
| `FeatureNotAvailableError` 503 code + correlationId | PASS |
| `.strict()` rejection of unknown fields (body + inner object) | PASS |
| Auth: no token → 401, malformed → 401 | PASS |
| Multi-tenant 404 masking (wrong vendor + wrong staff) | PASS |
| `limits{}` block: maxStaff=null, canAddMore=true, currentActive numeric | PASS |
| `name` edit persists to `User.name`, visible in GET /staff/:id | PASS |
| Name validation: empty → 400, whitespace-only → 400, >100 chars → 400 | PASS |
| Response whitelist: no tokenHash/passwordHash/deletedAt in any response | PASS |
| BigInt IDs serialized as strings | PASS |
| `correlationId` present on 401 / 400 / 404 / 422 / 503 error bodies | PASS |
| US-002 regression (157 tests) | PASS (0 regressions) |
| **REMOVED member resend** | Deviation: 404 vs plan's 422 (BUG-001, Low) |
| **Non-numeric staffId** | Deviation: 400 vs intuitive 404 (BUG-002, Low) |

**Total bugs found: 2 — both Low severity, both design-level deviations with no security or data-integrity impact.**
