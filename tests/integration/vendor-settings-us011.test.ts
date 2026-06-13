/**
 * US-011 Vendor Settings & Automation — Comprehensive Integration Tests
 *
 * Covers:
 *  - PATCH /api/v1/vendors/:vendorId/settings (extended with credit/concurrency fields)
 *  - PATCH /api/v1/vendors/:vendorId/notification-preferences
 *  - POST /api/v1/vendors/:vendorId/bulk-operations/mark-leave
 *  - POST /api/v1/vendors/:vendorId/bulk-operations/adjust-rate
 *  - POST /api/v1/vendors/:vendorId/bulk-operations/send-reminders
 *  - GET /api/v1/vendors/:vendorId/bulk-operations/:operationId
 *
 * Edge cases:
 *  - Validation: credit limits, period ranges, concurrency bounds
 *  - Date validation: past dates rejected
 *  - Targeting modes: exclusive (all vs ids)
 *  - Multi-tenant isolation: wrong vendor returns 404
 *  - Auth: staff receives 403, no token gets 401
 *  - Error format: all errors have correlationId
 */
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/infrastructure/database/prisma.client';

const app = createApp();

// Unique phones for this test suite (avoid conflicts with other tests)
const SETTINGS_OWNER_A = '+919988800001';
const SETTINGS_OWNER_B = '+919988800002';
const SETTINGS_STAFF = '+919988800003';

interface Owner {
  token: string;
  vendorId: string;
  userId: string;
  phone: string;
}

// ===========================================================================
// DB Helpers
// ===========================================================================

