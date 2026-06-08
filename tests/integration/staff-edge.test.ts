import request from 'supertest';
import { VendorUserStatus, StaffInvitationStatus } from '@prisma/client';
import { createApp } from '../../src/app';
import { prisma } from '../../src/infrastructure/database/prisma.client';

const app = createApp();

// Distinct phones per concern to avoid INVITED/ACTIVE state collisions across tests.
const OWNER_A = '+919622200001';
const OWNER_B = '+919622200002';
const P_TOKEN = '+919622200010'; // invite-token security
const P_SINGLE = '+919622200011'; // single-use accept
const P_EXPIRED = '+919622200012'; // expired token
const P_LOGIN = '+919622200013'; // MINOR-2 login-after-accept
const P_STAFF = '+919622200014'; // OQ-2 disable + owner-only-route + validation + multi-tenant
const P_REINVITE = '+919622200015'; // OQ-8 reactivation
const P_AUDIT = '+919622200016'; // audit completeness
const P_INVITE_400A = '+919622200017';
const P_INVITE_400B = '+919622200018';
const ALL_PHONES = [
  OWNER_A,
  OWNER_B,
  P_TOKEN,
  P_SINGLE,
  P_EXPIRED,
  P_LOGIN,
  P_STAFF,
  P_REINVITE,
  P_AUDIT,
  P_INVITE_400A,
  P_INVITE_400B,
];

async function cleanup(): Promise<void> {
  const users = await prisma.user.findMany({ where: { phone: { in: ALL_PHONES } } });
  const userIds = users.map((u) => u.id);
  const memberships = userIds.length
    ? await prisma.vendorUser.findMany({ where: { userId: { in: userIds } } })
    : [];
  const vendorIds = [...new Set(memberships.map((m) => m.vendorId))];

  await prisma.staffInvitation.deleteMany({
    where: { OR: [{ phone: { in: ALL_PHONES } }, { vendorId: { in: vendorIds } }] },
  });
  await prisma.staffPermission.deleteMany({
    where: { vendorUser: { userId: { in: userIds.length ? userIds : [-1n] } } },
  });
  await prisma.userSession.deleteMany({
    where: { userId: { in: userIds.length ? userIds : [-1n] } },
  });
  if (vendorIds.length) {
    await prisma.auditLog.deleteMany({ where: { vendorId: { in: vendorIds } } });
  }
  await prisma.vendorUser.deleteMany({
    where: {
      OR: [{ userId: { in: userIds.length ? userIds : [-1n] } }, { vendorId: { in: vendorIds } }],
    },
  });
  if (vendorIds.length) await prisma.vendor.deleteMany({ where: { id: { in: vendorIds } } });
  await prisma.user.deleteMany({ where: { phone: { in: ALL_PHONES } } });
}

interface OwnerResult {
  token: string;
  vendorId: string;
  userId: string;
}

async function signupOwner(phone: string, vendorName: string): Promise<OwnerResult> {
  const res = await request(app)
    .post('/api/v1/auth/signup')
    .send({ phone, password: 'Owner@123', vendorName });
  expect(res.status).toBe(201);
  return {
    token: res.body.data.tokens.accessToken as string,
    vendorId: res.body.data.vendorContext.vendorId as string,
    userId: res.body.data.user.id as string,
  };
}

function tokenFromUrl(inviteUrl: string): string {
  return new URL(inviteUrl).searchParams.get('token') as string;
}

/** BigInt-safe JSON serialization for asserting raw secrets never appear in a row. */
function safeJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
}

async function invite(
  owner: OwnerResult,
  phone: string,
  permissions: string[] = ['mark_deliveries']
): Promise<{ staffId: string; rawToken: string }> {
  const res = await request(app)
    .post(`/api/v1/vendors/${owner.vendorId}/staff/invite`)
    .set('Authorization', `Bearer ${owner.token}`)
    .send({ phone, name: 'Staff Member', areaRouteLabel: 'Route X', permissions });
  expect(res.status).toBe(201);
  return {
    staffId: res.body.data.staff.staffId as string,
    rawToken: tokenFromUrl(res.body.data.inviteUrl as string),
  };
}

