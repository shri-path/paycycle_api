import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/infrastructure/database/prisma.client';

const app = createApp();

// Unique phones for this suite (avoid clashes with other suites / seed data).
const OWNER_A = '+919611100001';
const OWNER_B = '+919611100002';
const STAFF_PHONE = '+919611100003';
const ALL_PHONES = [OWNER_A, OWNER_B, STAFF_PHONE];

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
  await prisma.vendorUser.deleteMany({
    where: {
      OR: [{ userId: { in: userIds.length ? userIds : [-1n] } }, { vendorId: { in: vendorIds } }],
    },
  });
  if (vendorIds.length) await prisma.vendor.deleteMany({ where: { id: { in: vendorIds } } });
  await prisma.user.deleteMany({ where: { phone: { in: ALL_PHONES } } });
}

interface SignupResult {
  token: string;
  vendorId: string;
}

async function signupOwner(phone: string, vendorName: string): Promise<SignupResult> {
  const res = await request(app)
    .post('/api/v1/auth/signup')
    .send({ phone, password: 'Owner@123', vendorName });
  expect(res.status).toBe(201);
  return {
    token: res.body.data.tokens.accessToken as string,
    vendorId: res.body.data.vendorContext.vendorId as string,
  };
}

beforeAll(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('US-002 Staff & Access — integration', () => {
  let ownerA: SignupResult;
  let ownerB: SignupResult;
  let inviteUrl: string;
  let staffId: string;

  beforeAll(async () => {
    ownerA = await signupOwner(OWNER_A, 'Vendor A Dairy');
    ownerB = await signupOwner(OWNER_B, 'Vendor B Dairy');
  });

  it('GET /vendors/:id/role — owner sees owner role', async () => {
    const res = await request(app)
      .get(`/api/v1/vendors/${ownerA.vendorId}/role`)
      .set('Authorization', `Bearer ${ownerA.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('owner');
    expect(res.body.data.vendorId).toBe(ownerA.vendorId);
  });

  it('POST /staff/invite — owner invites staff, gets invite URL (201)', async () => {
    const res = await request(app)
      .post(`/api/v1/vendors/${ownerA.vendorId}/staff/invite`)
      .set('Authorization', `Bearer ${ownerA.token}`)
      .send({
        phone: STAFF_PHONE,
        name: 'New Staff',
        areaRouteLabel: 'Route 1',
        permissions: ['mark_deliveries', 'mark_leaves'],
      });
    expect(res.status).toBe(201);
    expect(res.body.data.inviteUrl).toContain('accept-invite?token=');
    expect(res.body.data.staff.status).toBe('INVITED');
    expect(res.body.data.staff.permissions).toEqual(
      expect.arrayContaining(['mark_deliveries', 'mark_leaves'])
    );
    inviteUrl = res.body.data.inviteUrl as string;
    staffId = res.body.data.staff.staffId as string;
  });

  it('POST /staff/invite — re-inviting the same active phone → 409', async () => {
    // First accept to make the staff active, then re-invite.
    const token = new URL(inviteUrl).searchParams.get('token');
    const accept = await request(app)
      .post('/api/v1/auth/accept-invite')
      .send({ token, password: 'Staff@123', name: 'New Staff' });
    expect(accept.status).toBe(200);
    expect(accept.body.data.tokens.accessToken).toBeTruthy();

    const res = await request(app)
      .post(`/api/v1/vendors/${ownerA.vendorId}/staff/invite`)
      .set('Authorization', `Bearer ${ownerA.token}`)
      .send({ phone: STAFF_PHONE });
    expect(res.status).toBe(409);
    expect(res.body.error.correlationId).toBeTruthy();
  });

  it('GET /staff — owner lists staff (excludes owner)', async () => {
    const res = await request(app)
      .get(`/api/v1/vendors/${ownerA.vendorId}/staff`)
      .set('Authorization', `Bearer ${ownerA.token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.some((s: { staffId: string }) => s.staffId === staffId)).toBe(true);
    expect(res.body.data.every((s: { role: string }) => s.role === 'staff')).toBe(true);
  });

  it('GET /staff/:staffId — owner sees detail; no secret fields', async () => {
    const res = await request(app)
      .get(`/api/v1/vendors/${ownerA.vendorId}/staff/${staffId}`)
      .set('Authorization', `Bearer ${ownerA.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.tokenHash).toBeUndefined();
    expect(res.body.data.passwordHash).toBeUndefined();
    expect(res.body.data.deletedAt).toBeUndefined();
  });

  it('PATCH /staff/:staffId — owner disables staff, then re-enables', async () => {
    const disable = await request(app)
      .patch(`/api/v1/vendors/${ownerA.vendorId}/staff/${staffId}`)
      .set('Authorization', `Bearer ${ownerA.token}`)
      .send({ status: 'DISABLED' });
    expect(disable.status).toBe(200);
    expect(disable.body.data.status).toBe('DISABLED');

    const enable = await request(app)
      .patch(`/api/v1/vendors/${ownerA.vendorId}/staff/${staffId}`)
      .set('Authorization', `Bearer ${ownerA.token}`)
      .send({ status: 'ACTIVE' });
    expect(enable.status).toBe(200);
    expect(enable.body.data.status).toBe('ACTIVE');
  });

  it('multi-tenant — owner B cannot touch owner A staffId → 404 (masked) with correlationId', async () => {
    const res = await request(app)
      .get(`/api/v1/vendors/${ownerB.vendorId}/staff/${staffId}`)
      .set('Authorization', `Bearer ${ownerB.token}`);
    expect(res.status).toBe(404);
    expect(res.body.error.correlationId).toBeTruthy();
  });

  it('owner A accessing vendor B (no membership) → 404 mask', async () => {
    const res = await request(app)
      .get(`/api/v1/vendors/${ownerB.vendorId}/role`)
      .set('Authorization', `Bearer ${ownerA.token}`);
    expect(res.status).toBe(404);
    expect(res.body.error.correlationId).toBeTruthy();
  });

  it('staff is blocked from owner-only routes → 403', async () => {
    // Re-login as the now-active staff to get a token with staff role claims.
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ phone: STAFF_PHONE, password: 'Staff@123' });
    expect(login.status).toBe(200);
    const staffToken = login.body.data.tokens.accessToken as string;

    const res = await request(app)
      .get(`/api/v1/vendors/${ownerA.vendorId}/staff`)
      .set('Authorization', `Bearer ${staffToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error.correlationId).toBeTruthy();
  });

  it('DELETE /staff/:staffId — owner soft-removes staff (200 + summary)', async () => {
    const res = await request(app)
      .delete(`/api/v1/vendors/${ownerA.vendorId}/staff/${staffId}`)
      .set('Authorization', `Bearer ${ownerA.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('REMOVED');
    expect(res.body.data.removedAt).toBeTruthy();
  });

  it('accept-invite — unknown token → 404 with correlationId', async () => {
    const res = await request(app)
      .post('/api/v1/auth/accept-invite')
      .send({ token: 'definitely-not-a-real-token', password: 'Whatever1' });
    expect(res.status).toBe(404);
    expect(res.body.error.correlationId).toBeTruthy();
  });

  it('unauthenticated request → 401', async () => {
    const res = await request(app).get(`/api/v1/vendors/${ownerA.vendorId}/role`);
    expect(res.status).toBe(401);
  });
});
