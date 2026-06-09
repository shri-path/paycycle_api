# Domain Model: US-004 — Staff Management

> **Scope note:** US-004 is an **extension** of the US-002 *Staff & Access* bounded context. The aggregates, value objects, and most domain events already exist — see [`docs/features/us-002-roles-access/DOMAIN_MODEL.md`](../us-002-roles-access/DOMAIN_MODEL.md) for their full specs. This document covers **only the delta** US-004 introduces, and confirms which existing capabilities are reused unchanged.

---

## Bounded Context

**Staff & Access** (unchanged). US-004 adds two outbound **ports** to neighbouring unbuilt contexts (Supply Lists, Notifications) and one delivery-metadata extension to the `StaffInvitation` aggregate. No new aggregate is introduced.

```
            ┌─────────────────────────── Staff & Access (existing) ───────────────────────────┐
            │  VendorMembership (root)        StaffInvitation (root)                            │
            │   - status machine               - token lifecycle  ← +sentVia/sentCount/lastSent │
            │   - permission grants            - 7-day expiry                                   │
            └───────┬───────────────────────────────┬──────────────────────────────────────────┘
                    │ ListAssignmentPort (read, US-002 stub)                                    
                    │ ListAssignmentWritePort (NEW, US-004 stub → US-005)  ──►  Supply Lists ctx 
                    │ StaffNotificationPort   (NEW, US-004 stub → provider) ──►  Notifications   
                    │ SubscriptionLimitPort   (US-002 stub → US-009)        ──►  Subscriptions   
```

---

## Aggregates — reused unchanged

### `VendorMembershipEntity` (table `vendor_users`)
All behaviour US-004 needs **already exists** — no method additions:

| Capability US-004 uses | Existing method | Notes |
|---|---|---|
| Edit permissions (N2) | `setPermissions(grants, correlationId)` | Owner → no-op; emits `StaffPermissionsChangedEvent`. |
| Edit area label | `updateArea(label)` | Already on PATCH. |
| Re-invite removed staff | `reinvite(grants, areaRouteLabel)` | Used by invite; resend (N1) acts on INVITED, not REMOVED. |
| Status machine | `activate / disable / enable / remove` + `transition()` | Resend reads `status`; does not transition the membership. |
| Owner guard | `assertNotOwner(...)` | Reused by assign/permission paths. |
| Granted keys (owner = all) | `grantedPermissions()` | Drives N2 response + `role` endpoint. |

**`name` is NOT a membership prop.** It lives on the linked `User`. The PATCH-staff `name` edit updates `User.name` via the user repository inside the staff command's transaction — it does **not** add a field to `VendorMembershipEntity`.

### `StaffInvitationEntity` (table `staff_invitations`) — EXTENDED (metadata only)
Existing: `create(props, rawToken)`, `accept()`, expiry guard, `tokenHash`, `status` machine `PENDING→ACCEPTED|EXPIRED|REVOKED`.

**US-004 delta — invitation-delivery metadata** (does not change the token/acceptance invariants):

| New prop | Type | Rule |
|---|---|---|
| `sentVia` | `InviteChannel \| null` (`whatsapp`\|`sms`) | Channel of the most recent send; `null` if unspecified. |
| `sentCount` | `int ≥ 1` | Incremented on every (re)send. New invite = 1. |
| `lastSentAt` | `Date` | Set to `now()` on create and on resend. |

- **Resend semantics:** resend does **not** mutate an existing invitation in place. It **revokes** the current PENDING invitation (`status → REVOKED`) and **creates a new** PENDING invitation with `sentCount = previous + 1`, a fresh CSPRNG token, and `expiresAt = now + 7d`. This preserves the single-use-token invariant and yields a clean audit trail.
- **Factory change:** `StaffInvitationEntity.create(props, rawToken)` accepts optional `sentVia` and computes `sentCount`/`lastSentAt`. Existing callers (US-002 invite) pass `sentVia` from the request (or `null`).

---

## Value Objects

### Reused unchanged
- `PermissionKey` — `mark_deliveries | mark_leaves | add_extra_charges`. N2's grant-map validates against this enum (`z.nativeEnum`).
- `MembershipStatus` — drives the resend "must be INVITED" guard via `status` read.
- `InviteToken` — `crypto.randomBytes(32)` CSPRNG, sha256-hashed at rest (memory rule: never `Math.random`). Resend calls `InviteToken.generate()` again.

