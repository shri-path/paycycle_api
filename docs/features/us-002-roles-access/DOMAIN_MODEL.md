# Domain Model: US-002 — Staff & Access

> Bounded Context: **Staff & Access**. Framework-free domain layer. Entities follow the
> `auth` module patterns: private constructor, `create()`/`reconstitute()` both call
> `validate()`, `getProps()` returns `Object.freeze(...)` (memory rules).

---

## Context Map

### Owned Concepts
- **VendorMembership** — a user's relationship to one vendor (role, status, area, permission grants).
- **StaffInvitation** — a time-boxed, single-use token that activates an INVITED membership.
- **StaffPermission** — a per-membership grant of a staff-grantable capability.
- **RoleContext** — the resolved `{ role, vendorId, staffId?, permissions[] }` for a request.

### Boundaries
- This module OWNS: staff membership lifecycle, invitations, per-staff permission grants, role/permission resolution, the `AuditLogger` service contract.
- This module DOES NOT OWN: `User` identity (auth), `Vendor` profile (vendor module), `Role`/`Permission` catalog (seeded RBAC reference), Supply Lists / assignments (US-005), delivery stats (US-006), subscription tiers (US-009).
- Module internals are PRIVATE — other modules interact via JWT claims, the `AuditPort`, and emitted domain events.

### Relationships
| Related Context | Direction | Pattern | Communication | Shared Data |
|---|---|---|---|---|
| Auth | Upstream | Conformist | JWT claims, shared `passwordUtil`/`jwtUtil` | userId, phone, vendorIds |
| Vendor | Upstream | Conformist | id reference | vendorId |
| Supply Lists (US-005) | Downstream | ACL via `ListAssignmentPort` | port (stub now) | staffMembershipId, listId |
| Subscription (US-009) | Upstream | ACL via `SubscriptionLimitPort` | port (stub now) | vendorId, staffLimit |
| Audit | Downstream | Open Host (service) | `AuditPort.log()` | full action context |
| Notifications (future) | Downstream | Events | `StaffInvitedEvent` etc. | phone, inviteUrl |

---

## Aggregate 1 — VendorMembership

- **Root Entity:** `VendorMembershipEntity` (table `vendor_users`)
- **Owned (within boundary):** `StaffPermission[]` (table `vendor_staff_permissions`)
- **Value Objects:** `MembershipStatus`, `PermissionKey`
- **References by ID only:** `vendorId`, `userId`, `roleId`

### Props
```ts
interface VendorMembershipProps {
  vendorId: bigint;
  userId: bigint;
  roleId: bigint;            // owner | staff role
  status: VendorUserStatus;  // INVITED | ACTIVE | DISABLED | REMOVED  (Prisma enum)
  phone: string | null;
  areaRouteLabel: string | null;
  permissions: PermissionGrant[]; // { key: PermissionKey; granted: boolean }
  invitedAt: Date | null;
  joinedAt: Date | null;
  disabledAt: Date | null;
  removedAt: Date | null;
  deletedAt: Date | null;
}
```

### Factory methods
- `static createInvited(props): VendorMembershipEntity` — new staff in INVITED, sets `invitedAt=now`, applies default + requested permission grants; calls `validate()`.
- `static createOwner(props): VendorMembershipEntity` — owner membership, role=owner, status=ACTIVE, no grants needed (all-allow).
- `static reconstitute(data): VendorMembershipEntity` — from DB; **calls `validate()`** (memory rule).

### Behaviour (state transitions — each validates then emits an event)
- `activate(correlationId)` — INVITED→ACTIVE, `joinedAt=now`; emits `StaffJoinedEvent`. Invalid from REMOVED.
- `disable(correlationId)` — ACTIVE→DISABLED, `disabledAt=now`; emits `StaffDisabledEvent`. Guard: cannot disable an OWNER membership.
- `enable(correlationId)` — DISABLED→ACTIVE; emits `StaffEnabledEvent`.
- `remove(correlationId)` — ACTIVE/DISABLED→REMOVED, `removedAt=now`, `deletedAt=now`; emits `StaffRemovedEvent`. Guard: cannot remove an OWNER membership.
- `updateArea(label)` — sets `areaRouteLabel` (≤200 chars).
- `setPermissions(grants, correlationId)` — replaces grants (STAFF only); emits `StaffPermissionsChangedEvent`.

