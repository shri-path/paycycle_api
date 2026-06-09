# Feature Tasks: US-004 — Staff Management

## Complexity: Moderate (extension of the Complex US-002 staff context)
**Skills to follow:** `service-implementation.md`, `validation-schemas.md`, `repository-implementation.md`, `error-handling.md`, `prisma-schema-design.md` (migration only), `testing-strategy.md`.

> **Reuse-first directive:** This US wires new thin slices onto the **existing** `src/modules/staff` aggregates, repos, ports, mappers, and RBAC middleware. Do **not** create a new module, a new aggregate, or duplicate any US-002 table. If a task seems to require re-implementing something US-002 already shipped, stop and re-read `FEATURE_PLAN.md` § Schema Conflict Matrix.

> Each **Phase** starts only after the prior phase completes. Streams within a phase own **non-overlapping files** and run simultaneously. Agent count = number of independent file groups.

---

### Phase 1 (parallel — no cross-stream dependencies)

#### Stream A: Data Foundation + Migration
**Files owned:** `prisma/schema.prisma`, `prisma/migrations/`, `prisma/seeds/index.ts`, `project_documents/db-design/05-supply-lists.sql`, `project_documents/db-design/12-staff-management-rbac.sql`
**Skills:** `prisma-schema-design.md`
- **Task A1:** Add to `StaffInvitation` model: `sentVia StaffInvitationChannel?`, `sentCount Int @default(1)`, `lastSentAt DateTime @default(now())`. Add `enum StaffInvitationChannel { WHATSAPP SMS @@map("invitation_channel") }`. (No new index.)
- **Task A2:** Generate the additive migration (`ALTER TABLE staff_invitations ADD COLUMN ...`; create enum type idempotently). Backfill `UPDATE staff_invitations SET last_sent_at = created_at`. Verify non-breaking against existing rows.
- **Task A3:** Update `db-design/12-staff-management-rbac.sql` — add the 3 columns + a **US-004 reconciliation note** (mirrors the US-002 block) recording that `vendor_staff` / `staff_supply_list_assignments` / `staff_permissions` from the US-004 story are superseded by `vendor_users` / `supply_list_staff` / `vendor_staff_permissions`, and that the materialized view is deferred to US-006.
- **Task A4:** Update `db-design/05-supply-lists.sql` — add `assigned_by_user_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL` and `assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()` to `supply_list_staff` (built by US-005; documented now — OQ-2).
- **Task A5:** Extend the US-002 dev seed so one INVITED membership has `sent_count > 1` + `sent_via = WHATSAPP` (idempotent upsert).

#### Stream B: Validation + Types + Errors
**Files owned:** `src/modules/staff/staff.validator.ts`, `src/modules/staff/staff.types.ts`, `src/modules/staff/domain/staff.errors.ts`, `src/common/audit/audit-action.enum.ts`
**Skills:** `validation-schemas.md`, `error-handling.md`
- **Task B1:** `staff.validator.ts` — add `resendInviteSchema` (`.strict`, `{ sendVia? }`), `updatePermissionsSchema` (`.strict`, grant-map `[{ key: nativeEnum(PermissionKey), granted: boolean }]`, 1–3 items), `assignListSchema` (`.strict`, `{ supplyListId, isPrimary? }`), `listIdParamSchema` (adds `listId`). Add `name: nameField.optional()` to `updateStaffSchema`.
- **Task B2:** `staff.types.ts` — add `ResendInviteResponseDto { inviteUrl, expiresAt, sentVia }`, `StaffLimitsDto { maxStaff: number|null, currentActive, canAddMore }`, a `ListStaffResponseDto { items: StaffResponseDto[], pagination, limits: StaffLimitsDto }` wrapper, `UpdatePermissionsResponseDto { permissions: PermissionGrantDto[] }`. Add `name?` to the update input type.
- **Task B3:** `staff.errors.ts` — add `FeatureNotAvailableError extends AppError` (`statusCode 503`, `code 'FEATURE_NOT_AVAILABLE'`).
- **Task B4:** `audit-action.enum.ts` — add `STAFF_INVITE_RESENT`, `STAFF_LIST_ASSIGNED`, `STAFF_LIST_UNASSIGNED` (the latter two forward-compat for US-005).

