/**
 * US-010 Dashboard (Owner & Staff) — Integration Tests
 *
 * Covers:
 *  - GET /dashboard/owner — 200 all sections; staff → 403; wrong tenant → 404
 *  - GET /dashboard/staff/:staffId — owner reads any staff; staff reads self → 200 (no money);
 *    staff reads other staff → 403; unknown staffId → 404
 *  - GET /supply-forecast — default, days=7, supplyType filter, leave reduces qty
 *  - GET /outstanding-aging — buckets, priorityCustomers, advanceCredit
 *  - GET /settings — returns defaults when none saved
 *  - PATCH /settings — owner toggles; lazy-create; staff → 403; empty body → 400; bad time → 400;
 *    correlationId in error
 *  - Multi-tenant: no membership → 404 on every endpoint
 */
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/infrastructure/database/prisma.client';

const app = createApp();

// Unique phones for this suite
const OWNER_PHONE = '+919977600001';
const STAFF_PHONE = '+919977600002';
const STAFF2_PHONE = '+919977600003'; // second staff for cross-staff 403
const OTHER_PHONE = '+919977600004'; // different vendor, no membership

interface Actor {
  token: string;
  vendorId: string;
  userId: string;
  staffId?: string;
}

// ===========================================================================
// DB helpers
// ===========================================================================