### NEW
- `InviteChannel` — a guarded string union (`'whatsapp' | 'sms'`) mapped to the Prisma `StaffInvitationChannel` enum (`WHATSAPP`/`SMS`, `@@map("invitation_channel")`). Validated at the boundary with `z.enum`. Lightweight — no class needed; a `z.nativeEnum`/union + the Prisma enum suffice.

---

## Domain Events

### Reused
- `StaffInvitedEvent` — also emitted by **resend** (same shape: membershipId, vendorId, phone, invitedBy, inviteUrl, correlationId). Consumed by Audit; Notifications (future) will key off it.
- `StaffPermissionsChangedEvent` — emitted by N2 (already wired in `setPermissions`). Consumed by Audit.

### NEW (audit actions, not new event classes)
US-004 adds **audit action enum values**, not new domain-event classes (the existing events cover the state changes):

| Audit action (`AuditAction`) | Emitted by | Metadata |
|---|---|---|
| `STAFF_INVITE_RESENT` | `ResendInviteService` | `{ sentVia, sentCount }` |
| `STAFF_PERMISSIONS_CHANGED` | `UpdatePermissionsService` | `{ before[], after[] }` (reuses existing action) |
| `STAFF_LIST_ASSIGNED` *(US-005)* | real assign adapter | deferred |
| `STAFF_LIST_UNASSIGNED` *(US-005)* | real unassign adapter | deferred |

> Add `STAFF_INVITE_RESENT` (and the two deferred list actions, for forward-compat) to `src/common/audit/audit-action.enum.ts`.

---

## Aggregate Boundaries & Cross-Context Rules

- `StaffInvitation` references `VendorMembership` and `Vendor` **by id only** (unchanged). The delivery-metadata columns stay inside the invitation aggregate.
- **Supply-list assignments are not owned by this context** — all reads go through `ListAssignmentPort`, all writes through the new `ListAssignmentWritePort`. The `supply_list_staff` table is owned by the **Supply Lists** context (US-005). US-004 never imports it directly.
- **Notification delivery is not owned here** — `StaffNotificationPort` is the only seam; no SMS/WhatsApp SDK enters the staff module.
- **Subscription caps are not owned here** — `SubscriptionLimitPort` (US-009 seam) feeds both the invite gate (451) and the `limits` block.

---

## Invariant Summary (what Dev must enforce)

| # | Invariant | Where enforced |
|---|---|---|
| 1 | Resend allowed only when membership `status = INVITED` | `ResendInviteService` (reads `entity.status`) → `InvalidStatusTransitionError` 422 |
| 2 | Resend rotates token: prior PENDING → REVOKED, exactly one new PENDING | `ResendInviteService` TX + `invitationRepo.revokePendingByMembership` |
| 3 | `sentCount` strictly increments; `lastSentAt = now` on each send | `StaffInvitationEntity.create` |
| 4 | Permission grants apply to STAFF only; owner target is all-allow no-op | `VendorMembershipEntity.setPermissions` (existing) |
| 5 | Grant-map keys ∈ `PermissionKey`; ≤ 3 entries | `updatePermissionsSchema` (Zod) + entity `validate()` |
| 6 | Assign/unassign reachable only by owner of the tenant; 503 only after guards | route middleware order + stub throw |
| 7 | `name` 1–100 chars; updates `User.name`, not membership | `updateStaffSchema` + user repo write in TX |
| 8 | One primary staff per list *(deferred)* | US-005 real write adapter |
| 9 | Notification failure never aborts the command | `staff-notification-log.adapter` (log-and-continue) |

---

## What is explicitly NOT modeled in US-004 (deferred)

- No `StaffAssignment` aggregate (lists are US-005's aggregate; we only hold a port).
- No `StaffActivity` / stats aggregate or read-model (US-006 `daily_supplies` based; materialized view deferred — OQ-6).
- No staff-persona query models (`dashboard`, `my-lists`, `my-customers`, `my-activity`) — deferred to US-005/US-006 (OQ-10).
- No subscription-plan entity (US-009).