#### Stream C: Ports + Stub Adapters
**Files owned:** `src/modules/staff/ports/staff-notification.port.ts`, `src/modules/staff/ports/list-assignment-write.port.ts`, `src/modules/staff/adapters/staff-notification-log.adapter.ts`, `src/modules/staff/adapters/list-assignment-write-stub.adapter.ts`
**Skills:** `service-implementation.md` (port/adapter pattern — mirror existing `list-assignment-stub.adapter.ts`)
- **Task C1:** `staff-notification.port.ts` — `StaffNotificationPort.sendStaffInvite(input)` (signature per FEATURE_PLAN § Strategy).
- **Task C2:** `staff-notification-log.adapter.ts` — implements it: structured `logger.info` with **masked phone**, channel, invite URL, expiry, correlationId; never throws (log-and-continue).
- **Task C3:** `list-assignment-write.port.ts` — `assign / unassign / setPrimary`.
- **Task C4:** `list-assignment-write-stub.adapter.ts` — every method throws `FeatureNotAvailableError`. (Imports the error from Stream B → see dependency note.)

> **Phase-1 dependency:** C4 imports `FeatureNotAvailableError` (B3). Either sequence B3 before C4 within Phase 1, or have C4 import the error class first. Keep B and C as separate agents but land B3 early.

---

### Phase 2 (parallel — after Phase 1)

#### Stream D: Repository delta
**Files owned:** `src/modules/staff/database/staff-invitation.repository.ts`, `staff-invitation.repository.port.ts`, `src/modules/staff/database/vendor-membership.repository.ts` (read-only addition), `src/modules/staff/database/staff.mapper.ts`
**Skills:** `repository-implementation.md`
**Depends on:** A1 (schema), B2 (types)
- **Task D1:** Extend `StaffInvitationRepository.insert` (+ port) to persist `sentVia`, `sentCount`, `lastSentAt`. Add `getLatestByMembership(membershipId)` (to read prior `sentCount` for resend). Keep `revokePendingByMembership` reused as-is.
- **Task D2:** `staff.mapper.ts` — map the 3 new invitation columns in `toDomain`/`toPersistence`/`invitationToResponse` (response exposes `sentVia` only, never `tokenHash`). Add `toLimitsResponse(...)` helper or fold limits mapping into the list query (Stream E owns the call).
- **Task D3:** `VendorMembershipRepository` — confirm `countActiveStaff(vendorId)` exists (it does — used by `SubscriptionLimitStubAdapter`); add `countByStatuses` if the `limits.currentActive` definition needs ACTIVE-only vs ACTIVE+INVITED (per FEATURE_PLAN: `currentActive` = ACTIVE memberships; `canAddMore` compares against limit). No write changes.

#### Stream E: Application services
**Files owned:** `src/modules/staff/commands/resend-invite/`, `src/modules/staff/commands/update-permissions/`, `src/modules/staff/commands/assign-list/`, `src/modules/staff/commands/unassign-list/`, `src/modules/staff/commands/update-staff/update-staff.service.ts` (+ dto), `src/modules/staff/queries/list-staff/list-staff.service.ts`
**Skills:** `service-implementation.md`, `error-handling.md`
**Depends on:** B (types/errors/validator), C (ports), D (repo signatures — coordinate interface up-front)
- **Task E1 — `ResendInviteService`:** load membership (404-mask), guard `status === INVITED` (else 422), TX{ revoke pending + create new invitation with `sentCount = prev+1`, `sentVia`, fresh token }, call `StaffNotificationPort`, audit `STAFF_INVITE_RESENT`, return `ResendInviteResponseDto`. Mirror `InviteStaffService` structure.
- **Task E2 — `UpdatePermissionsService`:** load membership (404-mask), `entity.setPermissions(grants)`, `replacePermissions`, audit `STAFF_PERMISSIONS_CHANGED`, return grant state. (Owner target → returns all-allow, no write.)
- **Task E3 — `AssignListService` / `UnassignListService`:** guards (owner already in route; tenant + staff-exists 404), delegate to `ListAssignmentWritePort` → stub 503. Thin.
- **Task E4 — Enhance `UpdateStaffService`:** accept optional `name`; when present, update `User.name` for the membership's `userId` (inject `IUserRepository`) inside the existing transaction. Preserve existing status/area/permissions behaviour.
- **Task E5 — Enhance `InviteStaffService`:** after commit, call `StaffNotificationPort.sendStaffInvite(...)` with the request `sendVia`; persist `sentVia` on the invitation. (Coordinate the invitation insert shape with D1.)
- **Task E6 — Enhance `ListStaffService`:** after building the page, attach `limits` via `SubscriptionLimitPort` (`maxStaff = getStaffLimit`, `currentActive = countActiveStaff`, `canAddMore = limit === null || currentActive < limit`). Return `ListStaffResponseDto`.