### Invariants (`validate()`)
1. `status ∈ VendorUserStatus`.
2. Owner membership status must be ACTIVE (never DISABLED/REMOVED via staff flows) — see FEATURE_PLAN OQ-6.
3. All `permissions[].key` are valid `PermissionKey`s.
4. `areaRouteLabel` length ≤ 200.
5. Permission grants are ignored for OWNER role (owner is all-allow); only meaningful for STAFF.

### Lifecycle
`INVITED → ACTIVE → (DISABLED ↔ ACTIVE) → REMOVED(terminal)`

### Domain Events Emitted
`StaffJoinedEvent`, `StaffDisabledEvent`, `StaffEnabledEvent`, `StaffRemovedEvent`, `StaffPermissionsChangedEvent`.

---

## Aggregate 2 — StaffInvitation

- **Root Entity:** `StaffInvitationEntity` (table `staff_invitations`)
- **Value Objects:** `InviteToken`
- **References by ID only:** `vendorId`, `vendorUserId`, `invitedByUserId`

### Props
```ts
interface StaffInvitationProps {
  vendorId: bigint;
  vendorUserId: bigint;       // the INVITED membership this token activates
  invitedByUserId: bigint;
  phone: string;
  tokenHash: string;          // sha256(rawToken); raw never stored
  status: StaffInvitationStatus; // PENDING | ACCEPTED | EXPIRED | REVOKED
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
}
```

### Factory methods
- `static create(props, rawToken): StaffInvitationEntity` — sets `status=PENDING`, `expiresAt=now+7d`, `tokenHash=sha256(rawToken)`; `validate()`. (Raw token returned out-of-band by the service for the link; never persisted.)
- `static reconstitute(data): StaffInvitationEntity` — `validate()`.

### Behaviour
- `accept(correlationId)` — guard `status===PENDING && now<expiresAt`; else `ExpiredInviteError`/`InvalidInviteError`. Sets ACCEPTED + `acceptedAt=now`.
- `revoke()` — PENDING→REVOKED, `revokedAt=now`.
- `isUsable(now): boolean` — `status===PENDING && now<expiresAt`.

### Invariants (`validate()`)
1. `expiresAt > createdAt`.
2. `tokenHash` non-empty (64-hex sha256).
3. `phone` matches the platform phone format (reuse `PhoneNumber` VO from auth where practical).
4. `status ∈ StaffInvitationStatus`.

### Lifecycle
`PENDING → ACCEPTED` | `PENDING → EXPIRED` | `PENDING → REVOKED`

### Domain Events Emitted
`StaffInvitedEvent` (on create, by the invite service), `StaffJoinedEvent` (paired with membership.activate on accept).

---

## Value Objects

### `PermissionKey`
- Guarded enum: `MARK_DELIVERIES='mark_deliveries'`, `MARK_LEAVES='mark_leaves'`, `ADD_EXTRA_CHARGES='add_extra_charges'`.
- `static from(raw): PermissionKey` throws `ArgumentInvalidException` on unknown key.

### `MembershipStatus`
- Wraps `VendorUserStatus`; exposes `canTransitionTo(next): boolean` encoding the state machine; `assertTransition(next)` throws `InvalidStatusTransitionError` (422).

### `InviteToken`
- `static generate(): { raw: string; hash: string }` — `crypto.randomBytes(32).toString('hex')` (memory: CSPRNG only), `hash = sha256(raw)`.
- `static hash(raw): string`.

---

## Domain Events

