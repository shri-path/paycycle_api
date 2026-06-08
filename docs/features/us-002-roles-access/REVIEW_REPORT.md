# Code Review Report: Roles & Access Control (US-002)

## Summary
- **Date**: 2026-06-08
- **Reviewer**: Review Agent
- **Branch**: `feat/us-002-roles-access`
- **Commits reviewed**: `f063d85`, `59d5e6d`, `3e41136`, `65e6d34`, `27ad065`
- **Feature Plan**: `docs/features/us-002-roles-access/FEATURE_PLAN.md`
- **Complexity Tier**: Complex
- **Overall Assessment**: ✅ **Approved with Conditions** (proceed to QA; one MAJOR atomicity fix strongly recommended before merge)

Build (`tsc`) passes clean. Lint passes (0 errors, 22 pre-existing `explicit-function-return-type` warnings, none introduced by this US). All 50 staff + RBAC unit tests pass. Integration tests (`tests/integration/staff.test.ts`) require a live DB and are deferred to QA per the US-003 pattern.

---

## Statistics

| Severity | Count |
|----------|-------|
| BLOCKER  | 0     |
| CRITICAL | 0     |
| MAJOR    | 1     |
| MINOR    | 3     |
| INFO     | 2     |

---

## Dev-flagged deviations — verdicts

### 1. `/auth/accept-invite` error forwarding — VERIFIED CORRECT
`src/modules/auth/auth.routes.ts:213-227` wraps the handler body in `try/catch` and calls `next(error)`. The shared `asyncHandler` only does `void fn(...)` and does **not** forward rejections, so the explicit try/catch is required and is correct here. I checked the only other new public handler path: the staff router's `asyncHandler` (`staff.routes.ts:111-115`) is identical, but every staff controller method (`staff.controller.ts`) has its own internal `try/catch → next(error)`, so no rejection escapes unhandled. **No latent hang exists in any new handler.**

### 2. Role-slug reconciliation (`vendor_owner`/`vendor_staff` kept, mapped to `owner`/`staff`) — SOUND, NOT AN ESCALATION
DB slugs remain `vendor_owner`/`vendor_staff` (US-003 back-compat); the `'owner'|'staff'` labels exist only at the API boundary. The mapping is centralized and consistent: `vendor-membership.types.ts:55-60` (`OWNER_ROLE_NAME`, `isOwnerRole`), `staff.mapper.ts:15-17` (`roleLabel`), `role-context.ts:11/24` (`toLabel`). The JWT claim and all server-side gates (`authorize.ts`, `identifyUserRole`, `InviteStaffService` role lookup) compare against the raw slug; only DTOs expose the short label. This is a clean back-compat decision and matches OQ-5 (owner = role membership, no column). No Architect escalation needed.

### 3. OQ-2 JWT `vendors[]` claim + status re-check — VERIFIED CORRECT & BACK-COMPAT SAFE
- Back-compat: `JwtAccessPayload` keeps `vendorIds: string[]` and adds optional `vendors?: JwtVendorClaim[]` (`jwt.util.ts:15-21`). `auth.middleware.ts:18-27` populates `vendorIds` always and `vendors` only when present. Existing `vendorIds` consumers are unaffected.
- `LoginService` (`login.service.ts:51-64`) and `RefreshTokenService` (`refresh-token.service.ts:44-60`) both reload fresh claims via `findVendorClaimsByUserId` at issue time — satisfies the "reload user context on refresh" memory rule (phone + vendor + role + permissions are all reloaded, never empty defaults).
- `identifyUserRole` (`role-context.ts:59-91`) does an **authoritative DB lookup** and rejects unless `status === ACTIVE` (line 67); it reads permissions from the DB too, not the token. A disabled/removed staff member is blocked on their very next request regardless of token contents. This **exceeds** the OQ-2 requirement (it is always-fresh, not staleness-bounded). Confirmed no fail-open path.

### 4. `ListAssignmentPort` stub is fail-closed — VERIFIED
`list-assignment-stub.adapter.ts`: `isAssignedToList`/`isCustomerInAssignedList` return `false`, counts `0`, ids `[]`, `unassignAll` no-ops with a log. `PermissionService` (`permission.service.ts`) short-circuits owners to `true` before ever touching the port, and requires BOTH grant AND assignment for staff — so staff are denied list-scoped actions until US-005, owners unaffected. Unit test `permission.service.test.ts:62-66` asserts the fail-closed behaviour. No fail-open path.

---

## Findings

