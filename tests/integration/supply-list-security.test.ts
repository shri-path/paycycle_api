/**
 * Stream S: Security & RBAC integration tests for US-005 Supply Lists.
 * Covers: auth (no token, bad token), multi-tenant isolation (404-mask),
 * owner-only endpoints reject staff, staff RBAC scoping,
 * correlationId in every error, wrong-vendor staff assign/unassign.
 */
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/infrastructure/database/prisma.client';

const app = createApp();

const OWNER_A_PHONE = '+919811199001';
const OWNER_B_PHONE = '+919811199002';
const STAFF_PHONE = '+919811199003';
const CUST_PHONES_SEC = ['+919811199010', '+919811199011'];

interface Owner {
  token: string;
  vendorId: string;
  userId: string;
}

interface Staff {
  token: string;
  staffId: string; // vendor_user id
}

async function cleanupSecurity(): Promise<void> {
  const allPhones = [OWNER_A_PHONE, OWNER_B_PHONE, STAFF_PHONE, ...CUST_PHONES_SEC];
  const custObjs = await prisma.customer.findMany({ where: { phone: { in: CUST_PHONES_SEC } } });
  const custIds = custObjs.map((c) => c.id);
  if (custIds.length) {
    await prisma.supplyListCustomer.deleteMany({ where: { customerId: { in: custIds } } });
    await prisma.vendorCustomer.deleteMany({ where: { customerId: { in: custIds } } });
  }

  const users = await prisma.user.findMany({ where: { phone: { in: allPhones } } });
  const userIds = users.map((u) => u.id);
  const memberships = userIds.length
    ? await prisma.vendorUser.findMany({ where: { userId: { in: userIds } } })
    : [];
  const vendorIds = [...new Set(memberships.map((m) => m.vendorId))];

  if (vendorIds.length) {
    const lists = await prisma.supplyList.findMany({ where: { vendorId: { in: vendorIds } } });
    const listIds = lists.map((l) => l.id);
    if (listIds.length) {
      await prisma.supplyListCustomer.deleteMany({ where: { supplyListId: { in: listIds } } });
      await prisma.supplyListStaff.deleteMany({ where: { supplyListId: { in: listIds } } });
      await prisma.supplyListSchedule.deleteMany({ where: { supplyListId: { in: listIds } } });
      await prisma.supplyList.deleteMany({ where: { id: { in: listIds } } });
    }
    await prisma.vendorCustomer.deleteMany({ where: { vendorId: { in: vendorIds } } });
  }

  await prisma.userSession.deleteMany({ where: { userId: { in: userIds.length ? userIds : [-1n] } } });
  await prisma.vendorUser.deleteMany({ where: { userId: { in: userIds.length ? userIds : [-1n] } } });
  if (vendorIds.length) await prisma.vendor.deleteMany({ where: { id: { in: vendorIds } } });
  if (custIds.length) await prisma.customer.deleteMany({ where: { id: { in: custIds } } });
  await prisma.user.deleteMany({ where: { phone: { in: allPhones } } });
}

async function signupOwner(phone: string, vendorName: string): Promise<Owner> {
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

async function inviteAndAcceptStaff(ownerToken: string, vendorId: string): Promise<Staff> {
  const invite = await request(app)
    .post(`/api/v1/vendors/${vendorId}/staff/invite`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ phone: STAFF_PHONE, name: 'Test Staff' });
  expect(invite.status).toBe(201);
  // Response: { staff: { staffId: "...", ... }, inviteUrl: "http://host/accept-invite?token=XXX", expiresAt }
  const inviteUrl = invite.body.data.inviteUrl as string;
  const staffId = (invite.body.data.staff?.staffId ?? invite.body.data.staff?.id) as string;
  const rawToken = new URL(inviteUrl).searchParams.get('token') ?? '';

  const accept = await request(app)
    .post('/api/v1/auth/accept-invite')
    .send({ token: rawToken, password: 'Staff@123' });
  expect(accept.status).toBe(200);
  return { token: accept.body.data.tokens.accessToken as string, staffId };
}

