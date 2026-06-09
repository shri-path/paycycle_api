# Feature: US-004 — Staff Management

> **Branch:** `feat/us-004-staff-management`
> **Module:** `src/modules/staff` (EXTEND the existing US-002 bounded context — do **not** create a new module)
> **Depends on (DONE):** US-002 Roles & Access (merged — VendorMembership + StaffInvitation aggregates, RBAC middleware, AuditLogger, ports) · US-003 Auth (JWT, User)
> **Blocked-by (partial, deferred behind ports):** US-005 Supply Lists · US-006 Delivery Tracking · US-009 Subscription Pricing
> **Authoring date:** 2026-06-09

---

## TL;DR — Reconciliation Verdict

**US-004 is ~85% already implemented by the merged US-002 staff bounded context.** The US-004 user story was written *before* US-002 landed and proposes a **parallel, conflicting schema** (`vendor_staff`, `staff_supply_list_assignments`, `staff_permissions`, a plaintext-code `staff_invitations`, and a `staff_activity_stats` materialized view). Every one of those overlaps an already-merged table. **This plan reconciles onto the unified US-002 model and does NOT duplicate it.** See [§ Schema Conflict Matrix](#schema-conflict-matrix) and [§ Open Questions](#open-questions).

The genuine **new backend work that is buildable now** (no US-005/006/009 dependency):
1. `POST /staff/:staffId/resend-invitation` — new command (revoke pending + re-issue token + send).
2. `PATCH /staff/:staffId/permissions` — dedicated grant-map endpoint (frontend contract parity).
3. `name` editable via `PATCH /staff/:staffId` (currently only set at invite time).
4. `limits { maxStaff, currentActive, canAddMore }` block on `GET /staff` (via existing `SubscriptionLimitPort`).
5. `StaffNotificationPort` (+ logging stub) wired into invite **and** resend — satisfies the WhatsApp/SMS requirement at the seam without an external provider.
6. `ListAssignmentWritePort` (+ fail-closed stub) backing two **gated** endpoints (`assign-list` / `unassign-list`) so the frontend contract exists; the stub returns **503 FEATURE_NOT_AVAILABLE** until US-005 swaps in the real adapter.

**Deferred** (documented, not built — hard dependency, fail-closed behind ports):
- Real list-assignment persistence + "one primary per list" (US-005).
- Staff-facing endpoints `GET /staff/dashboard|my-lists|my-customers|my-activity` (US-005 lists + US-006 deliveries — meaningless without them).
- `staff_activity_stats` materialized view + hourly refresh (US-006 `daily_supplies`).
- Real subscription tier caps `starter:0 / growth:3 / pro:10` (US-009).
- Real WhatsApp/SMS provider integration (external).

---

## Complexity Assessment

- **Tier:** **Moderate** (an *extension* of a Complex context).
- **Justification:**
  - The hard domain work — aggregates, state machine, invariants, multi-tenant masking, domain events, RBAC, audit, port abstractions — **already exists** from US-002 and is reused verbatim.
  - US-004's delta is: 2 new thin command/query slices, 1 enhanced query, 2 new ports with stubs, 1 new error class, and schema columns on an existing table. No new aggregate, no new state machine.
  - It *does* carry real cross-module seams (Supply Lists write, Notifications) that must be designed as ports — that keeps it above "Simple CRUD".
- **Directory structure** (additions to the existing `src/modules/staff/`):

```
src/modules/staff/
  commands/
    resend-invite/        # NEW  { resend-invite.request.dto.ts, resend-invite.service.ts }
    update-staff/         # EXTEND update-staff.service.ts to accept `name`
    update-permissions/   # NEW  { update-permissions.request.dto.ts, update-permissions.service.ts }
    assign-list/          # NEW (gated)  { assign-list.request.dto.ts, assign-list.service.ts }
    unassign-list/        # NEW (gated)  { unassign-list.service.ts }
  queries/
    list-staff/           # EXTEND list-staff.service.ts to attach `limits` block
  ports/
    list-assignment-write.port.ts   # NEW  (write side of supply-list assignment — US-005)
    staff-notification.port.ts       # NEW  (WhatsApp/SMS invite delivery)
  adapters/
    list-assignment-write-stub.adapter.ts  # NEW  fail-closed → 503 FEATURE_NOT_AVAILABLE
    staff-notification-log.adapter.ts        # NEW  logs the would-be message + invite URL
  domain/
    staff.errors.ts       # EXTEND — add FeatureNotAvailableError
  staff.validator.ts      # EXTEND — resendInviteSchema, updatePermissionsSchema, assignListSchema, listIdParamSchema, name on updateStaffSchema
  staff.types.ts          # EXTEND — ResendInviteResponseDto, StaffLimitsDto, list response wrapper, name on update
  staff.controller.ts     # EXTEND — resend, updatePermissions, assignList, unassignList handlers
  staff.routes.ts         # EXTEND — wire 4 new routes + 2 new adapters in the composition root
```

> The existing `vendor-membership.entity.ts` already exposes everything we need: `setPermissions()`, `reinvite()`, `updateArea()`, the status machine, and owner guards. **No domain-entity changes** are required beyond adding the error class.

---

## Schema Conflict Matrix

> **Rule applied:** the merged Prisma schema (`prisma/schema.prisma`) + the US-002 reconciliation block in `db-design/12-staff-management-rbac.sql` are the **source of truth**. Every US-004 story table below is reconciled, not created. Conflicts are raised as Open Questions.

| # | US-004 story table / artifact | Merged US-002 reality | Verdict | OQ |
|---|---|---|---|---|
| 1 | `vendor_staff` (id, vendor_id, user_id, phone, name, area_route_label, status, lifecycle ts) | `vendor_users` — unified owners+staff, same columns (`status`, `phone`, `area_route_label`, `invited/joined/disabled/removed_at`, soft-delete) | **REUSE `vendor_users`.** Drop `vendor_staff` from the design. | OQ-1 |
| 2 | `staff_supply_list_assignments` (staff_id, supply_list_id, is_primary, assigned_at, assigned_by) | `supply_list_staff` (supply_list_id, vendor_user_id, is_primary) — already in `db-design/05`, FK wired in `12` | **REUSE `supply_list_staff`.** It lacks `assigned_by_user_id` / `assigned_at` → add those columns (owned/built by US-005). | OQ-2 |
| 3 | `staff_permissions` (staff_id, permission_key, granted_at, granted_by) | `vendor_staff_permissions` (vendor_user_id, permission_key, granted boolean, ts) — merged | **REUSE `vendor_staff_permissions`.** No `granted_by` — `audit_logs` already records the actor. | OQ-3 |
| 4 | `staff_invitations` — plaintext `invitation_code`, `sent_via`, status `SENT/ACCEPTED/EXPIRED` | `staff_invitations` — `token_hash` (sha256 of CSPRNG), status `PENDING/ACCEPTED/EXPIRED/REVOKED`, **no** `sent_via` | **KEEP token-hash design** (more secure). **Add** `sent_via` + `sent_count` + `last_sent_at` for the channel + resend requirement. | OQ-4 |
| 5 | Accept flow: `POST /api/staff/accept-invitation/:code` with `{ invitationCode, userId }` (already-authenticated user) | `POST /api/v1/auth/accept-invite` with `{ token, password, name? }` → creates/links User + auto-login JWT | **KEEP merged flow.** Story's "userId already registered" model contradicts phone-first onboarding. | OQ-5 |
| 6 | `staff_activity_stats` MATERIALIZED VIEW over `daily_deliveries.marked_by_staff_id` | No `daily_deliveries` table exists; delivery ledger is `daily_supplies` with `marked_by_user_id` (FK→users, **not** staff_id) | **DEFER to US-006.** When built, base it on `daily_supplies.marked_by_user_id` joined via `vendor_users`; resolve "staff" by user_id, not a `marked_by_staff_id` column. | OQ-6 |
| 7 | Subscription tiers `starter:0 / growth:3 / pro:10` enforced inline | `SubscriptionLimitPort` stub → `null` (unlimited) until US-009 | **KEEP port.** Tier table is US-009. 451 plumbing already exists. | OQ-7 |
| 8 | `vendor_staff.user_id` nullable, `ON DELETE SET NULL` (staff has no account until accept) | `vendor_users.user_id` NOT NULL, `onDelete: Cascade`; invite creates a **placeholder User** for the phone | **KEEP placeholder-User approach** (already shipped in `invite-staff.service`). | OQ-8 |
| 9 | Invite request carries `supplyListIds[]` + `primaryListId` (assign-on-invite) | US-002 invite is list-free (lists deferred to US-005) | **DEFER assign-on-invite.** Invite stays list-free; assignment is a separate (gated) endpoint until US-005. | OQ-9 |

**Net new tables created by US-004: zero.** Net schema delta: 3 columns + 1 enum on the existing `staff_invitations` table; 2 documented columns added to the US-005-owned `supply_list_staff` SQL.

---

## API Endpoints

Base path `/api/v1`. All require `authenticateToken`. Owner-only routes run `identifyUserRole(:vendorId)` → `requireOwnerRole()`. Multi-tenant: wrong `:vendorId`/`:staffId` → **404 NotFound** (mask), never 403. Every error response carries `correlationId` (memory rule).

### Already shipped by US-002 (no change unless noted)
| Method | Path | CQS | Notes |
|--------|------|-----|-------|
| GET | `/vendors/:vendorId/role` | Query | Role detection. Unchanged. |
| GET | `/vendors/:vendorId/staff` | Query | **ENHANCE** → add `limits { maxStaff, currentActive, canAddMore }`. |
| POST | `/vendors/:vendorId/staff/invite` | Command | **ENHANCE** → call `StaffNotificationPort.sendStaffInvite(...)` after commit; accept optional `sendVia`. |
| GET | `/vendors/:vendorId/staff/:staffId` | Query | Unchanged (assigned-list count/ids already via read port). |
| PATCH | `/vendors/:vendorId/staff/:staffId` | Command | **ENHANCE** → also accept `name` (updates linked `User.name`). |
| DELETE | `/vendors/:vendorId/staff/:staffId` | Command | Unchanged (soft-remove, emits unassign event). |
| POST | `/auth/accept-invite` | Command (public) | Unchanged. |

### New in US-004
| # | Method | Path | CQS | Auth | Status | Notes |
|---|--------|------|-----|------|--------|-------|
| N1 | POST | `/vendors/:vendorId/staff/:staffId/resend-invitation` | Command | owner | **build now** | Body `{ sendVia?: 'whatsapp'\|'sms' }`. Allowed only when membership is `INVITED`. Revokes any PENDING invite, issues a fresh CSPRNG token (7-day expiry), increments `sent_count`, calls `StaffNotificationPort`. Returns `{ inviteUrl, expiresAt, sentVia }`. 200. |
| N2 | PATCH | `/vendors/:vendorId/staff/:staffId/permissions` | Command | owner | **build now** | Body `{ permissions: [{ key, granted }] }` (grant-map). Calls `membership.setPermissions()`. Returns the full 3-key grant state. Owner target → grants ignored (all-allow). 200. |
| N3 | POST | `/vendors/:vendorId/staff/:staffId/assign-list` | Command | owner | **gated (503)** | Body `{ supplyListId, isPrimary? }`. Delegates to `ListAssignmentWritePort.assign(...)`. Stub throws `FeatureNotAvailableError` (503) until US-005. |
| N4 | DELETE | `/vendors/:vendorId/staff/:staffId/unassign-list/:listId` | Command | owner | **gated (503)** | `ListAssignmentWritePort.unassign(...)`. Stub → 503 until US-005. |

### Deferred — documented, NOT routed in this US (US-005 + US-006)
`GET /staff/dashboard`, `GET /staff/my-lists`, `GET /staff/my-customers`, `GET /staff/my-activity`. These are staff-persona screens whose entire payload is supply-list + delivery data. Scaffolding them now would return empty/placeholder objects that the frontend cannot use and that would need rework once the real data lands. See OQ-10.

### Zod patterns (per `validation-schemas.md` + memory `.strict()` rule)
- N1 `resendInviteSchema`: `.strict()`, `{ sendVia: z.enum(['whatsapp','sms']).optional() }`.
- N2 `updatePermissionsSchema`: `.strict()`, `{ permissions: z.array(z.object({ key: z.nativeEnum(PermissionKey), granted: z.boolean() }).strict()).min(1).max(3) }`.
- N3 `assignListSchema`: `.strict()`, `{ supplyListId: bigIntIdString, isPrimary: z.boolean().optional() }`. `listIdParamSchema` adds `listId: bigIntIdString`.
- `updateStaffSchema`: add `name: nameField.optional()` (already imported).
- All mutations `.strict()`; declare every field the controller reads.

### Error response shape (unchanged)
```json
{ "success": false, "error": { "code": "FEATURE_NOT_AVAILABLE", "message": "..." }, "correlationId": "<uuid>" }
```

---

## Data Model Changes

### `StaffInvitation` (table `staff_invitations`) — ADD resend/channel tracking
```prisma
enum StaffInvitationChannel {
  WHATSAPP
  SMS
  @@map("invitation_channel")   // reuses the enum already named in db-design/12
}

model StaffInvitation {
  // ...existing fields unchanged...
  sentVia    StaffInvitationChannel? @map("sent_via")
  sentCount  Int      @default(1)    @map("sent_count")
  lastSentAt DateTime @default(now()) @map("last_sent_at")
  // ...
}
```
- **Aggregate boundary:** still owned by the `StaffInvitation` aggregate. `sentVia`/`sentCount`/`lastSentAt` are invitation-delivery metadata, not a new aggregate.
- Backfill: `sent_count` defaults 1, `last_sent_at` defaults `created_at` for existing rows (migration `UPDATE ... SET last_sent_at = created_at`).
- No new index needed (lookups remain by `token_hash` / `vendor_user_id`).

### `supply_list_staff` (US-005-owned) — DOCUMENT two columns for assignment audit
US-004 needs to record *who assigned* a staff member to a list and *when*. The table is created by US-005, so this plan **updates the db-design SQL** (`05-supply-lists.sql`) to include:
```sql
assigned_by_user_id BIGINT      NULL REFERENCES users(id) ON DELETE SET NULL,
assigned_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
```
US-005's Dev builds these into the Prisma model. US-004 only references them through `ListAssignmentWritePort`. (OQ-2.)

### Reused as-is (no change)
`vendor_users`, `vendor_staff_permissions`, `audit_logs`, `roles`, `permissions`, `role_permissions`, `User`, `Vendor`.

### Seed data
- No new roles/permissions. The `delivery:mark` / `leave:mark` / `charge:add` catalog + `owner`/`staff` roles were seeded in US-002.
- Dev faker data: extend the US-002 seed to give one INVITED membership a `sent_count > 1` + `sent_via = WHATSAPP` so the resend path has fixture coverage. (Idempotent upsert — memory rule.)

### Migration
Single additive migration `prisma/migrations/<ts>_us-004-invitation-channel/` — `ALTER TABLE staff_invitations ADD COLUMN ...` (3 cols + enum). Non-breaking; all nullable/defaulted.

---

## Business Rules

### Invariants (reuse existing entity guards)
- **Resend (N1):** allowed only when membership `status = INVITED`. **ACTIVE/DISABLED → `InvalidStatusTransitionError` (422)** "Only pending invitations can be resent." **REMOVED → `NotFoundError` (404)** — a removed membership is soft-deleted (`deletedAt` set), so the tenant/existence guard masks it as 404 *before* the status check, consistent with the module-wide soft-delete masking convention (never reveal a removed member exists). *(QA BUG-001: the 404 for REMOVED is intended behavior, not the 422 an earlier draft implied.)* Re-issuing rotates the token (old PENDING invite → REVOKED, single new PENDING).
- **Permissions (N2):** grants only meaningful for STAFF; owner target → no-op (entity already returns early in `setPermissions`). Invalid key → Zod 400. Emits `StaffPermissionsChangedEvent` (already wired) → Audit.
- **Assign/unassign (N3/N4):** owner-only; `:staffId` must be an active member of `:vendorId` (else 404). Until US-005: `FeatureNotAvailableError` (503) **after** the tenant/role guards pass (so the 503 only reaches authorized owners, never leaks existence).
- **Name edit:** `name` 1–100 chars; updates `User.name` for the membership's linked user in the same transaction as other staff fields.

### "One primary staff per list" (edge case 4) — DEFERRED to US-005
Enforced in the real `ListAssignmentWriteAdapter` (US-005) as: setting `isPrimary=true` clears `is_primary` on other `supply_list_staff` rows for that `supply_list_id`, in one transaction. Documented here so US-005 inherits the rule; the stub cannot enforce it.

### "Staff becomes inactive if no lists assigned" (edge case 3) — DEFERRED to US-005
Out of scope now (no list data). Recommend US-005 treats this as a *frontend warning + owner choice*, **not** an automatic status flip, to avoid surprising lifecycle transitions. Flagged for US-005.

### Multi-tenant isolation (unchanged from US-002)
`:vendorId` from route, verified against JWT `vendors[]`; `:staffId`/`:listId` cross-tenant → 404. Body never supplies `vendorId`.

---

## Sequence Diagrams (text-based)

### N1 — Resend invitation (Command)
```
Owner → POST /vendors/:vendorId/staff/:staffId/resend-invitation { sendVia? }
  authenticateToken → identifyUserRole(:vendorId) → requireOwnerRole
  controller → assert vendorId ∈ req.user.vendors (else 404); parse staffId
  → ResendInviteService.execute(cmd)
     → membershipRepo.findById(staffId); guard vendor match + not deleted (else 404)
     → guard status === INVITED (else InvalidStatusTransitionError 422)
     → InviteToken.generate() → { raw, hash }
     → BEGIN TX
        invitationRepo.revokePendingByMembership(staffId, tx)      // old token → REVOKED
        StaffInvitationEntity.create({...}, raw) → toPersistence    // new PENDING, expires=+7d
        invitationRepo.insert({ ..., sentVia, sentCount: prev+1, lastSentAt: now }, tx)
     → COMMIT
     → StaffNotificationPort.sendStaffInvite({ phone, vendorName, inviteUrl, channel, expiresAt })  // stub logs
     → AuditLogger.log(STAFF_INVITE_RESENT, entity=staff, entityId=staffId, metadata={ sentVia })
  → mapper.invitationToResponse → { inviteUrl, expiresAt, sentVia } → sendOk (200)
```

### N2 — Update permissions (Command)
```
Owner → PATCH /vendors/:vendorId/staff/:staffId/permissions { permissions:[{key,granted}] }
  → guards (owner, tenant, 404-mask)
  → UpdatePermissionsService.execute(cmd)
     → membershipRepo.findById → toDomain(entity)
     → entity.setPermissions(grants, correlationId)   // emits StaffPermissionsChangedEvent
     → membershipRepo.replacePermissions(staffId, toGrantInputs(entity))   // existing repo method
     → AuditLogger.log(STAFF_PERMISSIONS_CHANGED, metadata={ before, after })
  → toResponse → { permissions: PermissionGrantDto[] } (200)
```

### N3 — Assign list (Command, gated)
```
Owner → POST /vendors/:vendorId/staff/:staffId/assign-list { supplyListId, isPrimary? }
  → guards (owner, tenant, staff-exists-404)
  → AssignListService.execute(cmd)
     → ListAssignmentWritePort.assign(staffId, supplyListId, isPrimary, assignedByUserId)
        → STUB: throw FeatureNotAvailableError('Supply Lists are not available yet (US-005)')  // 503
  (US-005 real adapter: validate list ∈ vendor → upsert supply_list_staff → if isPrimary clear others → audit)
```

---

## Strategy / Port Interfaces

### `StaffNotificationPort` (NEW — WhatsApp/SMS invite delivery)
```ts
export type InviteChannel = 'whatsapp' | 'sms';
export interface StaffNotificationPort {
  sendStaffInvite(input: {
    phone: string;
    vendorName: string;
    inviteUrl: string;
    channel: InviteChannel;
    expiresAt: Date;
    correlationId: string;
  }): Promise<void>;
}
```
- **Stub (`staff-notification-log.adapter.ts`):** structured `logger.info` of the would-be message + the channel + masked phone + invite URL; never throws into the request path (log-and-continue, like `AuditLogger`). The real provider (Twilio/Gupshup/etc.) lands in a later integration US.
- Wired into **both** `InviteStaffService` (enhance) and `ResendInviteService` (new), after the DB commit.

### `ListAssignmentWritePort` (NEW — write side of supply-list assignment, US-005)
```ts
export interface ListAssignmentWritePort {
  assign(staffMembershipId: bigint, listId: bigint, isPrimary: boolean, assignedByUserId: bigint): Promise<void>;
  unassign(staffMembershipId: bigint, listId: bigint): Promise<void>;
  setPrimary(staffMembershipId: bigint, listId: bigint): Promise<void>;
}
```
- Kept **separate** from the existing read-only `ListAssignmentPort` so the stable read stub (US-002) is untouched.
- **Stub (`list-assignment-write-stub.adapter.ts`):** every method throws `FeatureNotAvailableError` (503). Real adapter ships in US-005, swapped in the composition root only.

### Reused from US-002 (no change)
`ListAssignmentPort` (read, fail-closed stub), `SubscriptionLimitPort` (unlimited stub — now also consumed by the enhanced staff-list `limits` block), `AuditPort` / `AuditLogger`.

---

## Error Handling Strategy

| Operation | Failure | Error class | HTTP |
|---|---|---|---|
| Resend on non-INVITED membership | state | `InvalidStatusTransitionError` | 422 |
| Assign/unassign before US-005 | gated | `FeatureNotAvailableError` (**NEW**) | 503 |
| `:staffId`/`:listId` wrong tenant | mask | `NotFoundError` | 404 |
| Owner-only route by staff | rbac | `ForbiddenError` | 403 |
| Invalid permission key/grant shape | zod | `ValidationError` | 400 |
| Notification provider failure | external | swallowed + `warn(correlationId)` — never blocks the command | — |

- **`FeatureNotAvailableError`** → add to `src/modules/staff/domain/staff.errors.ts`, extends `AppError`, `statusCode 503`, `code 'FEATURE_NOT_AVAILABLE'`. (Mirrors the `SubscriptionLimitError(451)` precedent.)
- All other error classes already exist from US-002.

## Security Considerations
- Resend rotates the token (old → REVOKED, single-use preserved); never re-sends a stored raw token (only the hash is stored — raw exists only in the returned/sent URL).
- Reuse the per-owner invite rate-limiter for `resend-invitation` (prevents invite-spam / SMS-cost abuse). Recommend the same `inviteLimiter` instance.
- Gated 503 endpoints run **after** auth + owner + tenant guards, so they never reveal staff/list existence to non-owners.
- Notification stub logs a **masked** phone (e.g. `+9199•••••210`), never the full number or raw token beyond the URL.

## Performance Considerations
- `limits` block: one `COUNT(*)` on `vendor_users(vendorId, status)` (composite index exists) + a port call (stub is O(1)). Negligible.
- Resend: single indexed `token_hash` insert + one update of the prior PENDING row. No N+1.
- No materialized view in this US (deferred), so no refresh-job cost.

---

## Open Questions

> Per standing memory: each carries a **recommendation + trade-off**. These do **not** block — the plan is complete with the recommended defaults applied. Flag any you want changed before Dev finalizes.

**OQ-1 — Collapse `vendor_staff` into `vendor_users`?**
*Recommend:* **Yes** — reuse the unified `vendor_users`; do not create `vendor_staff`. *Trade-off:* "staff" is a role-filtered view of `vendor_users` (status + role=staff), not its own table; queries filter by role. Alternative (separate table) re-introduces the owner/staff split US-002 deliberately unified and would duplicate lifecycle + soft-delete logic. **Low risk.**

**OQ-2 — Add `assigned_by_user_id` + `assigned_at` to `supply_list_staff` (US-005's table)?**
*Recommend:* **Yes**, add both to `db-design/05` now so US-005 builds them; US-004 references via the write port. *Trade-off:* US-004 edits a table it doesn't own — but the alternative is losing assignment-audit provenance the story explicitly asks for. Coordinated via this plan + the SQL update.

**OQ-3 — Per-grant `granted_by` on `vendor_staff_permissions`?**
*Recommend:* **No** — `audit_logs` already records who changed permissions (actor + before/after). *Trade-off:* reconstructing "who granted *this specific* key" requires an audit scan rather than a column read. Acceptable; avoids denormalized actor columns on a hot table.

**OQ-4 — Invitation channel/resend columns (`sent_via`, `sent_count`, `last_sent_at`)?**
*Recommend:* **Add all three** to `staff_invitations`. *Trade-off:* tiny schema growth vs. the story's WhatsApp/SMS + "owner can resend" requirements being untrackable. Keeps the secure token-hash design (rejects the story's plaintext `invitation_code`).

**OQ-5 — Accept-invite contract: keep `POST /auth/accept-invite { token, password, name? }`?** *(RESOLVED 2026-06-09 — APPROVED: keep the merged flow. Frontend targets this contract.)*
*Recommend:* **Keep the merged flow** (creates/links User + auto-login). *Trade-off:* diverges from the story's `accept-invitation/:code` + pre-authenticated `userId` shape — the **frontend (US-002 FE planning) must target the merged contract.** The story's model assumes the invitee already has an account, which contradicts phone-first onboarding. **Frontend-impacting — confirm.**

**OQ-6 — `staff_activity_stats` materialized view: defer to US-006?**
*Recommend:* **Defer.** Build it in US-006 over `daily_supplies.marked_by_user_id` (resolve staff via `vendor_users`), **not** the story's non-existent `daily_deliveries.marked_by_staff_id`. *Trade-off:* owner staff cards show zeroed `todayStats`/`thisMonthStats` (already placeholdered in US-002 OQ-9) until US-006. Building it now would query a table that doesn't exist.

**OQ-7 — Subscription tier caps (`starter:0/growth:3/pro:10`): keep behind `SubscriptionLimitPort`?**
*Recommend:* **Keep the port** (unlimited stub) until US-009 owns the plan table. *Trade-off:* no real cap enforcement yet; the 451 path + `limits` block are wired and unit-tested with a mocked port, so US-009 is a drop-in. (Restates US-002 OQ-7.)

**OQ-8 — Keep placeholder-User-at-invite (vs nullable `user_id`)?**
*Recommend:* **Keep** the shipped placeholder-User approach. *Trade-off:* a `users` row exists for not-yet-joined staff (cleaned/claimed on accept) vs. the story's nullable FK. Changing it now would rewrite the merged invite/accept services for no functional gain.

**OQ-9 — Assign-on-invite (`supplyListIds[]` + `primaryListId` in the invite body)?**
*Recommend:* **Defer** — invite stays list-free; assignment via the separate (gated) endpoint until US-005. *Trade-off:* the owner invites, then assigns lists in a second call (and the FE invite screen's list-picker is deferred to US-005, matching the US-002 FE OQ-6). Folding lists into invite now would couple the buildable invite path to the unbuilt Supply List module.

**OQ-10 — Staff-facing endpoints (`/staff/dashboard|my-lists|my-customers|my-activity`): defer entirely?** *(RESOLVED 2026-06-09 — APPROVED: defer all four to US-005/US-006. Not routed in this US.)*
*Recommend:* **Defer all four** to US-005 (+US-006). *Trade-off:* the staff persona has no usable backend until then — but every field in these payloads is list/delivery data; scaffolding empty shells now guarantees rework. Recommend they land **with** US-005/US-006 where the data exists. **Scope-defining — confirm.**

---

## Handoff
- **Dev** consumes this + `FEATURE_TASKS.md` + `DOMAIN_MODEL.md`. Most work is wiring new thin slices onto existing repos/entities — **no aggregate redesign**.
- **Review/QA** verify against this plan + skills. The high-value test targets are: resend token-rotation + status guard, the 503 gating order (auth→owner→tenant→503), the `limits` block math, and notification-stub log-and-continue.
- Skills to follow: `service-implementation.md`, `validation-schemas.md`, `repository-implementation.md` (minor), `error-handling.md`, `testing-strategy.md`, `prisma-schema-design.md` (migration only).
