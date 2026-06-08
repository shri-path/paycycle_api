# Feature: US-002 — Roles & Access Control System (RBAC + Staff Management + Audit Logging)

> **Branch (intended):** `feat/us-002-roles-access`
> **Module:** `src/modules/staff` (new bounded context) + RBAC infrastructure middleware + audit service
> **Depends on:** US-003 Auth (DONE) — JWT, `VendorUser`, `Role`, `Permission` already exist.
> **Blocked-by (partial):** US-005 Supply Lists (NOT built) — see Open Question OQ-1.

---

## Complexity Assessment

- **Tier:** **Complex**
- **Justification:**
  - Multiple aggregates with real invariants and a state machine (`VendorMembership` lifecycle: INVITED → ACTIVE → DISABLED → REMOVED).
  - Cross-cutting authorization framework (role detection + permission enforcement middleware) consumed by *every other module*.
  - Cross-module domain events (staff invited/disabled/removed/permissions-changed) feed the Audit context and future Notifications.
  - Multi-tenant isolation is a first-class concern (vendorId scoping, wrong-tenant masking as NotFound).
  - A permission-port abstraction is required to decouple list-scoped checks from the not-yet-built Supply List module (OQ-1).
  - This is **not** plain CRUD — it owns business-critical security invariants. Per `ddd-module-design.md` Step 0, that mandates the full DDD treatment (Aggregates, VOs, Domain Events, ports).

- **Directory Structure** (mirrors the `auth` reference module):

```
src/modules/staff/
  staff.controller.ts
  staff.routes.ts            # composition root for /api/v1/vendors/:vendorId/staff
  staff.validator.ts
  staff.types.ts             # DTOs (request/response)
  staff.mapper.ts            # toDomain / toPersistence / toResponse
  domain/
    vendor-membership.entity.ts     # aggregate root (wraps VendorUser + permission grants)
    vendor-membership.types.ts
    staff-invitation.entity.ts      # aggregate root (invite token lifecycle)
    staff-invitation.types.ts
    value-objects/
      permission-key.value-object.ts
      membership-status.value-object.ts
    events/
      staff-invited.domain-event.ts
      staff-joined.domain-event.ts
      staff-disabled.domain-event.ts
      staff-enabled.domain-event.ts
      staff-removed.domain-event.ts
      staff-permissions-changed.domain-event.ts
    staff.errors.ts
  database/
    vendor-membership.repository.port.ts
    vendor-membership.repository.ts
    staff-invitation.repository.port.ts
    staff-invitation.repository.ts
    staff.mapper.ts
  commands/
    invite-staff/        { invite-staff.request.dto.ts, invite-staff.service.ts }
    update-staff/        { update-staff.request.dto.ts, update-staff.service.ts }
    remove-staff/        { remove-staff.service.ts }
    accept-invite/       { accept-invite.request.dto.ts, accept-invite.service.ts }
  queries/
    list-staff/          { list-staff.service.ts }
    get-staff/           { get-staff.service.ts }
    get-my-role/         { get-my-role.service.ts }
  ports/
    list-assignment.port.ts   # OQ-1: abstraction over Supply List assignments (stub until US-005)
  adapters/
    list-assignment-stub.adapter.ts
  __tests__/

src/infrastructure/middlewares/
  authorize.ts            # REPLACE existing stub — real RBAC
  rbac/
    role-context.ts       # identifyUserRole(vendorId) loader + RoleContext type
    require-owner.ts       # requireOwnerRole()
    require-permission.ts  # requirePermission(permissionKey)
    permission.service.ts  # canViewSupplyList / canMarkDelivery / canAddExtraCharge etc.

src/common/audit/
  audit-logger.ts         # AuditLogger service (shared, used by all modules)
  audit.port.ts
  audit-action.enum.ts
```

---

## Domain Model

> Full specs in [DOMAIN_MODEL.md](./DOMAIN_MODEL.md). Summary here.

