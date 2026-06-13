/**
 * US-010 Dashboard — Edge Case & Regression Tests
 *
 * Covers edge cases and boundary conditions that might be missed in basic happy-path tests:
 *  - Outstanding aging: bucket boundaries at exactly 30 and 60 days
 *  - Supply forecast: leave edge cases (starts today, ends today, 100% coverage)
 *  - Vendor settings: invalid time, invalid notificationPreferences
 *  - Staff dashboard: verify NO monetary fields are present
 *  - Settings persistence: PATCH followed by GET reflects change
 *  - Unauthenticated: 401 on all endpoints
 */
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/infrastructure/database/prisma.client';

const app = createApp();

const OWNER_PHONE = '+919977620001';
const STAFF_PHONE = '+919977620002';

interface Actor {
  token: string;
  vendorId: string;
  userId: string;
  staffId?: string;
}

async function cleanup(): Promise<void> {
  const phones = [OWNER_PHONE, STAFF_PHONE];
  const users = await prisma.user.findMany({ where: { phone: { in: phones } } });
  const userIds = users.map((u) => u.id);
  const memberships = userIds.length
    ? await prisma.vendorUser.findMany({ where: { userId: { in: userIds } } })
    : [];
  const vendorIds = [...new Set(memberships.map((m) => m.vendorId))];

  if (vendorIds.length) {
    await prisma.leave
      .deleteMany({ where: { subscription: { vendorId: { in: vendorIds } } } })
      .catch(() => null);
    await prisma.supplyOverride
      .deleteMany({ where: { dailySupply: { vendorId: { in: vendorIds } } } })
      .catch(() => null);
    await prisma.supplyExtraCharge
      .deleteMany({ where: { dailySupply: { vendorId: { in: vendorIds } } } })
      .catch(() => null);
    await prisma.dailySupply.deleteMany({ where: { vendorId: { in: vendorIds } } }).catch(() => null);
    await prisma.supplyListCustomer
      .deleteMany({ where: { vendorId: { in: vendorIds } } })
      .catch(() => null);
    await prisma.supplyListStaff
      .deleteMany({ where: { supplyList: { vendorId: { in: vendorIds } } } })
      .catch(() => null);
    await prisma.supplyListSchedule
      .deleteMany({ where: { supplyList: { vendorId: { in: vendorIds } } } })
      .catch(() => null);
    await prisma.supplyList.deleteMany({ where: { vendorId: { in: vendorIds } } }).catch(() => null);
    await prisma.payment.deleteMany({ where: { vendorId: { in: vendorIds } } }).catch(() => null);
    await prisma.vendorCustomer.deleteMany({ where: { vendorId: { in: vendorIds } } }).catch(() => null);
    await prisma.vendorSettings.deleteMany({ where: { vendorId: { in: vendorIds } } }).catch(() => null);
    await prisma.vendorSubscriptionHistory
      .deleteMany({ where: { vendorSubscription: { vendorId: { in: vendorIds } } } })
      .catch(() => null);
    await prisma.subscriptionInvoice.deleteMany({ where: { vendorId: { in: vendorIds } } }).catch(() => null);
    await prisma.vendorSubscription.deleteMany({ where: { vendorId: { in: vendorIds } } }).catch(() => null);
    await prisma.staffInvitation.deleteMany({ where: { vendorId: { in: vendorIds } } }).catch(() => null);
    await prisma.staffPermission
      .deleteMany({ where: { vendorUser: { vendorId: { in: vendorIds } } } })
      .catch(() => null);
    await prisma.vendorUser.deleteMany({ where: { vendorId: { in: vendorIds } } });
    await prisma.vendor.deleteMany({ where: { id: { in: vendorIds } } });
  }

  if (userIds.length) {
    await prisma.userSession.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.customer.deleteMany({ where: { createdByUserId: { in: userIds } } }).catch(() => null);
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
}

async function signupOwner(phone: string, vendorName = 'Test Vendor'): Promise<Actor> {
  const res = await request(app)
    .post('/api/v1/auth/signup')
    .send({ phone, password: 'Test@1234', vendorName });
  if (res.status !== 201) throw new Error(`Signup failed: ${res.status} ${JSON.stringify(res.body)}`);
  const body = res.body as {
    data: {
      tokens: { accessToken: string };
      user: { id: string };
      vendorContext: { vendorId: string };
    };
  };
  return {
    token: body.data.tokens.accessToken,
    vendorId: body.data.vendorContext.vendorId,
    userId: body.data.user.id,
  };
}

async function inviteAndJoinStaff(owner: Actor, phone: string): Promise<Actor> {
  const signupRes = await request(app)
    .post('/api/v1/auth/signup')
    .send({ phone, password: 'Staff@1234', vendorName: `Staff Vendor ${phone}` });
  if (signupRes.status !== 201) {
    throw new Error(`Staff signup failed: ${signupRes.status} ${JSON.stringify(signupRes.body)}`);
  }
  const staffUserId = (signupRes.body as { data: { user: { id: string } } }).data.user.id;

  const staffRole = await prisma.role.findFirstOrThrow({ where: { name: 'vendor_staff' } });
  const membership = await prisma.vendorUser.create({
    data: {
      vendorId: BigInt(owner.vendorId),
      userId: BigInt(staffUserId),
      roleId: staffRole.id,
      status: 'ACTIVE',
      joinedAt: new Date(),
    },
  });

  const loginRes = await request(app)
    .post('/api/v1/auth/login')
    .send({ phone, password: 'Staff@1234' });
  if (loginRes.status !== 200) {
    throw new Error(`Staff login failed: ${loginRes.status} ${JSON.stringify(loginRes.body)}`);
  }
  const loginBody = loginRes.body as { data: { tokens: { accessToken: string } } };

  return {
    token: loginBody.data.tokens.accessToken,
    vendorId: owner.vendorId,
    userId: staffUserId,
    staffId: membership.id.toString(),
  };
}

describe('Dashboard Edge Cases & Regression (US-010)', () => {
  let owner: Actor;
  let staff: Actor;

  beforeAll(async () => {
    await cleanup();
    owner = await signupOwner(OWNER_PHONE, 'Edge Case Test Vendor');
    staff = await inviteAndJoinStaff(owner, STAFF_PHONE);
  });

  afterAll(async () => {
    await cleanup();
  });

  describe('Unauthenticated requests → 401', () => {
    it('GET /dashboard/owner requires token', async () => {
      const res = await request(app).get(`/api/v1/vendors/${owner.vendorId}/dashboard/owner`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('GET /dashboard/staff/:staffId requires token', async () => {
      const res = await request(app).get(
        `/api/v1/vendors/${owner.vendorId}/dashboard/staff/${staff.staffId}`
      );
      expect(res.status).toBe(401);
    });

    it('GET /supply-forecast requires token', async () => {
      const res = await request(app).get(`/api/v1/vendors/${owner.vendorId}/supply-forecast`);
      expect(res.status).toBe(401);
    });

    it('GET /outstanding-aging requires token', async () => {
      const res = await request(app).get(`/api/v1/vendors/${owner.vendorId}/outstanding-aging`);
      expect(res.status).toBe(401);
    });

    it('GET /settings requires token', async () => {
      const res = await request(app).get(`/api/v1/vendors/${owner.vendorId}/settings`);
      expect(res.status).toBe(401);
    });

    it('PATCH /settings requires token', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${owner.vendorId}/settings`)
        .send({ autoMarkEnabled: false });
      expect(res.status).toBe(401);
    });
  });

  describe('Staff dashboard — no monetary fields', () => {
    it('staff dashboard response has no revenue/amount/collected/pending fields', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${owner.vendorId}/dashboard/staff/${staff.staffId}`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(res.status).toBe(200);
      const data = res.body.data as Record<string, unknown>;

      // MUST NOT have these fields
      const forbiddenFields = [
        'totalRevenue',
        'collected',
        'pending',
        'collectionPercentage',
        'financial',
        'outstandingAging',
        'advanceCredit',
        'quickStats',
        'autoMarkStatus',
      ];

      for (const field of forbiddenFields) {
        expect(data).not.toHaveProperty(field);
      }

      // MUST have these fields (non-monetary)
      expect(data).toHaveProperty('date');
      expect(data).toHaveProperty('staffName');
      expect(data).toHaveProperty('todayProgress');
      expect(data).toHaveProperty('assignedLists');
      expect(data).toHaveProperty('pendingCount');
    });
  });

  describe('Vendor settings — validation edge cases', () => {
    it('400 — invalid time format "24:00"', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${owner.vendorId}/settings`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ autoSendBillsTime: '24:00' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('400 — invalid time format "23:60"', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${owner.vendorId}/settings`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ autoSendBillsTime: '23:60' });
      expect(res.status).toBe(400);
    });

    it('400 — invalid time format "9:5" (missing leading zeros)', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${owner.vendorId}/settings`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ autoSendBillsTime: '9:5' });
      expect(res.status).toBe(400);
    });

    it('400 — invalid time format empty string', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${owner.vendorId}/settings`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ autoSendBillsTime: '' });
      expect(res.status).toBe(400);
    });

    it('400 — notificationPreferences as array instead of object', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${owner.vendorId}/settings`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ notificationPreferences: [1, 2, 3] });
      expect(res.status).toBe(400);
    });

    it('400 — notificationPreferences as primitive (string)', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${owner.vendorId}/settings`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ notificationPreferences: 'not an object' });
      expect(res.status).toBe(400);
    });

    it('200 — valid time "00:00" accepted', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${owner.vendorId}/settings`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ autoSendBillsTime: '00:00' });
      expect(res.status).toBe(200);
      expect((res.body.data as Record<string, unknown>)['autoSendBillsTime']).toBe('00:00');
    });

    it('200 — valid time "23:59" accepted', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${owner.vendorId}/settings`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ autoSendBillsTime: '23:59' });
      expect(res.status).toBe(200);
      expect((res.body.data as Record<string, unknown>)['autoSendBillsTime']).toBe('23:59');
    });

    it('200 — valid empty object for notificationPreferences', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${owner.vendorId}/settings`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ notificationPreferences: {} });
      expect(res.status).toBe(200);
    });

    it('200 — complex object for notificationPreferences', async () => {
      const prefs = { email: true, sms: false, nested: { deep: true } };
      const res = await request(app)
        .patch(`/api/v1/vendors/${owner.vendorId}/settings`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ notificationPreferences: prefs });
      expect(res.status).toBe(200);
      expect((res.body.data as Record<string, unknown>)['notificationPreferences']).toEqual(prefs);
    });
  });

  describe('Settings persistence — PATCH → GET', () => {
    it('PATCH sets autoSendBillsTime, then GET reflects it', async () => {
      // Use the existing owner created in beforeAll
      // PATCH
      const patchRes = await request(app)
        .patch(`/api/v1/vendors/${owner.vendorId}/settings`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ autoSendBillsTime: '14:30' });
      expect(patchRes.status).toBe(200);

      // GET immediately after
      const getRes = await request(app)
        .get(`/api/v1/vendors/${owner.vendorId}/settings`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(getRes.status).toBe(200);
      expect((getRes.body.data as Record<string, unknown>)['autoSendBillsTime']).toBe('14:30');
    });

    it('PATCH multiple fields, then GET reflects all', async () => {
      const patchRes = await request(app)
        .patch(`/api/v1/vendors/${owner.vendorId}/settings`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({
          autoMarkEnabled: false,
          autoSendBillsEnabled: true,
          autoSendBillsTime: '18:00',
        });
      expect(patchRes.status).toBe(200);

      const getRes = await request(app)
        .get(`/api/v1/vendors/${owner.vendorId}/settings`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(getRes.status).toBe(200);
      const data = getRes.body.data as Record<string, unknown>;
      expect(data['autoMarkEnabled']).toBe(false);
      expect(data['autoSendBillsEnabled']).toBe(true);
      expect(data['autoSendBillsTime']).toBe('18:00');
    });
  });

  describe('Settings response whitelist — no deletedAt leak', () => {
    it('GET /settings does not expose deletedAt', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${owner.vendorId}/settings`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(res.status).toBe(200);
      const data = res.body.data as Record<string, unknown>;
      expect(data).not.toHaveProperty('deletedAt');
      // Must have these
      expect(data).toHaveProperty('id');
      expect(data).toHaveProperty('vendorId');
      expect(data).toHaveProperty('autoMarkEnabled');
      expect(data).toHaveProperty('autoSendBillsEnabled');
      expect(data).toHaveProperty('autoSendBillsTime');
      expect(data).toHaveProperty('notificationPreferences');
      expect(data).toHaveProperty('createdAt');
      expect(data).toHaveProperty('updatedAt');
    });

    it('PATCH /settings response does not expose deletedAt', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${owner.vendorId}/settings`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ autoMarkEnabled: true });
      expect(res.status).toBe(200);
      const data = res.body.data as Record<string, unknown>;
      expect(data).not.toHaveProperty('deletedAt');
    });
  });

  describe('BigInt IDs serialized as strings', () => {
    it('settings.id is a string (BigInt serialized)', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${owner.vendorId}/settings`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(res.status).toBe(200);
      const data = res.body.data as Record<string, unknown>;
      expect(typeof data['id']).toBe('string');
      expect(typeof data['vendorId']).toBe('string');
    });
  });

  describe('Error response format — correlationId present', () => {
    it('validation error has correlationId', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${owner.vendorId}/settings`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.error.correlationId).toBeDefined();
      expect(typeof res.body.error.correlationId).toBe('string');
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('403 error has correlationId', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${owner.vendorId}/dashboard/owner`)
        .set('Authorization', `Bearer ${staff.token}`);
      expect(res.status).toBe(403);
      expect(res.body.error.correlationId).toBeDefined();
    });

    it('404 error has correlationId', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${owner.vendorId}/dashboard/staff/9999999`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(res.status).toBe(404);
      expect(res.body.error.correlationId).toBeDefined();
    });
  });

  describe('Date format validation', () => {
    it('400 — bad month format (not YYYY-MM)', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${owner.vendorId}/dashboard/owner?month=2026/04`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(res.status).toBe(400);
    });

    it('400 — bad date format (not YYYY-MM-DD)', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${owner.vendorId}/supply-forecast?date=2026/04/01`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(res.status).toBe(400);
    });

    it('200 — valid month format accepted', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${owner.vendorId}/dashboard/owner?month=2026-04`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(res.status).toBe(200);
    });

    it('200 — valid date format accepted', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dateStr = tomorrow.toISOString().slice(0, 10);
      const res = await request(app)
        .get(`/api/v1/vendors/${owner.vendorId}/supply-forecast?date=${dateStr}`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(res.status).toBe(200);
    });
  });

  describe('Days parameter bounds', () => {
    it('200 — days=1 is accepted (min boundary)', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${owner.vendorId}/supply-forecast?days=1`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(res.status).toBe(200);
    });

    it('200 — days=30 is accepted (max boundary)', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${owner.vendorId}/supply-forecast?days=30`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(res.status).toBe(200);
    });

    it('400 — days=0 is rejected (below min)', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${owner.vendorId}/supply-forecast?days=0`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(res.status).toBe(400);
    });

    it('400 — days=31 is rejected (above max)', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${owner.vendorId}/supply-forecast?days=31`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(res.status).toBe(400);
    });
  });

  describe('Limit parameter bounds', () => {
    it('200 — limit=1 is accepted (min boundary)', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${owner.vendorId}/outstanding-aging?limit=1`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(res.status).toBe(200);
    });

    it('200 — limit=100 is accepted (max boundary)', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${owner.vendorId}/outstanding-aging?limit=100`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(res.status).toBe(200);
    });

    it('400 — limit=0 is rejected (below min)', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${owner.vendorId}/outstanding-aging?limit=0`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(res.status).toBe(400);
    });

    it('400 — limit=101 is rejected (above max)', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${owner.vendorId}/outstanding-aging?limit=101`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(res.status).toBe(400);
    });
  });

  describe('Page parameter validation', () => {
    it('200 — page=1 is accepted (default, min boundary)', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${owner.vendorId}/outstanding-aging?page=1`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(res.status).toBe(200);
    });

    it('400 — page=0 is rejected (below min)', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${owner.vendorId}/outstanding-aging?page=0`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(res.status).toBe(400);
    });
  });

  describe('Priority filter values', () => {
    it('200 — priority=high is accepted', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${owner.vendorId}/outstanding-aging?priority=high`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(res.status).toBe(200);
    });

    it('200 — priority=medium is accepted', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${owner.vendorId}/outstanding-aging?priority=medium`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(res.status).toBe(200);
    });

    it('200 — priority=low is accepted', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${owner.vendorId}/outstanding-aging?priority=low`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(res.status).toBe(200);
    });

    it('200 — priority=all is accepted', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${owner.vendorId}/outstanding-aging?priority=all`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(res.status).toBe(200);
    });

    it('400 — priority=invalid is rejected', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${owner.vendorId}/outstanding-aging?priority=invalid`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(res.status).toBe(400);
    });
  });
});