All extend `DomainEventBase` (`id: uuid`, `aggregateId: string`, `occurredAt: Date`, `metadata: { correlationId; causationId? }`) per memory rule.

| Event | aggregateId | Payload | Consumers |
|---|---|---|---|
| `StaffInvitedEvent` | membershipId | vendorId, phone, invitedByUserId, inviteUrl(transient) | Audit, Notifications |
| `StaffJoinedEvent` | membershipId | vendorId, userId | Audit |
| `StaffDisabledEvent` | membershipId | vendorId, userId, disabledByUserId | Audit, Session-revocation |
| `StaffEnabledEvent` | membershipId | vendorId, userId | Audit |
| `StaffRemovedEvent` | membershipId | vendorId, userId, removedByUserId | Audit, List-unassign(US-005), Session-revocation |
| `StaffPermissionsChangedEvent` | membershipId | vendorId, userId, before[], after[] | Audit |

---

## Ports (defined in domain/application, adapted in infrastructure)

```ts
// database/vendor-membership.repository.port.ts
export interface IVendorMembershipRepository {
  findById(id: bigint): Promise<VendorMembershipRecord | null>;
  findByVendorAndUser(vendorId: bigint, userId: bigint): Promise<VendorMembershipRecord | null>;
  findByVendorAndPhone(vendorId: bigint, phone: string): Promise<VendorMembershipRecord | null>;
  findActiveByVendorAndUser(vendorId: bigint, userId: bigint): Promise<VendorMembershipRecord | null>;
  listByVendor(vendorId: bigint, query: QueryOptions): Promise<{ rows: VendorMembershipRecord[]; total: number }>;
  insertWithPermissions(data, grants, tx?): Promise<VendorMembershipRecord>;
  update(id: bigint, data, tx?): Promise<VendorMembershipRecord>;
  replacePermissions(id: bigint, grants, tx?): Promise<void>;
}

// database/staff-invitation.repository.port.ts
export interface IStaffInvitationRepository {
  insert(data, tx?): Promise<StaffInvitationRecord>;
  findByTokenHash(hash: string): Promise<StaffInvitationRecord | null>;
  findPendingByMembership(vendorUserId: bigint): Promise<StaffInvitationRecord | null>;
  update(id: bigint, data, tx?): Promise<StaffInvitationRecord>;
}

// ports/list-assignment.port.ts            (FEATURE_PLAN OQ-1 — stubbed until US-005)
// ports/subscription-limit.port.ts         (FEATURE_PLAN OQ-7 — stubbed until US-009)
// src/common/audit/audit.port.ts           (AuditPort — implemented this US)
```

---

## Mapper Contracts (`staff.mapper.ts` + `database/staff.mapper.ts`)

- `toDomain(record + permissionRows): VendorMembershipEntity` — reconstitute (validates).
- `toPersistence(entity): { membership: Prisma.VendorUserCreateInput/UpdateInput; grants: StaffPermissionInput[] }`.
- `toResponse(entity, { assignedListCount, assignedListIds }): StaffResponseDto` — **whitelist** fields; BigInt → string; never leak `tokenHash`, `passwordHash`, internal timestamps beyond created/updated.
- `invitationToResponse(entity, rawToken): { inviteUrl, expiresAt, status }` — builds the invite URL from config base + raw token (raw token only available at creation time).

### `StaffResponseDto` (whitelist)
```ts
{ staffId: string; userId: string | null; name: string | null; phone: string | null;
  role: 'owner' | 'staff'; status: VendorUserStatus; areaRouteLabel: string | null;
  permissions: PermissionKey[]; assignedListCount: number; assignedListIds: string[];
  invitedAt: string | null; joinedAt: string | null; createdAt: string; updatedAt: string }
```

### `RoleContextDto` (GET /vendors/:vendorId/role)
```ts
{ role: 'owner' | 'staff'; vendorId: string; staffId: string | null; permissions: PermissionKey[] }
```