### MAJOR-1: Re-invite membership update runs outside the transaction (atomicity break)
- **File**: `src/modules/staff/commands/invite-staff/invite-staff.service.ts:102-110`
- **Skill Violated**: `repository-implementation.md` (every method accepts `tx?`); `service-implementation.md` (transactions for multi-step operations)
- **Description**: Inside the `prisma.$transaction` block, the OQ-8 reactivation path calls `this.membershipRepository.update(existing.id, {...})` **without passing `tx`**. Because `VendorMembershipRepository.update` resolves its client as `tx ?? prisma`, this write executes on the global `prisma` client — i.e. **outside** the surrounding transaction. The sibling calls in the same branch (`replacePermissions`, line 111-115) and the new-member branch (`insertWithPermissions`, line 129; invitation `insert`, line 149; `revokePendingByMembership`, line 138) all correctly pass `tx`. If the subsequent invitation insert throws, the membership has already been flipped `REMOVED → INVITED` and will **not** be rolled back, leaving a half-reactivated member with no valid invite token.
- **Expected**: Pass `tx` as the third argument, consistent with every other write in the transaction:
  ```ts
  await this.membershipRepository.update(existing.id, { /* ... */ }, tx);
  ```
- **Severity rationale**: Not a security/tenant-isolation issue (so not BLOCKER), and the happy path is covered by the passing OQ-8 unit test (which mocks the tx as `{}`, so it cannot catch this). But it violates the atomicity guarantee the rest of the method relies on and can leave inconsistent state on partial failure. Should fix before merge.

### MINOR-1: `settableStatusField` accepts INVITED/REMOVED, but the service silently ignores them
- **File**: `src/modules/staff/staff.validator.ts:38-40` and `src/modules/staff/commands/update-staff/update-staff.service.ts:52-60`
- **Skill Violated**: `validation-schemas.md` (validate at the boundary; error message must match accepted values)
- **Description**: `settableStatusField = z.nativeEnum(VendorUserStatus)` accepts all four enum values, while its `errorMap` message claims "status must be one of: ACTIVE, DISABLED". A PATCH with `status: "INVITED"` or `"REMOVED"` passes validation, then in the service neither the `DISABLED` nor `ACTIVE` branch matches, so the status change is silently dropped (the membership is re-`update`d with its unchanged status). The owner receives a 200 with no transition and no error.
- **Expected**: Constrain the schema to the settable subset so out-of-range values are rejected at the boundary (400), e.g. `z.enum([VendorUserStatus.ACTIVE, VendorUserStatus.DISABLED])` or a `.refine`. Then the error message is truthful and removal stays exclusively on the DELETE endpoint.

### MINOR-2: Accept-invite session creation + audit occur after the transaction commits
- **File**: `src/modules/staff/commands/accept-invite/accept-invite.service.ts:137-158`
- **Skill Violated**: `service-implementation.md` (transactions for multi-step operations)
- **Description**: The user-password update, membership activation, and invitation acceptance are committed in the `$transaction` (lines 79-104). The `UserSession` row is then created **after** the commit (line 137). If session creation fails, the invite is already consumed (single-use) and the membership is ACTIVE, but the caller gets a 500 and cannot retry the now-used token — the user must go through password reset / re-invite. Audit (log-and-swallow) being post-tx is fine; the session is the concern.
- **Expected**: Either create the session inside the same transaction, or accept this as a known edge (the user is functionally onboarded and can log in normally with the password they just set, so the practical impact is low). Flagging for QA to confirm the login-after-failed-accept path. Low real-world impact, hence MINOR.

### MINOR-3: `findByVendorAndPhone` may match the wrong membership when a phone has multiple rows
- **File**: `src/modules/staff/database/vendor-membership.repository.ts:41-54`
- **Skill Violated**: none directly — defensive correctness note
- **Description**: The re-invite duplicate check matches on `OR: [{ phone }, { user: { phone } }]` ordered by `createdAt desc`. The `(vendorId, userId)` unique constraint guarantees one membership per user per vendor, but a phone stored both on `vendor_users.phone` and on a *different* `users.phone` (e.g. after a phone change) could in theory match an unintended row. In practice phones are stable and the `desc` order picks the latest, so this is informational. No action required unless QA observes a mismatch.

### INFO-1: Domain event for re-invite reuses `createInvited` path but `StaffInvitedEvent` is built in the service, not emitted by the entity
- **File**: `invite-staff.service.ts:177-185`
- **Description**: `StaffInvitedEvent` is constructed then immediately `void`-discarded (no event bus in v1; Audit is the canonical consumer). This matches the documented v1 fire-and-forget approach and the US-003 precedent. The reinvite path (`reinvite()`) does not emit any membership event, which is consistent (invite is an invitation-aggregate concern, audited via `STAFF_INVITED`). No change needed; noted for the future event-bus US.

