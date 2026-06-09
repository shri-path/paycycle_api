# Code Review Report: US-004 — Staff Management

- **Date:** 2026-06-09
- **Reviewer:** Review agent
- **Commit reviewed:** `60bffb1` (branch `feat/us-004-staff-management`)
- **Verdict:** **Approved with Conditions** — 0 Blocker / 0 Critical / 0 Major / 7 Minor / 2 Info.
- **Resolution:** all "required before QA" findings fixed in the follow-up commit (see below). Deferrable findings tracked.

---

## Findings & Resolutions

| ID | Severity | Summary | Status |
|----|----------|---------|--------|
| MINOR-1 | Minor | Missing entry-point `logger.info` in the 4 new command services (resend/update-permissions/assign-list/unassign-list); resend had a trailing success-`info` (anti-pattern). | **Fixed** — entry `info` added; trailing success logs removed. |
| MINOR-2 | Minor | Missing `logger.warn` before business-rule throws (404/422/403) in the new services. | **Fixed** — `warn` added before every guard throw (internal reason logged; caller still gets masked 404). |
| MINOR-3 | Minor | `ListAssignmentWriteStubAdapter.logUnavailable` used `info` for a feature-gated event. | **Fixed** — changed to `warn`. |
| MINOR-4 | Minor | **Plan deviation:** `UpdatePermissionsService` threw `ForbiddenError` on an owner target; plan N2 + DOMAIN_MODEL invariant 4 specify a no-op all-allow **200**. | **Fixed** — owner target now returns the full all-allow 3-key state (no write), no 403. |
| MINOR-5 | Minor | `StaffNotificationLogAdapter.sendStaffInvite` non-`async` (cosmetic). | **Declined (rule conflict)** — the project's `@typescript-eslint/require-await` rule errors on an async method with no `await`. The synchronous-bodied port impl returning `Promise.resolve()` is the lint-correct, project-consistent pattern. Comment added explaining why. |
| MINOR-6 | Minor | `staff.controller.ts` at 374 lines exceeds the 200-line guideline. | **Deferred** — tracked as tech-debt; structural split (command/query controller) out of scope for this slice to avoid pre-QA churn. |
| MINOR-7 | Minor | `UpdateStaffService` returns `assignedListCount: 0` / `[]` after a successful update (pre-existing US-002 behavior, surfaced by the `name` edit). | **Deferred** — pre-existing; real enrichment lands with the US-005 list adapter. |
| INFO-1 | Info | `prisma.vendor.findUnique` called directly in resend/invite services (bypasses repo). | Acknowledged — mirrors existing US-002 `InviteStaffService`; future `VendorRepository.findName` cleanup. |
| INFO-2 | Info | `sentCount` derived from latest invitation regardless of status. | Acknowledged — acceptable per plan (delivery metadata); not a correctness bug. |

---

## Plan / Security Compliance (verified by reviewer)

- **Reconciliation correct:** reuses unified `vendor_users` / `vendor_staff_permissions` / token-hash `staff_invitations`; zero new tables; only the 3 additive invitation columns.
- **Resend:** INVITED-only guard (422 otherwise); token rotation (prior PENDING → REVOKED, one fresh PENDING); `sentCount` increments; `inviteLimiter` applied; CSPRNG confirmed.
- **Gated assign/unassign:** 503 reachable **only after** auth → owner → tenant(404-mask) guards. Integration tests prove a staff caller gets 403 and a wrong-tenant owner gets 404 — never 503.
- **Multi-tenant masking** (wrong vendor/staff → 404), `correlationId` on every error path, `.strict()` Zod on mutations, phone masked in notification logs, `vendorId` never from body.
- **Enhancements:** `limits{}` math correct (null = unlimited → `canAddMore` true); `name` updates linked `User.name` in-transaction; invite persists `sent_via` + sends via port; notification stub log-and-continue (never throws).

---

## Post-fix verification

- `tsc` build: **exit 0**
- `npm run lint` (src): **0 errors** (22 pre-existing warnings)
- Jest: **174/174 pass** (157 US-002 regression + 17 US-004)

**Outcome:** ready for QA.
