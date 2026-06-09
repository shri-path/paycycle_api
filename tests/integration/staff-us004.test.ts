import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/infrastructure/database/prisma.client';

const app = createApp();

// Distinct phones per concern to avoid INVITED/ACTIVE collisions across tests.
const OWNER_A = '+919633300001';
const OWNER_B = '+919633300002';
const P_RESEND = '+919633300010'; // resend lifecycle
const P_PERMS = '+919633300011'; // permission grant-map
const P_ASSIGN = '+919633300012'; // gated assign/unassign
const P_LIMITS = '+919633300013'; // limits block
const ALL_PHONES = [OWNER_A, OWNER_B, P_RESEND, P_PERMS, P_ASSIGN, P_LIMITS];

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

async function invite(
  owner: OwnerResult,
  phone: string,
  permissions: string[] = ['mark_deliveries']
): Promise<{ staffId: string; rawToken: string }> {
  const res = await request(app)
    .post(`/api/v1/vendors/${owner.vendorId}/staff/invite`)
    .set('Authorization', `Bearer ${owner.token}`)
    .send({ phone, name: 'Staff Member', permissions, sendVia: 'whatsapp' });
  expect(res.status).toBe(201);
  return {
    staffId: res.body.data.staff.staffId as string,
    rawToken: tokenFromUrl(res.body.data.inviteUrl as string),
  };
}

let ownerA: OwnerResult;
let ownerB: OwnerResult;