### INFO-2: `getProps()` spreads `permissions` defensively in membership entity but not in invitation entity
- **File**: `vendor-membership.entity.ts:66-74` vs `staff-invitation.entity.ts:49-56`
- **Description**: `VendorMembershipEntity.getProps()` returns `Object.freeze` AND copies the `permissions` array (`[...this._props.permissions]`), preventing mutation of the nested array. `StaffInvitationEntity.getProps()` returns `Object.freeze({...})` but the invitation has no nested mutable collections, so the shallow freeze is sufficient. Both satisfy the Entity-Invariants memory rule. Noted only for consistency awareness.

---

## Memory-rule verification

| Rule | Status | Evidence |
|---|---|---|
| CSPRNG for Secrets | ✅ | `invite-token.value-object.ts:19` `crypto.randomBytes(32)`; placeholder user password uses `crypto.randomBytes(24)` (`invite-staff.service.ts:90`). No `Math.random`. |
| No Placeholder Tests | ✅ | 50 real assertions across entity/VO/mapper/service/RBAC suites; edge cases (409/451/422/404/403, OQ-8 reactivation, fail-closed) all exercised. |
| Entity Invariants (freeze + validate both factories) | ✅ | Both entities: `create*`/`reconstitute` call `validate()`; `getProps()` returns `Object.freeze`. (`vendor-membership.entity.ts:66,119,139,149`; `staff-invitation.entity.ts:49,77,84`) |
| Refresh Token Context (reload real context, role/perms) | ✅ | `refresh-token.service.ts:40-60` reloads phone + vendor contexts + role/permission claims. |
| CorrelationId on All Errors | ✅ | `error-handler.ts` (all 4 branches) and `notFoundHandler` both set correlationId; integration tests assert `error.correlationId` on 404/422/409 paths. |
| Strict Zod Field Coverage | ✅ | `inviteStaffSchema` declares `sendVia?` (read nowhere yet but harmless); `acceptInviteSchema` declares token/password/name — all read by the accept handler. No `.strict()` schema omits a field the controller reads. |
| Idempotent Seeds | ✅ | Roles/permissions/role-perms via `upsert`; dev vendor & memberships guarded by `findFirst`/`findUnique` existence checks before `create`; staff grants via `upsert`; pending invite guarded by `findFirst`. Safe to re-run. |
| DomainEventBase | ✅ | All 6 staff events extend `DomainEventBase` with threaded `correlationId` metadata. |

---

## Skill Compliance Summary

| Skill | Status | Notes |
|---|---|---|
| module-scaffold.md | ✅ | Complex DDD layout matches FEATURE_TASKS; registered in `app.ts:65`; arrow-fn controllers with `next(error)`; composition-root routes. |
| prisma-schema-design.md | ✅ | BigInt ids, snake_case `@map`, FK + `deletedAt`/`status` indexes, composite `(vendorId,status)`, `onDelete: Cascade`, enum `@@map`. Aggregate boundary (StaffPermission owned, Cascade) respected. |
| domain-modeling.md | ✅ | Aggregates, VOs, state machine, events; cross-aggregate refs by id only; zero framework imports in `domain/`. |
| validation-schemas.md | ⚠️ | `.strict()` mutations + `.passthrough()` query correct; one gap (MINOR-1: status enum too permissive). |
| repository-implementation.md | ⚠️ | Soft-delete filters, P2002→ConflictError, focused updates, `tx?` on every method — but MAJOR-1 (one call omits `tx`). |
| service-implementation.md | ⚠️ | CQS clean, port injection, multi-tenant masking, audit single-path — MAJOR-1 + MINOR-2 transaction-scope notes. |
| error-handling.md | ✅ | Specific error classes, correct codes (403/404 mask/409/422/451), correlationId everywhere, AppError preserved through tx catch, audit log-and-swallow. |
| testing-strategy.md | ✅ | Entity/VO/mapper/service/RBAC unit tests + HTTP integration with correlationId + multi-tenant isolation assertions. No placeholders. |

---

## Verdict

**APPROVED WITH CONDITIONS — proceed to QA.**

No BLOCKER or CRITICAL findings: tenant isolation (404 masking) is correct, no data leaks (mapper whitelists; `tokenHash`/`passwordHash` never surfaced), the fail-closed port and JWT status re-check are sound, and all four Dev-flagged deviations check out. The one MAJOR (atomicity of the re-invite `update`, MAJOR-1) should be fixed before merge — it is a one-line `tx` addition — but does not block QA from validating the broader feature. MINOR-1/2 are recommended cleanups; MINOR-3/INFO are advisory.

Recommended Dev follow-up before merge:
1. **MAJOR-1** — add `tx` to the re-invite membership `update` (1 line).
2. **MINOR-1** — constrain `settableStatusField` to `ACTIVE`/`DISABLED`.
3. **MINOR-2** — confirm/handle the post-commit session-creation edge in accept-invite.