- **Bounded Context:** **Staff & Access** (owns staff membership, invitations, per-staff permission grants, role/permission detection). **Audit** is a thin supporting context (cross-cutting service).

- **Aggregates:**
  1. **VendorMembership** (root: `VendorMembershipEntity`, table `vendor_users`) — owns the staff member's relationship to one vendor: status, role, area label, lifecycle timestamps, **and its permission grants** (`StaffPermission[]` — new table `vendor_staff_permissions`, owned within the aggregate boundary).
  2. **StaffInvitation** (root: `StaffInvitationEntity`, new table `staff_invitations`) — owns the invite token, expiry (7 days), and acceptance lifecycle. References `VendorMembership` by **id only**.

- **Value Objects:**
  - `PermissionKey` — guarded enum of staff-grantable permissions (`mark_deliveries`, `mark_leaves`, `add_extra_charges`).
  - `MembershipStatus` — wraps the `VendorUserStatus` enum + valid transitions.
  - `InviteToken` — opaque CSPRNG token (`crypto.randomBytes`), stored hashed.

- **Domain Events** (extend `DomainEventBase` — id, aggregateId, occurredAt, metadata.correlationId):
  | Event | Triggered when | Consumed by |
  |---|---|---|
  | `StaffInvitedEvent` | owner invites staff | Audit, Notifications (future) |
  | `StaffJoinedEvent` | invitee accepts invite | Audit |
  | `StaffDisabledEvent` | owner disables staff | Audit, Session-revocation handler |
  | `StaffEnabledEvent` | owner re-enables staff | Audit |
  | `StaffRemovedEvent` | owner removes staff | Audit, list-unassignment (future US-005), Session-revocation |
  | `StaffPermissionsChangedEvent` | owner edits grants | Audit |

- **Aggregate Boundaries:**
  - `VendorMembership` **owns** its `StaffPermission` rows (created/updated/deleted in the same transaction as the membership).
  - `VendorMembership` **references** `Vendor`, `User`, `Role` **by id only** (no nested object graph crossing aggregates).
  - `StaffInvitation` **references** the target `VendorMembership` and `Vendor` **by id only**.
  - Supply-list assignments are **not owned here** — accessed through `ListAssignmentPort` (OQ-1).

---

## API Endpoints

Base path: `/api/v1`. All require `authenticateToken`. Owner-only routes add `requireOwnerRole`. Multi-tenant: `:vendorId` is matched against the caller's memberships; wrong tenant → **404 NotFound** (masking), never 403.

| # | Method | Path | CQS | Auth | Permission | Notes |
|---|--------|------|-----|------|-----------|-------|
| 1 | GET | `/vendors/:vendorId/role` | Query | token | membership in vendor | Returns `{ role, vendorId, staffId?, permissions[] }` for frontend role detection. |
| 2 | GET | `/vendors/:vendorId/staff` | Query | token | **owner** | Paginated staff list (query-builder), status, area, assigned-list count (via port; 0 until US-005), today's stats placeholder. |
| 3 | GET | `/vendors/:vendorId/staff/:staffId` | Query | token | **owner** | Single staff detail incl. permissions + assigned lists (via port). |
| 4 | POST | `/vendors/:vendorId/staff/invite` | Command | token | **owner** | Creates `VendorMembership(status=INVITED)` + default permission grants + `StaffInvitation` token. Returns invite URL. 201. |
| 5 | PATCH | `/vendors/:vendorId/staff/:staffId` | Command | token | **owner** | Update status (active/disabled), `areaRouteLabel`, permission grants. Partial. |
| 6 | DELETE | `/vendors/:vendorId/staff/:staffId` | Command | token | **owner** | Soft-remove (status=REMOVED, `deletedAt`). Emits unassign event. 200 (returns removed summary) — see OQ-3. |
| 7 | POST | `/auth/accept-invite` | Command | **public** | invite token | Body: `{ token, password, name? }`. Creates/links user, sets membership ACTIVE, returns JWT (auto-login). Lives in **auth** router but implemented by staff `AcceptInviteService`. See OQ-4. |

