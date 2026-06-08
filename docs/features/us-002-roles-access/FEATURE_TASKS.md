# Feature Tasks: US-002 — Roles & Access Control

## Complexity: **Complex** — Skills to follow per stream below

> Each **Phase** starts only after all streams in the prior phase complete.
> Streams within a phase own **non-overlapping files** and run simultaneously.
> Agent count per phase chosen to match independent file groups (no two streams in a phase write the same file).

---

## Phase 1 (parallel — no cross-stream dependencies)

### Stream A: Data Foundation
**Files owned:** `prisma/schema.prisma`, `prisma/migrations/`, `prisma/seeds/index.ts` (+ seed helpers)
**Skills:** `prisma-schema-design.md`
- **A1** — Add `StaffPermission` model (table `vendor_staff_permissions`), unique `(vendorUserId, permissionKey)`, FK index, `onDelete: Cascade`; add reverse relation `staffPermissions` on `VendorUser`. Aggregate boundary: owned by VendorMembership.
- **A2** — Add `StaffInvitation` model + `StaffInvitationStatus` enum; indexes on `vendorId`, `vendorUserId`, `tokenHash` (unique), `expiresAt`, `status`; reverse relations on `Vendor` and `VendorUser`.
- **A3** — Add composite `@@index([vendorId, status])` to `VendorUser`. Per OQ-5 decision: add `Vendor.ownerUserId BigInt? @unique` **only if** OQ-5 says so (default: do NOT add — owner via role).
- **A4** — Migration (`migrate:create`), verify `db:generate`.
- **A5** — Seed (idempotent / upsert — memory rule): roles `owner`+`staff`; permission catalog entries (`delivery:mark`, `leave:mark`, `charge:add`, owner-exclusive markers); `owner→all`, `staff→none` RolePermission maps; faker dev data (owner + 2–3 staff w/ varied status + grants + 1 PENDING invitation).

### Stream B: Domain Core
**Files owned:** `src/modules/staff/domain/**`, `src/modules/staff/staff.types.ts`
**Skills:** `domain-modeling.md`
- **B1** — `VendorMembershipEntity` (factories `createInvited`/`createOwner`/`reconstitute`, all calling `validate()`; transitions `activate`/`disable`/`enable`/`remove`/`updateArea`/`setPermissions`; `getProps()` → `Object.freeze`; owner-guard invariants).
- **B2** — `StaffInvitationEntity` (create with 7d expiry + token hash, `accept`/`revoke`/`isUsable`, validate).
- **B3** — Value objects: `PermissionKey`, `MembershipStatus` (state machine), `InviteToken` (CSPRNG + sha256 — memory rule).
- **B4** — Domain events (all extend `DomainEventBase`): Invited/Joined/Disabled/Enabled/Removed/PermissionsChanged.
- **B5** — `staff.errors.ts`: `InvalidStatusTransitionError(422)`, `InvalidInviteError`, `ExpiredInviteError(422)`, `SubscriptionLimitError(451)`.
- **B6** — `staff.types.ts`: DTOs incl. `StaffResponseDto`, `RoleContextDto`, `PermissionGrant` (whitelist shapes from DOMAIN_MODEL).

### Stream C: Validation Layer
**Files owned:** `src/modules/staff/staff.validator.ts`
**Skills:** `validation-schemas.md`
- **C1** — Zod schemas: `inviteStaffSchema` (`.strict()`, declares phone/name?/areaRouteLabel?/permissions[]/sendVia? — memory rule on strict), `updateStaffSchema` (`.strict()`, partial: status?/areaRouteLabel?/permissions?), `acceptInviteSchema` (`.strict()`: token/password(min8)/name?), `listStaffQuerySchema` (`.passthrough()` for query-builder), `vendorIdParam`/`staffIdParam`. Use `z.nativeEnum()` for `VendorUserStatus` and `PermissionKey`.

### Stream D: Audit Service (shared, no module deps)
**Files owned:** `src/common/audit/**`
**Skills:** `service-implementation.md`, `error-handling.md`
- **D1** — `audit-action.enum.ts` (STAFF_INVITED, STAFF_JOINED, STAFF_DISABLED, STAFF_ENABLED, STAFF_REMOVED, STAFF_PERMISSIONS_CHANGED, + placeholders for list/delivery/payment used by later US).
- **D2** — `audit.port.ts` (`AuditPort`) and `audit-logger.ts` (writes `audit_logs`; log-and-swallow on failure with `warn` + correlationId; never throws into request path).

---

## Phase 2 (parallel — after Phase 1)

### Stream E: Data Access Layer
**Files owned:** `src/modules/staff/database/**`
**Skills:** `repository-implementation.md`
**Depends on:** A (schema), B (domain types)
- **E1** — `vendor-membership.repository.port.ts` + `.repository.ts` (Prisma adapter): soft-delete filters (exclude `deletedAt`/REMOVED in active lookups), `insertWithPermissions`/`replacePermissions` in a tx, P2002→`ConflictError`, focused updates, `listByVendor` via query-builder + composite index.
- **E2** — `staff-invitation.repository.port.ts` + `.repository.ts`: `findByTokenHash`, `findPendingByMembership`, status updates.
- **E3** — `database/staff.mapper.ts`: `toDomain`/`toPersistence`/`toResponse` (+ `invitationToResponse`), BigInt→string, field whitelist, never leak `tokenHash`/`passwordHash`.

### Stream F: Ports & Stub Adapters
**Files owned:** `src/modules/staff/ports/**`, `src/modules/staff/adapters/**`
**Skills:** `service-implementation.md`
**Depends on:** B (types)
- **F1** — `list-assignment.port.ts` + `list-assignment-stub.adapter.ts` (OQ-1: counts→0, ids→[], isAssigned→**false** fail-closed, unassignAll→no-op+log).
- **F2** — `subscription-limit.port.ts` + stub adapter (OQ-7: limit→null unlimited, current count from membership repo).