---

### Phase 3 (parallel — after Phase 2)

#### Stream F: Interface layer
**Files owned:** `src/modules/staff/staff.controller.ts`, `src/modules/staff/staff.routes.ts`
**Skills:** `module-scaffold.md` (Steps 5–9)
**Depends on:** E (services), B1 (validators)
- **Task F1 — Controller:** add `resend`, `updatePermissions`, `assignList`, `unassignList` arrow handlers (try/catch → `next(error)`); derive `vendorId`/`staffId`/`listId` from params, `assignedByUserId`/`invitedByUserId` from `req.user`. Update `list`/`update`/`invite` handlers for the enhanced payloads.
- **Task F2 — Routes (composition root):** instantiate `StaffNotificationLogAdapter` + `ListAssignmentWriteStubAdapter`; inject into the new/enhanced services; mount:
  - `POST /:vendorId/staff/:staffId/resend-invitation` (auth, `inviteLimiter`, params+body validate, identifyUserRole, requireOwnerRole)
  - `PATCH /:vendorId/staff/:staffId/permissions` (auth, params+body validate, identifyUserRole, requireOwnerRole)
  - `POST /:vendorId/staff/:staffId/assign-list` (auth, params+body validate, identifyUserRole, requireOwnerRole)
  - `DELETE /:vendorId/staff/:staffId/unassign-list/:listId` (auth, `listIdParamSchema`, identifyUserRole, requireOwnerRole)
- **Task F3 — Swagger:** annotate the 4 new endpoints + the enhanced `list`/`update`/`invite` response schemas.

#### Stream G: Tests
**Files owned:** `src/modules/staff/__tests__/**`, `tests/integration/staff-us004.test.ts`
**Skills:** `testing-strategy.md`
**Depends on:** all prior streams
- **Task G1 — Unit:** resend status-guard (INVITED ok; ACTIVE/DISABLED/REMOVED → 422) + token rotation (old REVOKED, new PENDING, `sentCount++`); `setPermissions` owner no-op; notification stub log-and-continue (throws inside adapter must not bubble); `FeatureNotAvailableError` shape; `limits` math (null=unlimited→`canAddMore` true; at-cap→false).
- **Task G2 — Integration (HTTP):** for each new endpoint — 401 no-token, 403 staff-on-owner-route, 404 wrong-tenant/wrong-staff **mask**, happy path. Assert the 503 gating **order** for assign/unassign (a staff caller gets 403, not 503; a wrong-tenant owner gets 404, not 503; only a valid owner gets 503). Assert `correlationId` on every error body. Assert `limits` block present on `GET /staff`. Assert `name` edit reflects in subsequent `GET /staff/:id`.
- **Task G3 — Regression:** run the full existing US-002 staff suite (157 tests) — **must stay green**; the enhancements must not break invite/accept/list/update/remove contracts.

---

## Scaling guidance
- **Phase 1:** 3 agents (A / B / C) — distinct file groups; land B3 (error class) before C4.
- **Phase 2:** 2 agents (D / E) — agree the repo interface (D1/D3 signatures) before E starts coding against it.
- **Phase 3:** 2 agents (F / G).
- Total surface is small (mostly additive) — do **not** over-parallelize into more agents than the file groups above.

## Definition of Done (this slice)
- [ ] Migration applies cleanly; existing rows backfilled; build + lint green.
- [ ] 4 new endpoints live; `list`/`update`/`invite` enhancements live.
- [ ] `FeatureNotAvailableError` (503) returned by assign/unassign **only after** auth+owner+tenant guards.
- [ ] Notification stub logs invite + resend; never breaks the command on failure.
- [ ] `limits` block correct against the unlimited stub.
- [ ] New unit + integration tests pass; **all US-002 tests still pass**.
- [ ] `PROGRESS_TRACKER.md` US-004 backend → 🟢 on merge (Architect set it 🟡 now).
- [ ] Deferred items (staff-persona endpoints, materialized view, real list writes, tier caps, real provider) recorded as US-005/US-006/US-009 follow-ups — **not** silently dropped.