async function cleanup(): Promise<void> {
  const allPhones = [SETTINGS_OWNER_A, SETTINGS_OWNER_B, SETTINGS_STAFF];
  const users = await prisma.user.findMany({ where: { phone: { in: allPhones } } });
  const userIds = users.map((u) => u.id);
  const memberships = userIds.length
    ? await prisma.vendorUser.findMany({ where: { userId: { in: userIds } } })
    : [];
  const vendorIds = [...new Set(memberships.map((m) => m.vendorId))];

  if (vendorIds.length) {
    // Delete bulk operations
    await prisma.bulkOperationLog.deleteMany({ where: { vendorId: { in: vendorIds } } });
    // Delete vendor settings
    await prisma.vendorSettings.deleteMany({ where: { vendorId: { in: vendorIds } } });
    // Delete leaves, daily supplies, supply list data
    await prisma.leave.deleteMany({
      where: { supplyListCustomer: { supplyList: { vendorId: { in: vendorIds } } } },
    }).catch(() => null);
    await prisma.dailySupply.deleteMany({
      where: { supplyListCustomer: { supplyList: { vendorId: { in: vendorIds } } } },
    }).catch(() => null);
    await prisma.supplyListCustomer.deleteMany({
      where: { supplyList: { vendorId: { in: vendorIds } } },
    }).catch(() => null);
    await prisma.supplyListSchedule.deleteMany({
      where: { supplyList: { vendorId: { in: vendorIds } } },
    }).catch(() => null);
    await prisma.supplyListStaff.deleteMany({
      where: { supplyList: { vendorId: { in: vendorIds } } },
    }).catch(() => null);
    await prisma.supplyList.deleteMany({ where: { vendorId: { in: vendorIds } } });
    // Delete customers and vendor-related data
    await prisma.payment.deleteMany({ where: { vendorId: { in: vendorIds } } }).catch(() => null);
    await prisma.vendorCustomer.deleteMany({ where: { vendorId: { in: vendorIds } } });
    await prisma.staffPermission.deleteMany({
      where: { staffUser: { vendorId: { in: vendorIds } } },
    }).catch(() => null);
    await prisma.staffInvitation.deleteMany({ where: { vendorId: { in: vendorIds } } }).catch(
      () => null
    );
    await prisma.vendorUser.deleteMany({ where: { vendorId: { in: vendorIds } } });
    await prisma.vendor.deleteMany({ where: { id: { in: vendorIds } } });
  }

  await prisma.userSession.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function signupOwner(phone: string, vendorName: string): Promise<Owner> {
  const res = await request(app)
    .post('/api/v1/auth/signup')
    .send({ phone, password: 'Test@1234', vendorName });
  if (res.status !== 201) {
    throw new Error(`Signup failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const body = res.body as {
    data: {
      tokens: { accessToken: string };
      user: { id: string };
      vendorContext: { vendorId: string };
    };
  };
  return {
    token: body.data.tokens.accessToken,
    userId: body.data.user.id,
    vendorId: body.data.vendorContext.vendorId,
    phone,
  };
}

async function signupStaff(phone: string, vendorName: string): Promise<{ token: string; userId: string }> {
  const res = await request(app)
    .post('/api/v1/auth/signup')
    .send({ phone, password: 'Test@1234', vendorName });
  if (res.status !== 201) {
    throw new Error(`Signup failed: ${res.status}`);
  }
  const body = res.body as {
    data: {
      tokens: { accessToken: string };
      user: { id: string };
    };
  };
  return {
    token: body.data.tokens.accessToken,
    userId: body.data.user.id,
  };
}

async function inviteStaffToVendor(ownerToken: string, vendorId: string, staffPhone: string): Promise<void> {
  const res = await request(app)
    .post(`/api/v1/vendors/${vendorId}/staff/invite`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ phone: staffPhone, name: 'Test Staff', areaRouteLabel: 'Area 1' });
  if (res.status !== 201) {
    throw new Error(`Staff invite failed: ${res.status}`);
  }
}

// ===========================================================================
// Test Suite
// ===========================================================================

describe('US-011 Vendor Settings & Automation — Integration Tests', () => {
  let ownerA: Owner;
  let ownerB: Owner;
  let staffToken: string;

  beforeAll(async () => {
    await cleanup();
    ownerA = await signupOwner(SETTINGS_OWNER_A, 'Settings Vendor A');
    ownerB = await signupOwner(SETTINGS_OWNER_B, 'Settings Vendor B');
    const staff = await signupStaff(SETTINGS_STAFF, 'Staff Vendor');
    staffToken = staff.token;

    // Invite staff to ownerA's vendor
    await inviteStaffToVendor(ownerA.token, ownerA.vendorId, SETTINGS_STAFF);
  }, 60000);

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // PATCH /settings — Extended validation tests
  // ──────────────────────────────────────────────────────────────────────────

  describe('PATCH /vendors/:vendorId/settings — Extended validation', () => {
    it('✓ Happy path: update with all new US-011 fields → 200', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${ownerA.vendorId}/settings`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({
          defaultCreditLimit: 5000,
          defaultCreditPeriodDays: 30,
          bulkOperationConcurrencyLimit: 100,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.defaultCreditLimit).toBe(5000);
      expect(res.body.data.defaultCreditPeriodDays).toBe(30);
      expect(res.body.data.bulkOperationConcurrencyLimit).toBe(100);
    });

    it('✓ defaultCreditLimit: 0 is allowed → 200', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${ownerA.vendorId}/settings`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({ defaultCreditLimit: 0 });

      expect(res.status).toBe(200);
      expect(res.body.data.defaultCreditLimit).toBe(0);
    });

    it('✗ defaultCreditLimit: -1 → 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${ownerA.vendorId}/settings`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({ defaultCreditLimit: -1 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.correlationId).toBeDefined();
    });

    it('✗ defaultCreditPeriodDays: 0 → 400', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${ownerA.vendorId}/settings`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({ defaultCreditPeriodDays: 0 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('✗ defaultCreditPeriodDays: 366 → 400', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${ownerA.vendorId}/settings`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({ defaultCreditPeriodDays: 366 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('✗ bulkOperationConcurrencyLimit: 0 → 400', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${ownerA.vendorId}/settings`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({ bulkOperationConcurrencyLimit: 0 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.correlationId).toBeDefined();
    });

    it('✗ bulkOperationConcurrencyLimit: 501 → 400', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${ownerA.vendorId}/settings`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({ bulkOperationConcurrencyLimit: 501 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('✗ Empty body → 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${ownerA.vendorId}/settings`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('✗ Unknown field in body → 400 (strict mode)', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${ownerA.vendorId}/settings`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({ unknownField: 'value', defaultCreditLimit: 1000 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('✗ Staff (not owner) → 403 or 404 FORBIDDEN/NOT_FOUND', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${ownerA.vendorId}/settings`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ defaultCreditLimit: 5000 });

      // Staff that's not a member of this vendor gets masked as 404
      // Staff that is a member but not owner gets 403
      expect([403, 404]).toContain(res.status);
    });

    it('✗ No token → 401 UNAUTHORIZED', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${ownerA.vendorId}/settings`)
        .send({ defaultCreditLimit: 5000 });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('✓ All errors have correlationId', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${ownerA.vendorId}/settings`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({ bulkOperationConcurrencyLimit: -1 });

      expect(res.status).toBe(400);
      expect(res.body.error.correlationId).toBeDefined();
      expect(typeof res.body.error.correlationId).toBe('string');
      expect(res.body.error.correlationId.length).toBeGreaterThan(0);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // PATCH /notification-preferences
  // ──────────────────────────────────────────────────────────────────────────

  describe('PATCH /vendors/:vendorId/notification-preferences', () => {
    it('✓ Happy path: replace prefs blob → 200', async () => {
      const newPrefs = { channels: { push: true, whatsapp: false } };
      const res = await request(app)
        .patch(`/api/v1/vendors/${ownerA.vendorId}/notification-preferences`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({ notificationPreferences: newPrefs });

      expect(res.status).toBe(200);
      expect(res.body.data.notificationPreferences).toEqual(newPrefs);
    });

    it('✗ notificationPreferences is an array → 400', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${ownerA.vendorId}/notification-preferences`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({ notificationPreferences: ['item1', 'item2'] });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('✗ notificationPreferences missing → 400', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${ownerA.vendorId}/notification-preferences`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('✗ Staff → 403 or 404', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${ownerA.vendorId}/notification-preferences`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ notificationPreferences: { channels: { push: true } } });

      expect([403, 404]).toContain(res.status);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // POST /bulk-operations/mark-leave
  // ──────────────────────────────────────────────────────────────────────────

  describe('POST /vendors/:vendorId/bulk-operations/mark-leave', () => {
    it('✓ Happy path: mark-leave with subscriptionIds → 200 COMPLETED', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/bulk-operations/mark-leave`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({
          subscriptionIds: ['1', '2'],
          date: '2026-06-20',
          reason: 'Festival holiday',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('COMPLETED');
      expect(res.body.data.operationId).toBeDefined();
      expect(res.body.data.summary).toBeDefined();
      expect(typeof res.body.data.summary.customersAffected).toBe('number');
      expect(typeof res.body.data.summary.skipped).toBe('number');
    });

    it('✓ Happy path: mark-leave with all: true → 200 COMPLETED', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/bulk-operations/mark-leave`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({
          all: true,
          date: '2026-06-21',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('COMPLETED');
    });

    it('✗ Both subscriptionIds and all: true → 400', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/bulk-operations/mark-leave`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({
          subscriptionIds: ['1'],
          all: true,
          date: '2026-06-20',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.correlationId).toBeDefined();
    });

    it('✗ Neither subscriptionIds nor all: true → 400', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/bulk-operations/mark-leave`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({
          date: '2026-06-20',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('✗ Empty subscriptionIds array → 400', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/bulk-operations/mark-leave`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({
          subscriptionIds: [],
          date: '2026-06-20',
        });

      expect(res.status).toBe(400);
    });

    it('✗ Past date → 422 UNPROCESSABLE_ENTITY', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/bulk-operations/mark-leave`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({
          subscriptionIds: ['1'],
          date: '2020-01-01',
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('UNPROCESSABLE_ENTITY');
    });

    it('✗ More than 500 subscriptionIds → 400 (or 413)', async () => {
      const ids = Array.from({ length: 501 }, (_, i) => String(i + 1));
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/bulk-operations/mark-leave`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({
          subscriptionIds: ids,
          date: '2026-06-20',
        });

      // Per API_SPEC: 413 PayloadTooLarge; Zod validates this
      expect([400, 413]).toContain(res.status);
    });

    it('✗ Staff → 403 or 404', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/bulk-operations/mark-leave`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          subscriptionIds: ['1'],
          date: '2026-06-20',
        });

      // Staff that's not a member gets 404, staff that is but not owner gets 403
      expect([403, 404]).toContain(res.status);
    });

    it("✓ Multi-tenant isolation: ownerB cannot access ownerA's operation", async () => {
      // First, ownerA creates an operation
      const createRes = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/bulk-operations/mark-leave`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({
          subscriptionIds: ['1'],
          date: '2026-06-20',
        });
      expect(createRes.status).toBe(200);
      const operationId = createRes.body.data.operationId;

      // ownerB tries to GET that operation
      const getRes = await request(app)
        .get(`/api/v1/vendors/${ownerA.vendorId}/bulk-operations/${operationId}`)
        .set('Authorization', `Bearer ${ownerB.token}`);

      // Should be 404 (not 403) — masked access
      expect(getRes.status).toBe(404);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // POST /bulk-operations/adjust-rate
  // ──────────────────────────────────────────────────────────────────────────

  describe('POST /vendors/:vendorId/bulk-operations/adjust-rate', () => {
    it('✓ Happy path: adjust-rate with subscriptionIds → 200', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/bulk-operations/adjust-rate`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({
          subscriptionIds: ['1', '2'],
          newRate: 55.50,
          effectiveDate: '2026-07-01',
          notifyCustomers: false,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('COMPLETED');
      expect(res.body.data.operationId).toBeDefined();
    });

    it('✓ newRate: 0 is allowed (free supply) → 200', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/bulk-operations/adjust-rate`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({
          subscriptionIds: ['1'],
          newRate: 0,
          effectiveDate: '2026-07-01',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('COMPLETED');
    });

    it('✓ adjust-rate with all: true → 200', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/bulk-operations/adjust-rate`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({
          all: true,
          newRate: 60,
          effectiveDate: '2026-07-01',
        });

      expect(res.status).toBe(200);
    });

    it('✗ newRate: -1 → 400', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/bulk-operations/adjust-rate`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({
          subscriptionIds: ['1'],
          newRate: -1,
          effectiveDate: '2026-07-01',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('✗ effectiveDate in the past → 422', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/bulk-operations/adjust-rate`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({
          subscriptionIds: ['1'],
          newRate: 55,
          effectiveDate: '2020-01-01',
        });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('UNPROCESSABLE_ENTITY');
    });

    it('✗ Both subscriptionIds and all: true → 400', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/bulk-operations/adjust-rate`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({
          subscriptionIds: ['1'],
          all: true,
          newRate: 55,
          effectiveDate: '2026-07-01',
        });

      expect(res.status).toBe(400);
    });

    it('✗ Staff → 403 or 404', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/bulk-operations/adjust-rate`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          subscriptionIds: ['1'],
          newRate: 55,
          effectiveDate: '2026-07-01',
        });

      expect([403, 404]).toContain(res.status);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // POST /bulk-operations/send-reminders
  // ──────────────────────────────────────────────────────────────────────────

  describe('POST /vendors/:vendorId/bulk-operations/send-reminders', () => {
    it('✓ Happy path: send-reminders with customerIds → 200', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/bulk-operations/send-reminders`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({
          customerIds: ['1', '2'],
          messageTemplate: 'Please pay your outstanding amount',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('COMPLETED');
      expect(res.body.data.operationId).toBeDefined();
    });

    it('✓ send-reminders with all: true → 200', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/bulk-operations/send-reminders`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({
          all: true,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('COMPLETED');
    });

    it('✗ Both customerIds and all: true → 400', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/bulk-operations/send-reminders`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({
          customerIds: ['1'],
          all: true,
        });

      expect(res.status).toBe(400);
    });

    it('✗ Neither customerIds nor all: true → 400', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/bulk-operations/send-reminders`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({});

      expect(res.status).toBe(400);
    });

    it('✗ More than 500 customerIds → 400 (or 413)', async () => {
      const ids = Array.from({ length: 501 }, (_, i) => String(i + 1));
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/bulk-operations/send-reminders`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({
          customerIds: ids,
        });

      expect([400, 413]).toContain(res.status);
    });

    it('✗ Staff → 403 or 404', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/bulk-operations/send-reminders`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          customerIds: ['1'],
        });

      expect([403, 404]).toContain(res.status);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // GET /bulk-operations/:operationId
  // ──────────────────────────────────────────────────────────────────────────

  describe('GET /vendors/:vendorId/bulk-operations/:operationId', () => {
    let testOperationId: string;

    beforeAll(async () => {
      // Create an operation to query
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/bulk-operations/mark-leave`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({
          subscriptionIds: ['1'],
          date: '2026-06-22',
        });
      testOperationId = res.body.data.operationId;
    });

    it('✓ Own completed operation → 200 with full response shape', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${ownerA.vendorId}/bulk-operations/${testOperationId}`)
        .set('Authorization', `Bearer ${ownerA.token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('operationId');
      expect(res.body.data).toHaveProperty('operationType');
      expect(res.body.data).toHaveProperty('targetType');
      expect(res.body.data).toHaveProperty('status');
      expect(res.body.data).toHaveProperty('affectedCount');
      expect(res.body.data).toHaveProperty('summary');
      expect(res.body.data).toHaveProperty('createdAt');
      expect(['MARK_LEAVE', 'ADJUST_RATE', 'SEND_REMINDERS']).toContain(
        res.body.data.operationType
      );
      expect(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED']).toContain(res.body.data.status);
    });

    it('✗ Non-existent operationId → 404', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${ownerA.vendorId}/bulk-operations/999999`)
        .set('Authorization', `Bearer ${ownerA.token}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it("✗ Another vendor's operation → 404 (not 403)", async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${ownerA.vendorId}/bulk-operations/${testOperationId}`)
        .set('Authorization', `Bearer ${ownerB.token}`);

      expect(res.status).toBe(404);
    });

    it('✗ Staff → 403 or 404', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${ownerA.vendorId}/bulk-operations/${testOperationId}`)
        .set('Authorization', `Bearer ${staffToken}`);

      expect([403, 404]).toContain(res.status);
    });

    it('✗ No token → 401', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${ownerA.vendorId}/bulk-operations/${testOperationId}`);

      expect(res.status).toBe(401);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Error response format validation
  // ──────────────────────────────────────────────────────────────────────────

  describe('Error response format', () => {
    it('✓ All error responses have success=false and error.correlationId', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${ownerA.vendorId}/settings`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({ bulkOperationConcurrencyLimit: -1 });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBeDefined();
      expect(res.body.error.message).toBeDefined();
      expect(res.body.error.correlationId).toBeDefined();
      expect(typeof res.body.error.correlationId).toBe('string');
    });

    it('✓ Validation error includes error.code', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/bulk-operations/mark-leave`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({
          subscriptionIds: ['1'],
          all: true,
          date: '2026-06-20',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