beforeAll(async () => {
  await cleanup();
  ownerA = await signupOwner(OWNER_A, 'Vendor A');
  ownerB = await signupOwner(OWNER_B, 'Vendor B');
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('US-004 Staff Management — additions', () => {
  describe('POST /staff/:staffId/resend-invitation', () => {
    it('owner resends a pending invite → 200, fresh URL + sentVia, old token rotated out', async () => {
      const { staffId, rawToken } = await invite(ownerA, P_RESEND);

      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/staff/${staffId}/resend-invitation`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({ sendVia: 'sms' });

      expect(res.status).toBe(200);
      expect(res.body.data.inviteUrl).toContain('accept-invite?token=');
      expect(res.body.data.sentVia).toBe('sms');
      const newToken = tokenFromUrl(res.body.data.inviteUrl as string);
      expect(newToken).not.toBe(rawToken);

      // Token rotation: the OLD token is now revoked → accept fails 404.
      const oldAccept = await request(app)
        .post('/api/v1/auth/accept-invite')
        .send({ token: rawToken, password: 'Staff@123' });
      expect(oldAccept.status).toBe(404);

      // sent_count incremented to 2 for the latest invitation.
      const latest = await prisma.staffInvitation.findFirst({
        where: { vendorUserId: BigInt(staffId) },
        orderBy: { createdAt: 'desc' },
      });
      expect(latest?.sentCount).toBe(2);
    });

    it('resend on an ACTIVE member → 422', async () => {
      const { staffId, rawToken } = await invite(ownerA, P_PERMS, ['mark_deliveries']);
      const accept = await request(app)
        .post('/api/v1/auth/accept-invite')
        .send({ token: rawToken, password: 'Staff@123' });
      expect(accept.status).toBe(200);

      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/staff/${staffId}/resend-invitation`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({});
      expect(res.status).toBe(422);
      expect(res.body.error.correlationId).toBeTruthy();
    });

    it('owner B resending owner A staff → 404 mask', async () => {
      const list = await request(app)
        .get(`/api/v1/vendors/${ownerA.vendorId}/staff`)
        .set('Authorization', `Bearer ${ownerA.token}`);
      const staff = list.body.data.find((s: { phone: string }) => s.phone === P_RESEND) as {
        staffId: string;
      };
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerB.vendorId}/staff/${staff.staffId}/resend-invitation`)
        .set('Authorization', `Bearer ${ownerB.token}`)
        .send({});
      expect(res.status).toBe(404);
      expect(res.body.error.correlationId).toBeTruthy();
    });
  });

  describe('PATCH /staff/:staffId/permissions', () => {
    it('owner sets a grant-map and gets the full 3-key state back (merge semantics)', async () => {
      // P_PERMS staff is ACTIVE from the resend test, with mark_deliveries granted.
      const list = await request(app)
        .get(`/api/v1/vendors/${ownerA.vendorId}/staff`)
        .set('Authorization', `Bearer ${ownerA.token}`);
      const staff = list.body.data.find(
        (s: { phone: string }) => s.phone === P_PERMS
      ) as { staffId: string };

      const res = await request(app)
        .patch(`/api/v1/vendors/${ownerA.vendorId}/staff/${staff.staffId}/permissions`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({ permissions: [{ key: 'add_extra_charges', granted: true }] });

      expect(res.status).toBe(200);
      const byKey = Object.fromEntries(
        res.body.data.permissions.map((p: { key: string; granted: boolean }) => [p.key, p.granted])
      );
      // add_extra_charges turned on; mark_deliveries (from invite) preserved (merge).
      expect(byKey['add_extra_charges']).toBe(true);
      expect(byKey['mark_deliveries']).toBe(true);
      expect(byKey['mark_leaves']).toBe(false);
    });

    it('staff cannot PATCH permissions → 403', async () => {
      const list = await request(app)
        .get(`/api/v1/vendors/${ownerA.vendorId}/staff`)
        .set('Authorization', `Bearer ${ownerA.token}`);
      const staff = list.body.data.find((s: { phone: string }) => s.phone === P_PERMS) as {
        staffId: string;
      };
      const login = await request(app)
        .post('/api/v1/auth/login')
        .send({ phone: P_PERMS, password: 'Staff@123' });
      const staffToken = login.body.data.tokens.accessToken as string;

      const res = await request(app)
        .patch(`/api/v1/vendors/${ownerA.vendorId}/staff/${staff.staffId}/permissions`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ permissions: [{ key: 'mark_leaves', granted: true }] });
      expect(res.status).toBe(403);
    });
  });

  describe('assign-list / unassign-list (gated until US-005)', () => {
    let staffId: string;
    let staffToken: string;

    beforeAll(async () => {
      const { staffId: sid, rawToken } = await invite(ownerA, P_ASSIGN);
      staffId = sid;
      const accept = await request(app)
        .post('/api/v1/auth/accept-invite')
        .send({ token: rawToken, password: 'Staff@123' });
      staffToken = accept.body.data.tokens.accessToken as string;
    });

    it('owner assign-list → 503 FEATURE_NOT_AVAILABLE with correlationId', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/staff/${staffId}/assign-list`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({ supplyListId: '1', isPrimary: true });
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('FEATURE_NOT_AVAILABLE');
      expect(res.body.error.correlationId).toBeTruthy();
    });

    it('owner unassign-list → 503', async () => {
      const res = await request(app)
        .delete(`/api/v1/vendors/${ownerA.vendorId}/staff/${staffId}/unassign-list/1`)
        .set('Authorization', `Bearer ${ownerA.token}`);
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('FEATURE_NOT_AVAILABLE');
    });

    it('guard order — staff caller gets 403, NOT 503', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/staff/${staffId}/assign-list`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ supplyListId: '1' });
      expect(res.status).toBe(403);
    });

    it('guard order — wrong-tenant owner gets 404, NOT 503', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerB.vendorId}/staff/${staffId}/assign-list`)
        .set('Authorization', `Bearer ${ownerB.token}`)
        .send({ supplyListId: '1' });
      expect(res.status).toBe(404);
    });
  });

  describe('GET /staff limits block', () => {
    it('includes a limits snapshot (unlimited stub)', async () => {
      await invite(ownerA, P_LIMITS);
      const res = await request(app)
        .get(`/api/v1/vendors/${ownerA.vendorId}/staff`)
        .set('Authorization', `Bearer ${ownerA.token}`);
      expect(res.status).toBe(200);
      expect(res.body.meta.limits).toBeDefined();
      expect(res.body.meta.limits.maxStaff).toBeNull();
      expect(res.body.meta.limits.canAddMore).toBe(true);
      expect(typeof res.body.meta.limits.currentActive).toBe('number');
    });
  });
});