/** Invite + accept a fresh staff member; returns ids + the staff access token. */
async function inviteAndAccept(
  owner: OwnerResult,
  phone: string,
  permissions: string[] = ['mark_deliveries']
): Promise<{ staffId: string; staffToken: string; rawToken: string }> {
  const { staffId, rawToken } = await invite(owner, phone, permissions);
  const accept = await request(app)
    .post('/api/v1/auth/accept-invite')
    .send({ token: rawToken, password: 'Staff@123', name: 'Staff Member' });
  expect(accept.status).toBe(200);
  return { staffId, staffToken: accept.body.data.tokens.accessToken as string, rawToken };
}

beforeAll(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('US-002 Staff & Access — edge cases & security', () => {
  let ownerA: OwnerResult;
  let ownerB: OwnerResult;

  beforeAll(async () => {
    ownerA = await signupOwner(OWNER_A, 'Edge Vendor A');
    ownerB = await signupOwner(OWNER_B, 'Edge Vendor B');
  });

  // ----------------------------------------------------------------
  // Invite-token security: hashed at rest, never returned, single-use
  // ----------------------------------------------------------------
  describe('Invite token security', () => {
    it('raw token never persisted — only the sha256 hash is stored, never leaked', async () => {
      const { rawToken } = await invite(ownerA, P_TOKEN);

      const row = await prisma.staffInvitation.findFirst({
        where: { phone: P_TOKEN },
        orderBy: { createdAt: 'desc' },
      });
      expect(row).toBeTruthy();
      expect(row?.tokenHash).toBeTruthy();
      expect(row?.tokenHash).not.toBe(rawToken);
      expect(row?.tokenHash).toHaveLength(64); // sha256 hex digest
      expect(safeJson(row)).not.toContain(rawToken);
    });

    it('single-use — accepting the same token twice → second is 404', async () => {
      const { rawToken } = await invite(ownerA, P_SINGLE);

      const first = await request(app)
        .post('/api/v1/auth/accept-invite')
        .send({ token: rawToken, password: 'Staff@123' });
      expect(first.status).toBe(200);

      const second = await request(app)
        .post('/api/v1/auth/accept-invite')
        .send({ token: rawToken, password: 'Staff@123' });
      expect(second.status).toBe(404);
      expect(second.body.error.correlationId).toBeTruthy();
    });

    it('expired token (>7d) → 422 with correlationId', async () => {
      const { rawToken } = await invite(ownerA, P_EXPIRED);

      // Simulate a >7-day-old invite: backdate BOTH createdAt and expiresAt so the
      // entity invariant (expiresAt > createdAt) still holds — only expiry has passed.
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
      const oneDayAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
      await prisma.staffInvitation.updateMany({
        where: { phone: P_EXPIRED, status: StaffInvitationStatus.PENDING },
        data: { createdAt: eightDaysAgo, expiresAt: oneDayAgo },
      });

      const res = await request(app)
        .post('/api/v1/auth/accept-invite')
        .send({ token: rawToken, password: 'Staff@123' });
      expect(res.status).toBe(422);
      expect(res.body.error.correlationId).toBeTruthy();
    });
  });

  // ----------------------------------------------------------------
  // MINOR-2 — login-after-accept path (Review asked QA to confirm)
  // ----------------------------------------------------------------
  describe('MINOR-2 — onboarded staff can log in normally after accept', () => {
    it('accept sets the password; the user can subsequently log in with it', async () => {
      const { staffToken } = await inviteAndAccept(ownerB, P_LOGIN);
      expect(staffToken).toBeTruthy();

      // Independently log in with the password chosen at accept time — proves the user
      // is NOT locked out even if post-commit session creation had failed (MINOR-2).
      const login = await request(app)
        .post('/api/v1/auth/login')
        .send({ phone: P_LOGIN, password: 'Staff@123' });
      expect(login.status).toBe(200);
      expect(login.body.data.tokens.accessToken).toBeTruthy();
      expect(login.body.data.user.phone).toBe(P_LOGIN);
    });
  });

  // ----------------------------------------------------------------
  // Shared active staff (P_STAFF under ownerA) for the next blocks.
  // ----------------------------------------------------------------
  describe('Active staff lifecycle, enforcement & isolation', () => {
    let staffId: string;

    beforeAll(async () => {
      const r = await inviteAndAccept(ownerA, P_STAFF, ['mark_deliveries']);
      staffId = r.staffId;
    });

    // -- OQ-2: disabled staff blocked on the very next request -------
    it('OQ-2 — a freshly-issued staff token stops working once the member is DISABLED in the DB', async () => {
      const login = await request(app)
        .post('/api/v1/auth/login')
        .send({ phone: P_STAFF, password: 'Staff@123' });
      expect(login.status).toBe(200);
      const staffToken = login.body.data.tokens.accessToken as string;

      const before = await request(app)
        .get(`/api/v1/vendors/${ownerA.vendorId}/role`)
        .set('Authorization', `Bearer ${staffToken}`);
      expect(before.status).toBe(200);
      expect(before.body.data.role).toBe('staff');

      // Disable directly in the DB (simulate owner disabling between requests).
      await prisma.vendorUser.update({
        where: { id: BigInt(staffId) },
        data: { status: VendorUserStatus.DISABLED, disabledAt: new Date() },
      });

      // Same still-valid JWT — identifyUserRole re-checks status=ACTIVE against the DB
      // and masks the now-non-active membership as 404 (never 200).
      const after = await request(app)
        .get(`/api/v1/vendors/${ownerA.vendorId}/role`)
        .set('Authorization', `Bearer ${staffToken}`);
      expect(after.status).toBe(404);
      expect(after.body.error.correlationId).toBeTruthy();

      // Re-enable for the enforcement tests below.
      await prisma.vendorUser.update({
        where: { id: BigInt(staffId) },
        data: { status: VendorUserStatus.ACTIVE, disabledAt: null },
      });
    });

    // -- Owner-only route enforcement for staff (403) ----------------
    describe('owner-only routes rejected for staff (403)', () => {
      let staffToken: string;

      beforeAll(async () => {
        const login = await request(app)
          .post('/api/v1/auth/login')
          .send({ phone: P_STAFF, password: 'Staff@123' });
        expect(login.status).toBe(200);
        staffToken = login.body.data.tokens.accessToken as string;
      });

      it('staff cannot invite staff → 403', async () => {
        const res = await request(app)
          .post(`/api/v1/vendors/${ownerA.vendorId}/staff/invite`)
          .set('Authorization', `Bearer ${staffToken}`)
          .send({ phone: '+919622299999', name: 'Nope' });
        expect(res.status).toBe(403);
        expect(res.body.error.correlationId).toBeTruthy();
      });

      it('staff cannot PATCH a staff member → 403', async () => {
        const res = await request(app)
          .patch(`/api/v1/vendors/${ownerA.vendorId}/staff/${staffId}`)
          .set('Authorization', `Bearer ${staffToken}`)
          .send({ status: 'DISABLED' });
        expect(res.status).toBe(403);
      });

      it('staff cannot DELETE a staff member → 403', async () => {
        const res = await request(app)
          .delete(`/api/v1/vendors/${ownerA.vendorId}/staff/${staffId}`)
          .set('Authorization', `Bearer ${staffToken}`);
        expect(res.status).toBe(403);
      });

      it('staff cannot list staff → 403', async () => {
        const res = await request(app)
          .get(`/api/v1/vendors/${ownerA.vendorId}/staff`)
          .set('Authorization', `Bearer ${staffToken}`);
        expect(res.status).toBe(403);
      });
    });

    // -- MINOR-1 + strict-schema validation at the boundary ----------
    describe('validation boundary (MINOR-1 + strict schemas)', () => {
      it('PATCH status:INVITED → 400 (not silently ignored)', async () => {
        const res = await request(app)
          .patch(`/api/v1/vendors/${ownerA.vendorId}/staff/${staffId}`)
          .set('Authorization', `Bearer ${ownerA.token}`)
          .send({ status: 'INVITED' });
        expect(res.status).toBe(400);
      });

      it('PATCH status:REMOVED → 400 (removal is DELETE-only)', async () => {
        const res = await request(app)
          .patch(`/api/v1/vendors/${ownerA.vendorId}/staff/${staffId}`)
          .set('Authorization', `Bearer ${ownerA.token}`)
          .send({ status: 'REMOVED' });
        expect(res.status).toBe(400);
      });

      it('PATCH with unknown field → 400 (strict schema)', async () => {
        const res = await request(app)
          .patch(`/api/v1/vendors/${ownerA.vendorId}/staff/${staffId}`)
          .set('Authorization', `Bearer ${ownerA.token}`)
          .send({ status: 'ACTIVE', bogusField: 'x' });
        expect(res.status).toBe(400);
      });

      it('PATCH empty body → 400 (at least one field required)', async () => {
        const res = await request(app)
          .patch(`/api/v1/vendors/${ownerA.vendorId}/staff/${staffId}`)
          .set('Authorization', `Bearer ${ownerA.token}`)
          .send({});
        expect(res.status).toBe(400);
      });

      it('invite with unknown field → 400 (strict schema)', async () => {
        const res = await request(app)
          .post(`/api/v1/vendors/${ownerA.vendorId}/staff/invite`)
          .set('Authorization', `Bearer ${ownerA.token}`)
          .send({ phone: P_INVITE_400A, surprise: true });
        expect(res.status).toBe(400);
      });

      it('invite with invalid permission key → 400', async () => {
        const res = await request(app)
          .post(`/api/v1/vendors/${ownerA.vendorId}/staff/invite`)
          .set('Authorization', `Bearer ${ownerA.token}`)
          .send({ phone: P_INVITE_400B, permissions: ['not_a_real_permission'] });
        expect(res.status).toBe(400);
      });
    });

    // -- Owner self-guard (OQ-6 / story edge case #3) ----------------
    describe('owner self-guard (OQ-6)', () => {
      let ownerMembershipId: string;

      beforeAll(async () => {
        const member = await prisma.vendorUser.findFirst({
          where: { vendorId: BigInt(ownerA.vendorId), user: { phone: OWNER_A } },
        });
        ownerMembershipId = (member?.id as bigint).toString();
      });

      it('owner cannot DISABLE their own membership → 403', async () => {
        const res = await request(app)
          .patch(`/api/v1/vendors/${ownerA.vendorId}/staff/${ownerMembershipId}`)
          .set('Authorization', `Bearer ${ownerA.token}`)
          .send({ status: 'DISABLED' });
        expect(res.status).toBe(403);
        expect(res.body.error.correlationId).toBeTruthy();
      });

      it('owner cannot REMOVE their own membership → 403', async () => {
        const res = await request(app)
          .delete(`/api/v1/vendors/${ownerA.vendorId}/staff/${ownerMembershipId}`)
          .set('Authorization', `Bearer ${ownerA.token}`);
        expect(res.status).toBe(403);
      });
    });

    // -- Multi-tenant isolation across PATCH/DELETE (not just GET) ----
    describe('multi-tenant isolation — PATCH/DELETE wrong vendor → 404 mask', () => {
      it('owner B PATCH owner A staffId → 404 (mask, never 403)', async () => {
        const res = await request(app)
          .patch(`/api/v1/vendors/${ownerB.vendorId}/staff/${staffId}`)
          .set('Authorization', `Bearer ${ownerB.token}`)
          .send({ status: 'DISABLED' });
        expect(res.status).toBe(404);
        expect(res.body.error.correlationId).toBeTruthy();
      });

      it('owner B DELETE owner A staffId → 404 (mask)', async () => {
        const res = await request(app)
          .delete(`/api/v1/vendors/${ownerB.vendorId}/staff/${staffId}`)
          .set('Authorization', `Bearer ${ownerB.token}`);
        expect(res.status).toBe(404);
      });

      it('route :vendorId is authoritative — a body vendorId cannot redirect the operation', async () => {
        const res = await request(app)
          .patch(`/api/v1/vendors/${ownerA.vendorId}/staff/${staffId}`)
          .set('Authorization', `Bearer ${ownerA.token}`)
          .send({ areaRouteLabel: 'Smuggle', vendorId: ownerB.vendorId });
        // vendorId is not a declared field → strict schema rejects (400); either way
        // the membership must never move to vendor B.
        expect([400, 200]).toContain(res.status);
        const stillInA = await prisma.vendorUser.findFirst({ where: { id: BigInt(staffId) } });
        expect((stillInA?.vendorId as bigint).toString()).toBe(ownerA.vendorId);
      });
    });
  });

  // ----------------------------------------------------------------
  // OQ-8 — re-inviting a REMOVED member reactivates (atomic, MAJOR-1 fix)
  // ----------------------------------------------------------------
  describe('OQ-8 — re-invite a REMOVED member reactivates the same membership', () => {
    it('invite → accept → remove → re-invite same phone reactivates (201, no dup-constraint error)', async () => {
      const { staffId } = await inviteAndAccept(ownerB, P_REINVITE);

      const del = await request(app)
        .delete(`/api/v1/vendors/${ownerB.vendorId}/staff/${staffId}`)
        .set('Authorization', `Bearer ${ownerB.token}`);
      expect(del.status).toBe(200);
      expect(del.body.data.status).toBe('REMOVED');

      const removed = await prisma.vendorUser.findFirst({ where: { id: BigInt(staffId) } });
      expect(removed?.status).toBe(VendorUserStatus.REMOVED);

      // Re-invite the same phone → reactivates the SAME membership row, not 409/500.
      const reinvite = await request(app)
        .post(`/api/v1/vendors/${ownerB.vendorId}/staff/invite`)
        .set('Authorization', `Bearer ${ownerB.token}`)
        .send({ phone: P_REINVITE, name: 'Rehired', permissions: ['mark_leaves'] });
      expect(reinvite.status).toBe(201);
      expect(reinvite.body.data.staff.staffId).toBe(staffId); // same row reactivated
      expect(reinvite.body.data.staff.status).toBe('INVITED');

      // Atomicity (MAJOR-1): the membership was flipped REMOVED→INVITED AND a fresh
      // PENDING invitation exists — both, never half.
      const reactivated = await prisma.vendorUser.findFirst({ where: { id: BigInt(staffId) } });
      expect(reactivated?.status).toBe(VendorUserStatus.INVITED);
      expect(reactivated?.deletedAt).toBeNull();
      const pending = await prisma.staffInvitation.findFirst({
        where: { vendorUserId: BigInt(staffId), status: StaffInvitationStatus.PENDING },
      });
      expect(pending).toBeTruthy();
    });
  });

  // ----------------------------------------------------------------
  // Audit logging — staff mutation writes an audit row with full context
  // ----------------------------------------------------------------
  describe('Audit logging completeness', () => {
    it('invite writes a staff_invited audit row with performedBy + entity context', async () => {
      const { staffId } = await invite(ownerA, P_AUDIT);

      const rows = await prisma.auditLog.findMany({
        where: {
          vendorId: BigInt(ownerA.vendorId),
          action: 'staff_invited',
          entityId: BigInt(staffId),
        },
      });
      expect(rows.length).toBeGreaterThanOrEqual(1);
      const row = rows[0];
      expect(row?.performedByUserId?.toString()).toBe(ownerA.userId);
      expect(row?.entityType).toBe('staff');
    });
  });
});