> **Not in this US:** `/auth/signup` and `/auth/login` already exist (US-003). This US **augments login's response** to include role+permissions per vendor (already partially present via `VendorContextDto.role`) and **augments the JWT** — see OQ-2.

### Request/Response Zod patterns
- Mutations (4, 5, 7): `.strict()` schemas — must declare **every** field the controller reads (memory rule on `.strict()`).
- Query list (2): `.passthrough()` to feed the dynamic query-builder.
- Enums (`status`, `permissionKey`, `subscriptionTier`): `z.nativeEnum()` over Prisma enums.
- Permissions input: `z.array(z.nativeEnum(PermissionKey))` or a `Record<PermissionKey, boolean>` grant map (see `validation-schemas.md`).

### Error response shape (all errors)
```json
{ "success": false, "error": { "code": "FORBIDDEN", "message": "..." }, "correlationId": "<uuid>" }
```
`correlationId` is mandatory on **every** error path including 404/notFound (memory rule).

---

## Data Model Changes

> Reconciliation note: the US-002 SQL uses **integer ids + snake_case tables**. The existing Prisma schema uses **`BigInt @id @default(autoincrement())` + camelCase fields with `@map` snake_case columns**. We follow the **existing schema conventions**, not the raw SQL. `users`, `vendors`, `audit_logs`, `vendor_users` (= the story's `vendor_staff`), `roles`, `permissions`, `role_permissions` **already exist** — we design **deltas only**.

### NEW model: `StaffPermission` (per-staff permission grant) — table `vendor_staff_permissions`
The story's `staff_permissions` table. Existing `Permission`/`RolePermission` are **role-level catalog** definitions; this is the **per-membership override grant** the story requires for individual staff.

```prisma
model StaffPermission {
  id BigInt @id @default(autoincrement())

  vendorUserId  BigInt  @map("vendor_user_id")
  permissionKey String  @map("permission_key") @db.VarChar(50) // 'mark_deliveries' | 'mark_leaves' | 'add_extra_charges'
  granted       Boolean @default(true)

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  vendorUser VendorUser @relation(fields: [vendorUserId], references: [id], onDelete: Cascade)

  @@unique([vendorUserId, permissionKey])
  @@index([vendorUserId])
  @@map("vendor_staff_permissions")
}
```
- **Aggregate boundary:** owned by `VendorMembership` (the `VendorUser` root). `onDelete: Cascade`.
- Add reverse relation on `VendorUser`: `staffPermissions StaffPermission[]`.

### NEW model: `StaffInvitation` — table `staff_invitations`
No invite-token table exists today; `VendorUser.invitedAt` records the timestamp but there is no token. Required for the 7-day-expiry invite link + accept flow.

```prisma
enum StaffInvitationStatus {
  PENDING
  ACCEPTED
  EXPIRED
  REVOKED
  @@map("staff_invitation_status")
}

model StaffInvitation {
  id BigInt @id @default(autoincrement())

  vendorId     BigInt @map("vendor_id")
  vendorUserId BigInt @map("vendor_user_id") // the INVITED membership this token activates
  invitedByUserId BigInt @map("invited_by_user_id")

  phone     String  @db.VarChar(15)
  tokenHash String  @unique @map("token_hash") @db.VarChar(255) // sha256 of CSPRNG token; raw token only in the link
  status    StaffInvitationStatus @default(PENDING)

  expiresAt  DateTime  @map("expires_at")
  acceptedAt DateTime? @map("accepted_at")
  revokedAt  DateTime? @map("revoked_at")

  createdAt DateTime  @default(now()) @map("created_at")
  updatedAt DateTime  @updatedAt @map("updated_at")

  vendor     Vendor     @relation(fields: [vendorId], references: [id], onDelete: Cascade)
  vendorUser VendorUser @relation(fields: [vendorUserId], references: [id], onDelete: Cascade)

  @@index([vendorId])
  @@index([vendorUserId])
  @@index([tokenHash])
  @@index([expiresAt])
  @@index([status])
  @@map("staff_invitations")
}
```
- Add reverse relations: `Vendor.staffInvitations`, `VendorUser.invitations`.
- Add `Vendor` ↔ owner relation: store the owner as a `VendorUser` with the `owner` role (the story's `owner_user_id` is represented by an OWNER-role membership — no schema change needed; confirm via OQ-5).

### Existing `AuditLog` — REUSE AS-IS
Already has `vendorId`, `performedByUserId`, `performedByRole`, `action`, `entityType`, `entityId`, `metadata` (JSONB), `ipAddress`, `userAgent`, and indexes on `vendorId`/`createdAt`/`action`/`entityType`. No change. Used by the new `AuditLogger` service.

### Mandatory indexes (per `prisma-schema-design.md`)
- `StaffPermission`: `vendorUserId` (FK), unique `(vendorUserId, permissionKey)`. (No `deletedAt` — hard-deleted with parent.)
- `StaffInvitation`: `vendorId`, `vendorUserId`, `tokenHash`, `expiresAt`, `status`.
- `VendorUser` already indexed on `vendorId`, `userId`, `roleId`, `status`, `deletedAt`. **Add** composite `@@index([vendorId, status])` for the staff-list query (filter by vendor + active/disabled).

### Seed data plan (`prisma/seeds/`, idempotent — upsert, memory rule)
- **Roles:** upsert `owner` and `staff` into `roles`.
- **Permissions catalog:** upsert the staff-grantable `resource:action` entries used by RBAC:
  `delivery:mark` (mark_deliveries), `leave:mark` (mark_leaves), `charge:add` (add_extra_charges),
  plus owner-exclusive markers: `list:create`, `list:edit`, `payment:mark`, `price:edit`, `staff:invite`, `subscription:manage`, `revenue:view`.
- **RolePermission:** map `owner` → all; `staff` → none by default (staff permissions come from `StaffPermission` grants, not role).
- **Dev data (faker):** 1 owner + 2–3 staff memberships with varied statuses + sample permission grants + one PENDING invitation.

---

## Business Rules

### Invariants (enforced in entity `validate()`)
**VendorMembership:**
1. A membership's `status` must be one of the enum values.
2. `roleId` must reference a known role; an OWNER membership cannot be DISABLED or REMOVED (OQ-6 — the owner cannot disable themselves; story edge case #3).
3. `(vendorId, userId)` is unique (DB-enforced; surfaced as `ConflictError`).
4. Permission grants may only contain valid `PermissionKey`s, and grants are only meaningful for STAFF role (owner is all-allow; grants on owner are ignored).
5. `areaRouteLabel` ≤ 200 chars.

**StaffInvitation:**
1. `expiresAt = createdAt + 7 days` at creation (story security req).
2. Accept only allowed when `status = PENDING` and `now < expiresAt`; else `ExpiredInviteError` / `InvalidInviteError`.
3. On accept → transitions to ACCEPTED, sets membership ACTIVE + `joinedAt`, single-use (token invalidated).
4. Re-inviting an existing **active** staff phone → `ConflictError` "This phone number is already a staff member" (story edge case #4).

### State machine — `MembershipStatus`
```
INVITED  --accept-->  ACTIVE
ACTIVE   --disable--> DISABLED
DISABLED --enable-->  ACTIVE
ACTIVE/DISABLED --remove--> REMOVED   (terminal)
```
Invalid transitions → `InvalidStatusTransitionError` (422). REMOVED is terminal. INVITED can also go REVOKED via invitation, not membership.

### Multi-tenant isolation rules
- Every staff query/command is scoped by `:vendorId`. The caller must hold a membership in that vendor.
- A `:staffId` that exists but belongs to **another vendor** → **404 NotFound** (mask existence), never 403.
- `vendorId` is derived from the route **and validated against the JWT `vendorIds[]`**; never trust a body-supplied vendorId.

### Cross-aggregate / cross-module rules
- Removing staff must trigger list unassignment — emitted as `StaffRemovedEvent` and handled by US-005 later (today: logged + no-op via port).
- Disabling staff must invalidate active sessions — emitted as `StaffDisabledEvent`; handler revokes `UserSession` rows for that user (story edge case #6 "logout on next API call"); the `identifyUserRole` middleware also re-checks `status=ACTIVE` on every request, so a disabled staff is blocked on the next call regardless.

---

## Sequence Diagrams (text-based)

### Invite staff (Command)
```
Owner → POST /vendors/:vendorId/staff/invite (token, validate strict)
  controller → derive performedBy=req.user.userId; assert vendorId ∈ req.user.vendorIds (else 404)
  → InviteStaffService.execute(cmd)
     → assert caller is OWNER of vendor (requireOwnerRole already ran)
     → check subscription staff-limit via port (OQ-7) → 451 if exceeded
     → membershipRepo.findByVendorAndPhone → if ACTIVE exists → ConflictError
     → BEGIN TX
        VendorMembershipEntity.createInvited(props) → validate()  [toPersistence → vendor_users]
        StaffPermission grants from default+requested  [owned by aggregate]
        StaffInvitationEntity.create(7d expiry, CSPRNG token) → validate()  [toPersistence → staff_invitations, store tokenHash]
     → COMMIT
     → entity.emit StaffInvitedEvent(correlationId)
     → AuditLogger.log(action=STAFF_INVITED, entityType='staff', entityId=membershipId, metadata, userId, vendorId)
     → (future) Notifications consume StaffInvitedEvent for WhatsApp/SMS
  → mapper.toResponse → { staff, inviteUrl } → sendCreated (201)
```

### Accept invite (Command, public)
```
Invitee → POST /auth/accept-invite { token, password, name? }
  → AcceptInviteService.execute(cmd)
     → hash(token) → invitationRepo.findByTokenHash
     → guard: status=PENDING && now<expiresAt  (else Expired/Invalid)
     → BEGIN TX
        upsert User by phone (set passwordHash via passwordUtil, name)
        membership.activate() → status ACTIVE, joinedAt=now  [state transition validate]
        invitation.accept() → status ACCEPTED, acceptedAt=now, single-use
        create UserSession
     → COMMIT
     → emit StaffJoinedEvent; AuditLogger.log(STAFF_JOINED)
     → generate JWT (userId, phone, vendorIds incl. new vendor, + role/permissions per OQ-2)
  → { user, tokens, vendorContexts } (auto-login)
```

### Permission enforcement on a downstream action (Query/Command, e.g. mark delivery — US-005/006)
```
Request → authenticateToken → identifyUserRole(:vendorId) attaches req.roleContext
  → requirePermission('mark_deliveries')
     → if roleContext.role === OWNER → allow
     → else PermissionService.canMarkDelivery(userId, listId)
            = grant 'mark_deliveries' present AND ListAssignmentPort.isAssigned(staffId, listId)
            (port returns true-stub until US-005 — OQ-1)
  → controller
```

---

## Strategy / Port Interfaces

### `ListAssignmentPort` (OQ-1 — decouples from unbuilt US-005)
```ts
export interface ListAssignmentPort {
  countAssignedLists(staffMembershipId: bigint): Promise<number>;
  getAssignedListIds(staffMembershipId: bigint): Promise<bigint[]>;
  isAssignedToList(staffMembershipId: bigint, listId: bigint): Promise<boolean>;
  isCustomerInAssignedList(staffMembershipId: bigint, customerId: bigint): Promise<boolean>;
  unassignAll(staffMembershipId: bigint): Promise<void>; // on remove
}
```
- **Stub adapter** (this US): `countAssignedLists → 0`, `getAssignedListIds → []`, `isAssignedToList`/`isCustomerInAssignedList → see OQ-1 (recommend `false` fail-closed), `unassignAll → no-op + log`.
- **Real adapter** lands in US-005, swapped in the composition root only.

### `SubscriptionLimitPort` (OQ-7 — staff cap, US-009 not built)
```ts
export interface SubscriptionLimitPort {
  getStaffLimit(vendorId: bigint): Promise<number | null>; // null = unlimited
  getCurrentStaffCount(vendorId: bigint): Promise<number>;
}
```
- **Stub:** `getStaffLimit → null` (unlimited) until US-009. Invite throws `451` (`SubscriptionLimitError`) when limit exceeded.

### `AuditLogger` (shared service, this US)
```ts
export interface AuditPort {
  log(input: {
    vendorId: bigint; performedByUserId: bigint | null; performedByRole?: string;
    action: AuditAction; entityType?: string; entityId?: bigint | null;
    metadata?: Record<string, unknown>; ipAddress?: string | null; userAgent?: string | null;
  }): Promise<void>;
}
```
- Implementation writes to `audit_logs`. Never throws into the request path — log-and-swallow on failure (must not break the business operation), but emits a `warn` with correlationId.

---

## Error Handling Strategy

| Domain operation | Failure | Error class | HTTP |
|---|---|---|---|
| Any auth-required route w/o valid token | — | `UnauthorizedError` | 401 |
| Owner-only route by staff | — | `ForbiddenError` ("This action requires owner privileges") | 403 |
| Staff missing permission | — | `ForbiddenError` | 403 |
| `:vendorId` not in caller memberships | — | `NotFoundError` (mask) | 404 |
| `:staffId` in another vendor | — | `NotFoundError` (mask) | 404 |
| Invite existing active staff | dup | `ConflictError` ("already a staff member") | 409 |
| `(vendorId, userId)` unique violation | P2002 | `ConflictError` | 409 |
| Invalid status transition | — | `InvalidStatusTransitionError extends UnprocessableEntityError` | 422 |
| Owner removes/disables self | — | `ForbiddenError` ("Cannot remove yourself as owner") | 403 |
| Invite token unknown/used | — | `InvalidInviteError extends BadRequestError`/`NotFoundError` | 400/404 (OQ-4) |
| Invite token expired | — | `ExpiredInviteError extends UnprocessableEntityError` | 422 |
| Subscription staff limit reached | — | `SubscriptionLimitError extends AppError(451)` | 451 |
| Invalid permission key | — | `ValidationError` (Zod) | 400 |

- New error classes live in `src/modules/staff/domain/staff.errors.ts`, extending the shared `AppError` family in `src/common/errors/app-error.ts`.
- **451** is non-standard; add a `SubscriptionLimitError` extending `AppError` with `statusCode 451`, `code 'SUBSCRIPTION_LIMIT'` (story specifies 451).
- Prisma `P2002` mapped to `ConflictError` in the adapter (per `repository-implementation.md`).
- Every error response carries `correlationId` (memory rule).

## Security Considerations
- All role/permission checks are **server-side only** (story: never trust frontend).
- Invite tokens: CSPRNG `crypto.randomBytes(32)` (memory rule — never `Math.random`); store **sha256 hash** only; raw token appears solely in the returned link; 7-day expiry; single-use.
- `vendorId` always taken from route + verified against JWT `vendorIds[]`; never from body.
- Rate-limit `/auth/accept-invite` (reuse the auth rate-limiter pattern) and `/staff/invite` (per-owner).
- Disabled/removed staff blocked on next request (status re-checked in `identifyUserRole`) and sessions revoked via event handler.
- Password on accept: min 8 chars (story), hashed via existing `passwordUtil` (bcrypt).

## Performance Considerations
- Staff list: paginate via existing query-builder; composite `@@index([vendorId, status])`.
- `identifyUserRole` runs on most authenticated requests — single indexed lookup on `vendor_users (vendorId, userId)` + a permission-grants fetch; consider request-scoped memoization (cache the RoleContext on `req`). JWT-embedded permissions (OQ-2) can avoid the per-request DB hit entirely.
- Audit writes are fire-and-forget relative to correctness but **must** complete in the same request (no queue in v1); they are single indexed inserts.
- `audit_logs` already indexed on `vendorId` + `createdAt` (story perf note satisfied).

---

## Open Questions (recommendation + trade-off — do NOT silently assume)

> **RESOLVED 2026-06-08 (user decisions):**
> - **OQ-1 → Build now, fail-closed stub.** Ship RBAC + staff management + audit logging now; all list-scoped checks sit behind `ListAssignmentPort` whose stub returns `false`/`0`/`[]` (staff denied) until US-005 swaps in the real adapter. Owners always-allow.
> - **OQ-2 → Embed in JWT + re-validate status.** Access token carries `vendors: [{ vendorId, role, permissions[] }]`; `identifyUserRole` reads the token but always re-checks `status=ACTIVE` against the DB. Permission staleness bounded by the 15m access-token TTL. Updates `LoginService` + `RefreshTokenService` payloads.
> - **OQ-5 → OWNER-role membership, no column.** Owner is a `VendorUser` row with the `owner` role; no `Vendor.ownerUserId` column is added. "Is owner" is a role lookup.
>
> **Remaining OQs accepted as recommended:** OQ-3 (soft-remove + 200), OQ-4 (`POST /auth/accept-invite`, 404 unknown/used, 422 expired), OQ-6 (owner self-guard in service), OQ-7 (`SubscriptionLimitPort` unlimited stub), OQ-8 (re-invite reactivates REMOVED membership), OQ-9 (defer delivery stats — `todayStats` placeholder).

### OQ-1 — Dependency ordering: list-scoped permission checks before US-005 exists *(RESOLVED — build now, fail-closed stub)*
US-002's `canViewSupplyList`, `canMarkDelivery`, `canAddExtraCharge`, assigned-list counts, and `unassignAll` all depend on Supply Lists (US-005, not built).
- **Recommendation:** Build the **RBAC framework + staff management + audit logging now**, and place all list-scoped logic behind a `ListAssignmentPort` with a **stub adapter**. The stub returns `0`/`[]` for counts and **`false` (fail-closed)** for `isAssignedToList`/`isCustomerInAssignedList`, and no-op for `unassignAll`. Owners are unaffected (always-allow). The real adapter ships with US-005 and is swapped in the composition root only — zero changes to the staff module.
- **Trade-off:** Fail-closed means a *staff* member cannot mark deliveries until US-005 lands (correct security posture, but staff-side delivery e2e can't be exercised yet). The alternative — fail-open stub — would let staff bypass list scoping and is a security risk, so it is rejected. Owner flows and all staff-management flows are fully testable now.

### OQ-2 — JWT payload shape for role/permissions *(RESOLVED — embed + re-validate status)*
Current JWT = `{ userId, phone, vendorIds[] }`. The story wants role + permissions in the token to avoid extra calls.
- **Recommendation:** Extend the access-token payload to `vendors: [{ vendorId, role, permissions[] }]` (replacing the flat `vendorIds[]`, or adding alongside it for one release for back-compat). Keep it small; permissions are only the 3 staff grants. Role detection middleware reads from the token first, DB only as fallback/refresh.
- **Trade-off:** Embedding permissions means a permissions change isn't reflected until token refresh (≤ access-token TTL, 15m). Story edge case #2 ("permissions changed, please refresh") explicitly accepts this. Alternative — always hit the DB in `identifyUserRole` — is always-fresh but adds a query per request. **Recommend:** embed in JWT **and** have `identifyUserRole` re-validate `status=ACTIVE` from DB (cheap, indexed) so disabled staff are blocked immediately while permission staleness is bounded by token TTL. Changing the payload also touches the existing `LoginService` and `RefreshTokenService` — flagging the back-compat impact (memory: "reload user context for new access token").

### OQ-3 — DELETE staff response & hard vs soft delete
- **Recommendation:** **Soft-remove** (status=REMOVED + `deletedAt`), return **200** with a removed-summary body (so the client can confirm) rather than 204. Preserves audit history and the `(vendorId,userId)` uniqueness intent (a removed member can be re-invited — see OQ-8).
- **Trade-off:** Soft delete keeps the unique `(vendorId, userId)` row, which **blocks re-invite** unless we exclude REMOVED from the uniqueness/lookup. Recommend the re-invite check ignores REMOVED rows and reactivates instead (OQ-8). Hard delete avoids this but loses history and breaks the FK from `audit_logs`/`staff_invitations`.

### OQ-4 — Accept-invite endpoint placement & error codes
- **Recommendation:** Expose as `POST /api/v1/auth/accept-invite` (public, in the **auth** router for discoverability and rate-limiter reuse), implemented by the staff module's `AcceptInviteService` (composition root wires it). Unknown/used token → **404** (don't reveal token validity); expired → **422**.
- **Trade-off:** Splitting routing (auth) from implementation (staff) is slightly less cohesive but matches the existing auth router ownership of public auth flows and avoids duplicating rate-limiter setup. Alternative `/vendors/:vendorId/staff/accept` leaks vendorId into a public URL — rejected.

### OQ-5 — Owner representation: `Vendor.ownerUserId` column vs OWNER-role membership *(RESOLVED — OWNER-role membership, no column)*
The story models `vendors.owner_user_id`. The existing schema has **no** such column; ownership is currently implied by a `VendorUser` with an owner role.
- **Recommendation:** Represent the owner as a `VendorUser` row with the `owner` role (no schema change), which `identifyUserRole` already detects via the role name. This keeps a single membership table and consistent multi-tenant scoping.
- **Trade-off:** Without a denormalized `ownerUserId`, "is this the owner" is a role lookup, not a column compare; the "cannot remove yourself as owner" check becomes "cannot remove a membership whose role is owner == self". Acceptable. If a later US needs a guaranteed single-owner FK, add `Vendor.ownerUserId BigInt? @unique` then. **Decision needed** so Dev knows whether to add the column.

### OQ-6 — "Owner cannot remove/disable themselves" enforcement point
- **Recommendation:** Enforce in the `RemoveStaffService`/`UpdateStaffService` as a domain guard: if target membership role is `owner` (or target userId === caller userId and caller is owner) → `ForbiddenError`. Owners are managed via account/vendor flows, not the staff endpoints.
- **Trade-off:** Means the staff endpoints can never act on an owner membership at all (simpler, safer). If co-owners are ever needed, this needs revisiting.

### OQ-7 — Subscription staff-limit (451) before US-009 exists
- **Recommendation:** Gate invite behind `SubscriptionLimitPort`; ship a **stub returning unlimited** (`getStaffLimit → null`) so invites always pass in v1, but the 451 plumbing + error class exist and are unit-tested with a mocked port. US-009 supplies the real adapter.
- **Trade-off:** No real enforcement until US-009 (acceptable — the cap isn't defined yet), but the contract and error path are ready, so US-009 is a drop-in.

### OQ-8 — Re-inviting a previously REMOVED staff member
- **Recommendation:** On invite, if a membership exists with status REMOVED for `(vendorId, userId/phone)`, **reactivate it** (new invitation, status → INVITED) rather than erroring on the unique constraint.
- **Trade-off:** Slightly more complex invite logic, but matches real owner behaviour (re-hiring). Erroring would force manual DB intervention. Tie this to OQ-3's soft-delete decision.

### OQ-9 — "Today's delivery stats" in staff list (item 2 / story line 135)
- **Recommendation:** Defer — return `todayStats: null`/`0` placeholders behind the same port boundary (delivery data is US-006). Do not block US-002.
- **Trade-off:** Staff-list cards show zeroed stats until US-006; acceptable for this slice.