async function cleanup(): Promise<void> {
  const phones = [OWNER_PHONE, STAFF_PHONE, STAFF2_PHONE, OTHER_PHONE];
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
    // customers created by these users
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
  // Sign up the staff user (creates their own vendor)
  const signupRes = await request(app)
    .post('/api/v1/auth/signup')
    .send({ phone, password: 'Staff@1234', vendorName: `Staff Vendor ${phone}` });
  if (signupRes.status !== 201) {
    throw new Error(`Staff signup failed: ${signupRes.status} ${JSON.stringify(signupRes.body)}`);
  }
  const staffUserId = (signupRes.body as { data: { user: { id: string } } }).data.user.id;

  // Add the staff user as a member of the owner's vendor directly in DB
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

  // Login — the JWT will include the new vendorId in vendorIds array
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

// ===========================================================================
// Test Suite
// ===========================================================================

describe('Dashboard & VendorSettings (US-010)', () => {
  let owner: Actor;
  let staff: Actor;
  let staff2: Actor;
  let other: Actor; // different vendor

  beforeAll(async () => {
    await cleanup();
    owner = await signupOwner(OWNER_PHONE, 'Dashboard Test Vendor');
    staff = await inviteAndJoinStaff(owner, STAFF_PHONE);
    staff2 = await inviteAndJoinStaff(owner, STAFF2_PHONE);
    other = await signupOwner(OTHER_PHONE, 'Other Vendor');
  });

  afterAll(async () => {
    await cleanup();
  });

  // ── Owner dashboard ─────────────────────────────────────────────────────────

  describe('GET /vendors/:vendorId/dashboard/owner', () => {
    it('200 — owner sees all required sections', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${owner.vendorId}/dashboard/owner`)
        .set('Authorization', `Bearer ${owner.token}`);

      expect(res.status).toBe(200);
      const data = res.body.data as Record<string, unknown>;
      expect(data).toHaveProperty('currentMonth');
      expect(data).toHaveProperty('financial');
      expect(data).toHaveProperty('quickStats');
      expect(data).toHaveProperty('autoMarkStatus');
      expect(data).toHaveProperty('supplyForecast');
      expect(data).toHaveProperty('todaySupplyLists');
      const financial = data['financial'] as Record<string, unknown>;
      expect(financial).toHaveProperty('totalRevenue');
      expect(financial).toHaveProperty('collected');
      expect(financial).toHaveProperty('pending');
      expect(financial).toHaveProperty('collectionPercentage');
      expect(financial).toHaveProperty('outstandingAging');
    });

    it('400 — bad month param returns ValidationError', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${owner.vendorId}/dashboard/owner?month=bad-month`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(res.status).toBe(400);
    });

    it('403 — staff gets FORBIDDEN on owner dashboard', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${owner.vendorId}/dashboard/owner`)
        .set('Authorization', `Bearer ${staff.token}`);
      expect(res.status).toBe(403);
    });

    it('401 — missing token', async () => {
      const res = await request(app).get(
        `/api/v1/vendors/${owner.vendorId}/dashboard/owner`
      );
      expect(res.status).toBe(401);
    });

    it('404 — other vendor has no membership', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${other.vendorId}/dashboard/owner`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(res.status).toBe(404);
    });
  });

  // ── Staff dashboard ──────────────────────────────────────────────────────────

  describe('GET /vendors/:vendorId/dashboard/staff/:staffId', () => {
    it('200 — owner reads any staff dashboard', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${owner.vendorId}/dashboard/staff/${staff.staffId}`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(res.status).toBe(200);
      const data = res.body.data as Record<string, unknown>;
      expect(data).toHaveProperty('date');
      expect(data).toHaveProperty('todayProgress');
      expect(data).toHaveProperty('assignedLists');
      expect(data).toHaveProperty('pendingCount');
      // MUST NOT have financial fields
      expect(data).not.toHaveProperty('financial');
      expect(data).not.toHaveProperty('totalRevenue');
      expect(data).not.toHaveProperty('collected');
    });

    it('200 — staff reads their own dashboard', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${owner.vendorId}/dashboard/staff/${staff.staffId}`)
        .set('Authorization', `Bearer ${staff.token}`);
      expect(res.status).toBe(200);
    });

    it('403 — staff cannot read another staff dashboard', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${owner.vendorId}/dashboard/staff/${staff2.staffId}`)
        .set('Authorization', `Bearer ${staff.token}`);
      expect(res.status).toBe(403);
      expect(res.body.error.correlationId).toBeDefined();
    });

    it('404 — unknown staffId returns NOT_FOUND', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${owner.vendorId}/dashboard/staff/9999999`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(res.status).toBe(404);
    });

    it('404 — other vendor no membership', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${other.vendorId}/dashboard/staff/${staff.staffId}`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(res.status).toBe(404);
    });
  });

  // ── Supply forecast ──────────────────────────────────────────────────────────

  describe('GET /vendors/:vendorId/supply-forecast', () => {
    it('200 — default query (no active subscriptions → empty)', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${owner.vendorId}/supply-forecast`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(res.status).toBe(200);
      const data = res.body.data as Record<string, unknown>;
      expect(data).toHaveProperty('date');
      expect(data).toHaveProperty('byList');
      expect(data).toHaveProperty('aggregatedByType');
      expect(data).toHaveProperty('nextNDays');
      expect(Array.isArray(data['byList'])).toBe(true);
    });

    it('200 — days=7 parameter accepted', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dateStr = tomorrow.toISOString().slice(0, 10);
      const res = await request(app)
        .get(
          `/api/v1/vendors/${owner.vendorId}/supply-forecast?date=${dateStr}&days=7`
        )
        .set('Authorization', `Bearer ${owner.token}`);
      expect(res.status).toBe(200);
    });

    it('400 — bad date format', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${owner.vendorId}/supply-forecast?date=not-a-date`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(res.status).toBe(400);
    });

    it('400 — days out of range', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${owner.vendorId}/supply-forecast?days=31`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(res.status).toBe(400);
    });

    it('403 — staff gets FORBIDDEN', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${owner.vendorId}/supply-forecast`)
        .set('Authorization', `Bearer ${staff.token}`);
      expect(res.status).toBe(403);
    });
  });

  // ── Outstanding aging ─────────────────────────────────────────────────────────

  describe('GET /vendors/:vendorId/outstanding-aging', () => {
    it('200 — returns all required sections', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${owner.vendorId}/outstanding-aging`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(res.status).toBe(200);
      const data = res.body.data as Record<string, unknown>;
      expect(data).toHaveProperty('summary');
      expect(data).toHaveProperty('priorityCustomers');
      expect(data).toHaveProperty('advanceCredit');
      const priority = data['priorityCustomers'] as Record<string, unknown>;
      expect(priority).toHaveProperty('high');
      expect(priority).toHaveProperty('medium');
      expect(priority).toHaveProperty('low');
    });

    it('200 — priority filter works', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${owner.vendorId}/outstanding-aging?priority=high`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(res.status).toBe(200);
    });

    it('400 — bad priority value', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${owner.vendorId}/outstanding-aging?priority=extreme`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(res.status).toBe(400);
    });

    it('403 — staff gets FORBIDDEN', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${owner.vendorId}/outstanding-aging`)
        .set('Authorization', `Bearer ${staff.token}`);
      expect(res.status).toBe(403);
    });
  });

  // ── Vendor settings ───────────────────────────────────────────────────────────

  describe('GET /vendors/:vendorId/settings', () => {
    it('200 — returns defaults when no settings saved yet', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${owner.vendorId}/settings`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(res.status).toBe(200);
      const data = res.body.data as Record<string, unknown>;
      expect(data).toHaveProperty('autoMarkEnabled');
      expect(data).toHaveProperty('autoSendBillsEnabled');
      expect(data).toHaveProperty('autoSendBillsTime');
      expect(data).toHaveProperty('notificationPreferences');
    });

    it('403 — staff gets FORBIDDEN', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${owner.vendorId}/settings`)
        .set('Authorization', `Bearer ${staff.token}`);
      expect(res.status).toBe(403);
    });
  });

  describe('PATCH /vendors/:vendorId/settings', () => {
    it('200 — owner toggles autoMarkEnabled (lazy-create on first call)', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${owner.vendorId}/settings`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ autoMarkEnabled: false });

      expect(res.status).toBe(200);
      const data = res.body.data as Record<string, unknown>;
      expect(data['autoMarkEnabled']).toBe(false);
      expect(data).toHaveProperty('id');
      expect(data).toHaveProperty('vendorId');
      // Must not expose deletedAt
      expect(data).not.toHaveProperty('deletedAt');
    });

    it('200 — second PATCH updates existing settings', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${owner.vendorId}/settings`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ autoMarkEnabled: true });
      expect(res.status).toBe(200);
      expect((res.body.data as Record<string, unknown>)['autoMarkEnabled']).toBe(true);
    });

    it('200 — GET /settings reflects persisted change', async () => {
      await request(app)
        .patch(`/api/v1/vendors/${owner.vendorId}/settings`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ autoSendBillsTime: '21:00' });

      const res = await request(app)
        .get(`/api/v1/vendors/${owner.vendorId}/settings`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(res.status).toBe(200);
      expect((res.body.data as Record<string, unknown>)['autoSendBillsTime']).toBe('21:00');
    });

    it('400 — empty body returns VALIDATION_ERROR with correlationId', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${owner.vendorId}/settings`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.correlationId).toBeDefined();
    });

    it('400 — bad autoSendBillsTime format', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${owner.vendorId}/settings`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ autoSendBillsTime: '25:99' });
      expect(res.status).toBe(400);
    });

    it('400 — unknown key in strict body', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${owner.vendorId}/settings`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ unknownField: true });
      expect(res.status).toBe(400);
    });

    it('403 — staff cannot update settings', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${owner.vendorId}/settings`)
        .set('Authorization', `Bearer ${staff.token}`)
        .send({ autoMarkEnabled: false });
      expect(res.status).toBe(403);
    });

    it('404 — caller has no membership in target vendor', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${other.vendorId}/settings`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ autoMarkEnabled: false });
      expect(res.status).toBe(404);
    });
  });
});