### Stream G: Application Layer — Commands & Queries
**Files owned:** `src/modules/staff/commands/**`, `src/modules/staff/queries/**`
**Skills:** `service-implementation.md`, `error-handling.md`
**Depends on:** B types, ports (defined in DOMAIN_MODEL before Phase 2), D (AuditPort)
- **G1** — `InviteStaffService` (subscription-limit check→451, dup active staff→409, REMOVED reactivation per OQ-8, tx create membership+grants+invitation, emit `StaffInvitedEvent`, audit, return inviteUrl).
- **G2** — `UpdateStaffService` (status transition via MembershipStatus, owner-self guard OQ-6, replace permissions, emit events, audit).
- **G3** — `RemoveStaffService` (owner-self guard, soft-remove, emit `StaffRemovedEvent`, `listAssignmentPort.unassignAll`, audit).
- **G4** — `AcceptInviteService` (hash token, guard usable, tx: upsert user+activate membership+accept invitation+session, emit `StaffJoinedEvent`, audit, issue JWT per OQ-2).
- **G5** — Queries: `ListStaffService`, `GetStaffService`, `GetMyRoleService` (CQS: read-only, no events). Enrich with port counts.

---

## Phase 3 (parallel — after Phase 2)

### Stream H: RBAC Middleware (infrastructure)
**Files owned:** `src/infrastructure/middlewares/authorize.ts` (REPLACE stub), `src/infrastructure/middlewares/rbac/**`
**Skills:** `service-implementation.md`, `error-handling.md`
**Depends on:** E (membership repo), G (permission service deps)
- **H1** — `rbac/role-context.ts`: `identifyUserRole(vendorId)` — resolve `{role, vendorId, staffId?, permissions[]}` (JWT-first per OQ-2, DB re-check `status=ACTIVE`); attach `req.roleContext`; wrong-tenant → 404 mask.
- **H2** — `rbac/require-owner.ts` (`requireOwnerRole` → 403 "requires owner privileges") and `rbac/require-permission.ts` (`requirePermission(key)` → owner allow, else grant+port check).
- **H3** — `rbac/permission.service.ts`: `canViewSupplyList`/`canEditSupplyList`/`canMarkDelivery`/`canAddExtraCharge`/`canMarkPayment` using grants + `ListAssignmentPort` (OQ-1 fail-closed for staff).
- **H4** — Replace `authorize.ts` stub to delegate to the real permission service (keep signature back-compatible for existing callers — back-compat rule).

### Stream I: Interface Layer
**Files owned:** `src/modules/staff/staff.controller.ts`, `src/modules/staff/staff.routes.ts`, `src/app.ts`, accept-invite wiring in `src/modules/auth/auth.routes.ts`
**Skills:** `module-scaffold.md` (Steps 5–9), `api-contract-design.md`
**Depends on:** C (validators), G (services), H (middleware)
- **I1** — `staff.controller.ts` (arrow fns, try/catch→`next(error)`, vendorId from route validated vs JWT, performedBy from `req.user`).
- **I2** — `staff.routes.ts` composition root: wire repos/ports/services/controller; middleware chain `authenticateToken → identifyUserRole → requireOwnerRole/requirePermission → validate → controller`; rate-limiters for invite. Endpoints 1–6.
- **I3** — Register `/api/v1/vendors/:vendorId/staff` + `/role` in `app.ts`; add `POST /auth/accept-invite` to `auth.routes.ts` wired to staff `AcceptInviteService` (OQ-4); Swagger annotations for all endpoints.
- **I4** — Augment `LoginService`/`RefreshTokenService` JWT payload per OQ-2 (role+permissions) **only if OQ-2 approved** — flag back-compat (memory: reload user context on refresh).

### Stream J: Event Handlers (cross-module effects)
**Files owned:** `src/modules/staff/handlers/**` (+ wiring)
**Skills:** `service-implementation.md`
**Depends on:** B (events), auth session repo
- **J1** — `StaffDisabledEvent`/`StaffRemovedEvent` → revoke `UserSession` rows for that user (story edge cases #1/#6).
- **J2** — All staff events → `AuditLogger.log()` (if not already done inline in services; keep one path — decide in G to avoid double-logging).

### Stream K: Tests
**Files owned:** `src/modules/staff/__tests__/**`, `src/infrastructure/middlewares/rbac/__tests__/**`, `tests/integration/staff.test.ts`
**Skills:** `testing-strategy.md`
**Depends on:** all prior streams. **No placeholder tests — real cases only (memory rule).**
- **K1** — Unit: entity factories+invariants+transitions, VOs (`InviteToken` CSPRNG, `MembershipStatus` machine), mapper whitelist (no token/hash leak).
- **K2** — Unit: services with mocked ports/repos (invite dup→409, limit→451, accept expired→422, owner-self→403, REMOVED reactivation).
- **K3** — Unit: RBAC middleware/permission service (owner allow-all, staff grant+assignment fail-closed, wrong-tenant→404).
- **K4** — Integration: full HTTP lifecycle, correlationId on all errors (incl. 404), owner CRUD staff, staff blocked on owner-only routes, invite→accept→auto-login, multi-tenant isolation (vendor A cannot touch vendor B's staffId → 404).

---

## Scaling note
Phase 1 = 4 agents (A/B/C/D — disjoint files). Phase 2 = 3 agents (E / F / G). Phase 3 = 4 agents (H / I / J / K). No two streams in a phase share a file. Stream G defines the canonical audit-emission path so J doesn't double-log.