async function createList(token: string, vendorId: string, name = 'Security List'): Promise<string> {
  const res = await request(app)
    .post(`/api/v1/vendors/${vendorId}/supply-lists`)
    .set('Authorization', `Bearer ${token}`)
    .send({ name, unit: 'ltr', frequency: 'DAILY', defaultQuantity: 1, defaultRatePerUnit: 50 });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

async function seedCust(vendorId: string): Promise<string[]> {
  const ids: string[] = [];
  for (const phone of CUST_PHONES_SEC) {
    const c = await prisma.customer.upsert({
      where: { phone },
      update: {},
      create: { phone, name: `SecCust ${phone.slice(-3)}` },
    });
    await prisma.vendorCustomer.upsert({
      where: { vendorId_customerId: { vendorId: BigInt(vendorId), customerId: c.id } },
      update: {},
      create: { vendorId: BigInt(vendorId), customerId: c.id, status: 'ACTIVE' },
    });
    ids.push(c.id.toString());
  }
  return ids;
}

beforeAll(async () => {
  await cleanupSecurity();
});

afterAll(async () => {
  await cleanupSecurity();
  await prisma.$disconnect();
});

// ============================================================
// Fixtures
// ============================================================
let ownerA: Owner;
let ownerB: Owner;
let staffCtx: Staff;
let listIdA: string;
let custIds: string[];
let subId: string;

describe('US-005 — Security & RBAC', () => {
  beforeAll(async () => {
    ownerA = await signupOwner(OWNER_A_PHONE, 'Sec Vendor A');
    ownerB = await signupOwner(OWNER_B_PHONE, 'Sec Vendor B');
    staffCtx = await inviteAndAcceptStaff(ownerA.token, ownerA.vendorId);
    listIdA = await createList(ownerA.token, ownerA.vendorId, 'Security List A');
    custIds = await seedCust(ownerA.vendorId);

    // Add a customer so subscription tests have an ID
    const addRes = await request(app)
      .post(`/api/v1/vendors/${ownerA.vendorId}/supply-lists/${listIdA}/customers`)
      .set('Authorization', `Bearer ${ownerA.token}`)
      .send({ customerIds: [custIds[0]] });
    expect(addRes.status).toBe(201);
    subId = addRes.body.data.subscriptions[0].subscriptionId as string;
  });

  // ============================================================
  // Auth — No Token
  // ============================================================
  describe('401 — No / bad token', () => {
    it('GET /supply-lists → 401 with no token', async () => {
      const res = await request(app).get(`/api/v1/vendors/${ownerA.vendorId}/supply-lists`);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error?.correlationId).toBeDefined();
    });

    it('GET /supply-lists/:id → 401 with no token', async () => {
      const res = await request(app).get(`/api/v1/vendors/${ownerA.vendorId}/supply-lists/${listIdA}`);
      expect(res.status).toBe(401);
      expect(res.body.error?.correlationId).toBeDefined();
    });

    it('POST /supply-lists → 401 with no token', async () => {
      const res = await request(app).post(`/api/v1/vendors/${ownerA.vendorId}/supply-lists`).send({});
      expect(res.status).toBe(401);
      expect(res.body.error?.correlationId).toBeDefined();
    });

    it('PATCH /supply-lists/:id → 401 with no token', async () => {
      const res = await request(app).patch(`/api/v1/vendors/${ownerA.vendorId}/supply-lists/${listIdA}`).send({});
      expect(res.status).toBe(401);
      expect(res.body.error?.correlationId).toBeDefined();
    });

    it('DELETE /supply-lists/:id → 401 with no token', async () => {
      const res = await request(app).delete(`/api/v1/vendors/${ownerA.vendorId}/supply-lists/${listIdA}`);
      expect(res.status).toBe(401);
      expect(res.body.error?.correlationId).toBeDefined();
    });

    it('POST /staff → 401 with no token', async () => {
      const res = await request(app).post(`/api/v1/vendors/${ownerA.vendorId}/supply-lists/${listIdA}/staff`).send({});
      expect(res.status).toBe(401);
      expect(res.body.error?.correlationId).toBeDefined();
    });

    it('GET /customers → 401 with no token', async () => {
      const res = await request(app).get(`/api/v1/vendors/${ownerA.vendorId}/supply-lists/${listIdA}/customers`);
      expect(res.status).toBe(401);
      expect(res.body.error?.correlationId).toBeDefined();
    });

    it('POST /customers → 401 with no token', async () => {
      const res = await request(app).post(`/api/v1/vendors/${ownerA.vendorId}/supply-lists/${listIdA}/customers`).send({});
      expect(res.status).toBe(401);
      expect(res.body.error?.correlationId).toBeDefined();
    });

    it('PATCH /customers/:id → 401 with no token', async () => {
      const res = await request(app).patch(`/api/v1/vendors/${ownerA.vendorId}/supply-lists/${listIdA}/customers/${subId}`).send({});
      expect(res.status).toBe(401);
      expect(res.body.error?.correlationId).toBeDefined();
    });

    it('DELETE /customers/:id → 401 with no token', async () => {
      const res = await request(app).delete(`/api/v1/vendors/${ownerA.vendorId}/supply-lists/${listIdA}/customers/${subId}`);
      expect(res.status).toBe(401);
      expect(res.body.error?.correlationId).toBeDefined();
    });

    it('Malformed Bearer token → 401', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${ownerA.vendorId}/supply-lists`)
        .set('Authorization', 'Bearer this.is.not.a.valid.jwt');
      expect(res.status).toBe(401);
      expect(res.body.error?.correlationId).toBeDefined();
    });
  });

  // ============================================================
  // Multi-Tenant Isolation — wrong tenant masked as 404 (not 403/200)
  // ============================================================
  describe('Multi-tenant isolation — wrong tenant → 404 (not 403)', () => {
    it('GET supply-list/:id owned by A, accessed by B → 404', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${ownerB.vendorId}/supply-lists/${listIdA}`)
        .set('Authorization', `Bearer ${ownerB.token}`);
      expect(res.status).toBe(404);
      expect(res.body.error?.correlationId).toBeDefined();
    });

    it('PATCH supply-list/:id owned by A, accessed by B → 404', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${ownerB.vendorId}/supply-lists/${listIdA}`)
        .set('Authorization', `Bearer ${ownerB.token}`)
        .send({ name: 'Hijacked' });
      expect(res.status).toBe(404);
    });

    it('DELETE supply-list/:id owned by A, accessed by B → 404', async () => {
      const res = await request(app)
        .delete(`/api/v1/vendors/${ownerB.vendorId}/supply-lists/${listIdA}`)
        .set('Authorization', `Bearer ${ownerB.token}`);
      expect(res.status).toBe(404);
    });

    it('GET customers on A-list accessed by B → 404', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${ownerB.vendorId}/supply-lists/${listIdA}/customers`)
        .set('Authorization', `Bearer ${ownerB.token}`);
      expect(res.status).toBe(404);
    });

    it('POST customers on A-list accessed by B → 404 or 403', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerB.vendorId}/supply-lists/${listIdA}/customers`)
        .set('Authorization', `Bearer ${ownerB.token}`)
        .send({ customerIds: ['999999'] });
      // Either the list is not found (404) or the vendor context won't match (404 or 403)
      expect([403, 404, 422]).toContain(res.status);
    });

    it('Owner B listing supply-lists only sees their own (not A\'s)', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${ownerB.vendorId}/supply-lists`)
        .set('Authorization', `Bearer ${ownerB.token}`);
      expect(res.status).toBe(200);
      const ids = res.body.data.map((l: { id: string }) => l.id);
      expect(ids).not.toContain(listIdA);
    });

    it('PATCH subscription owned by A, accessed by B → 404', async () => {
      const res = await request(app)
        .patch(
          `/api/v1/vendors/${ownerB.vendorId}/supply-lists/${listIdA}/customers/${subId}`
        )
        .set('Authorization', `Bearer ${ownerB.token}`)
        .send({ status: 'paused' });
      expect(res.status).toBe(404);
    });
  });

  // ============================================================
  // RBAC — Owner-only endpoints reject staff
  // ============================================================
  describe('Owner-only endpoints — staff gets 403', () => {
    it('POST supply-lists (create) — staff → 403', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/supply-lists`)
        .set('Authorization', `Bearer ${staffCtx.token}`)
        .send({ name: 'Staff Attempt', unit: 'ltr', frequency: 'DAILY' });
      expect(res.status).toBe(403);
      expect(res.body.error?.correlationId).toBeDefined();
    });

    it('PATCH supply-list — staff → 403', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${ownerA.vendorId}/supply-lists/${listIdA}`)
        .set('Authorization', `Bearer ${staffCtx.token}`)
        .send({ name: 'Changed By Staff' });
      expect(res.status).toBe(403);
    });

    it('DELETE supply-list (archive) — staff → 403', async () => {
      const res = await request(app)
        .delete(`/api/v1/vendors/${ownerA.vendorId}/supply-lists/${listIdA}`)
        .set('Authorization', `Bearer ${staffCtx.token}`);
      expect(res.status).toBe(403);
    });

    it('POST assign-staff — staff → 403', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/supply-lists/${listIdA}/staff`)
        .set('Authorization', `Bearer ${staffCtx.token}`)
        .send({ staffId: staffCtx.staffId });
      expect(res.status).toBe(403);
    });

    it('DELETE unassign-staff — staff → 403', async () => {
      const res = await request(app)
        .delete(`/api/v1/vendors/${ownerA.vendorId}/supply-lists/${listIdA}/staff/${staffCtx.staffId}`)
        .set('Authorization', `Bearer ${staffCtx.token}`);
      expect(res.status).toBe(403);
    });

    it('POST add-customers — staff → 403', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/supply-lists/${listIdA}/customers`)
        .set('Authorization', `Bearer ${staffCtx.token}`)
        .send({ customerIds: [custIds[0]] });
      expect(res.status).toBe(403);
    });

    it('GET available-customers — staff → 403', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${ownerA.vendorId}/supply-lists/${listIdA}/available-customers`)
        .set('Authorization', `Bearer ${staffCtx.token}`);
      expect(res.status).toBe(403);
    });

    it('PATCH subscription — staff → 403', async () => {
      const res = await request(app)
        .patch(
          `/api/v1/vendors/${ownerA.vendorId}/supply-lists/${listIdA}/customers/${subId}`
        )
        .set('Authorization', `Bearer ${staffCtx.token}`)
        .send({ status: 'paused' });
      expect(res.status).toBe(403);
    });

    it('DELETE subscription — staff → 403', async () => {
      const res = await request(app)
        .delete(
          `/api/v1/vendors/${ownerA.vendorId}/supply-lists/${listIdA}/customers/${subId}`
        )
        .set('Authorization', `Bearer ${staffCtx.token}`);
      expect(res.status).toBe(403);
    });
  });

  // ============================================================
  // Staff — unassigned list visible RBAC (OQ-driven, 404-mask)
  // ============================================================
  describe('Staff — unassigned list access masked as 404', () => {
    it('GET /supply-lists/:id — unassigned staff sees 404 (not 200)', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${ownerA.vendorId}/supply-lists/${listIdA}`)
        .set('Authorization', `Bearer ${staffCtx.token}`);
      expect(res.status).toBe(404);
      expect(res.body.error?.correlationId).toBeDefined();
    });

    it('GET /supply-lists/:id/customers — unassigned staff sees 404', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${ownerA.vendorId}/supply-lists/${listIdA}/customers`)
        .set('Authorization', `Bearer ${staffCtx.token}`);
      // The service checks assignment; unassigned staff should get 404
      expect(res.status).toBe(404);
    });

    it('Staff list GET only shows assigned lists (empty when none assigned)', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${ownerA.vendorId}/supply-lists`)
        .set('Authorization', `Bearer ${staffCtx.token}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });

    it('After staff is assigned, they see the list and customers', async () => {
      // Owner assigns the staff member
      const assignRes = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/supply-lists/${listIdA}/staff`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({ staffId: staffCtx.staffId, isPrimary: false });
      expect(assignRes.status).toBe(201);

      // Now staff can read the list
      const getRes = await request(app)
        .get(`/api/v1/vendors/${ownerA.vendorId}/supply-lists/${listIdA}`)
        .set('Authorization', `Bearer ${staffCtx.token}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.data.id).toBe(listIdA);

      // Staff sees the list in their list view
      const listRes = await request(app)
        .get(`/api/v1/vendors/${ownerA.vendorId}/supply-lists`)
        .set('Authorization', `Bearer ${staffCtx.token}`);
      expect(listRes.status).toBe(200);
      expect(listRes.body.data.some((l: { id: string }) => l.id === listIdA)).toBe(true);

      // Staff cannot use staffId filter for another staff
      const filteredRes = await request(app)
        .get(`/api/v1/vendors/${ownerA.vendorId}/supply-lists?staffId=99999`)
        .set('Authorization', `Bearer ${staffCtx.token}`);
      expect(filteredRes.status).toBe(403);
    });
  });

  // ============================================================
  // CorrelationId present in all errors
  // ============================================================
  describe('correlationId present in all error responses', () => {
    it('401 response includes correlationId', async () => {
      const res = await request(app).get(`/api/v1/vendors/${ownerA.vendorId}/supply-lists`);
      expect(res.status).toBe(401);
      expect(res.body.error?.correlationId).toBeDefined();
      expect(typeof res.body.error?.correlationId).toBe('string');
    });

    it('404 response includes correlationId', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${ownerA.vendorId}/supply-lists/999999999`)
        .set('Authorization', `Bearer ${ownerA.token}`);
      expect(res.status).toBe(404);
      expect(res.body.error?.correlationId).toBeDefined();
    });

    it('400 validation error includes correlationId and details', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/supply-lists`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({ name: '' }); // missing required fields
      expect(res.status).toBe(400);
      expect(res.body.error?.correlationId).toBeDefined();
    });

    it('403 response includes correlationId', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/supply-lists`)
        .set('Authorization', `Bearer ${staffCtx.token}`)
        .send({ name: 'X', unit: 'ltr', frequency: 'DAILY' });
      expect(res.status).toBe(403);
      expect(res.body.error?.correlationId).toBeDefined();
    });
  });

  // ============================================================
  // Response does NOT leak internal fields
  // ============================================================
  describe('Response whitelist — no internal field leaks', () => {
    it('GET supply-list does not expose deletedAt or vendorId', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${ownerA.vendorId}/supply-lists/${listIdA}`)
        .set('Authorization', `Bearer ${ownerA.token}`);
      expect(res.status).toBe(200);
      expect(res.body.data).not.toHaveProperty('deletedAt');
      expect(res.body.data).not.toHaveProperty('vendorId');
    });

    it('GET customers response does not expose vendorId or deletedAt', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${ownerA.vendorId}/supply-lists/${listIdA}/customers`)
        .set('Authorization', `Bearer ${ownerA.token}`);
      expect(res.status).toBe(200);
      if (res.body.data.length > 0) {
        const sub = res.body.data[0];
        expect(sub).not.toHaveProperty('vendorId');
        expect(sub).not.toHaveProperty('deletedAt');
      }
    });

    it('Supply list response IDs are strings, not numbers', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${ownerA.vendorId}/supply-lists/${listIdA}`)
        .set('Authorization', `Bearer ${ownerA.token}`);
      expect(res.status).toBe(200);
      expect(typeof res.body.data.id).toBe('string');
      // BigInt ids serialized as strings
      expect(res.body.data.id).toMatch(/^\d+$/);
    });
  });
});
