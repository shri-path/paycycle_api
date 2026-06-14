/**
 * Integration tests for Credit Control API (US-012).
 *
 * Covers happy-path + 404 tenant-isolation for each endpoint tier:
 *   - GET /vendors/:vendorId/collections/dashboard
 *   - PATCH /vendors/:vendorId/customers/:customerId/credit-settings
 *   - POST /vendors/:vendorId/customers/:customerId/enable-prepaid
 *   - POST /vendors/:vendorId/customers/:customerId/reminders (send-single)
 *   - PATCH /vendors/:vendorId/reminder-config
 *   - GET /vendors/:vendorId/reminder-config
 *
 * Auth rules: owner-only; wrong vendor → 404 (tenant isolation), no token → 401.
 */
import request from 'supertest';
import { createApp } from '../../../app';
import { prisma } from '../../../infrastructure/database/prisma.client';

const app = createApp();

// Unique phones for this suite (avoid conflicts with other tests)
const CREDIT_OWNER_A = '+919977700001';
const CREDIT_OWNER_B = '+919977700002';

interface Owner {
  token: string;
  vendorId: string;
  userId: string;
}

interface ApiResponse {
  success: boolean;
  data: Record<string, unknown>;
  error: { code: string; message: string; correlationId: string };
}

// ===========================================================================
// DB Helpers
// ===========================================================================

async function cleanup(): Promise<void> {
  const allPhones = [CREDIT_OWNER_A, CREDIT_OWNER_B];
  const users = await prisma.user.findMany({ where: { phone: { in: allPhones } } });
  const userIds = users.map((u) => u.id);
  const memberships = userIds.length
    ? await prisma.vendorUser.findMany({ where: { userId: { in: userIds } } })
    : [];
  const vendorIds = [...new Set(memberships.map((m) => m.vendorId))];

  if (vendorIds.length) {
    await prisma.paymentReminder
      .deleteMany({ where: { vendorId: { in: vendorIds } } })
      .catch(() => null);
    await prisma.reminderConfig
      .deleteMany({ where: { vendorId: { in: vendorIds } } })
      .catch(() => null);
    await prisma.customerCreditSettings
      .deleteMany({
        where: { customer: { vendorCustomers: { some: { vendorId: { in: vendorIds } } } } },
      })
      .catch(() => null);
    await prisma.payment.deleteMany({ where: { vendorId: { in: vendorIds } } }).catch(() => null);
    await prisma.vendorCustomer.deleteMany({ where: { vendorId: { in: vendorIds } } });
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
  };
}

async function createCustomerForVendor(ownerToken: string, vendorId: string): Promise<string> {
  const res = await request(app)
    .post(`/api/v1/vendors/${vendorId}/customers`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({
      name: 'Credit Test Customer',
      phone: `${Math.floor(Math.random() * 9000000000 + 1000000000)}`,
      address: '123 Test Street',
    });
  if (res.status !== 201) {
    throw new Error(`Customer create failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return (res.body as { data: { id: string } }).data.id;
}

// ===========================================================================
// Suite
// ===========================================================================

describe('Credit Control API — Integration Tests (US-012)', () => {
  let ownerA: Owner;
  let ownerB: Owner;
  let customerAId: string;

  beforeAll(async () => {
    await cleanup();
    ownerA = await signupOwner(CREDIT_OWNER_A, 'Credit Vendor A');
    ownerB = await signupOwner(CREDIT_OWNER_B, 'Credit Vendor B');
    customerAId = await createCustomerForVendor(ownerA.token, ownerA.vendorId);
  }, 60000);

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  // ── GET /collections/dashboard ─────────────────────────────────────────────

  describe('GET /vendors/:vendorId/collections/dashboard', () => {
    it('✓ Owner gets dashboard → 200 with expected shape', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${ownerA.vendorId}/collections/dashboard`)
        .set('Authorization', `Bearer ${ownerA.token}`);

      const body = res.body as ApiResponse;
      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toHaveProperty('outstandingOverview');
      expect(body.data).toHaveProperty('netReceivable');
      expect(body.data).toHaveProperty('thisMonthProgress');
    });

    it('✗ ownerB cannot access ownerA dashboard → 404', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${ownerA.vendorId}/collections/dashboard`)
        .set('Authorization', `Bearer ${ownerB.token}`);

      expect(res.status).toBe(404);
    });

    it('✗ No token → 401 with correlationId', async () => {
      const res = await request(app).get(
        `/api/v1/vendors/${ownerA.vendorId}/collections/dashboard`
      );
      const body = res.body as ApiResponse;
      expect(res.status).toBe(401);
      expect(body.error.correlationId).toBeDefined();
    });
  });

  // ── PATCH /customers/:customerId/credit-settings ───────────────────────────

  describe('PATCH /vendors/:vendorId/customers/:customerId/credit-settings', () => {
    it('✓ Owner patches credit settings → 200', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${ownerA.vendorId}/customers/${customerAId}/credit-settings`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({ warningThreshold: 80, actionOnBreach: 'WARN' });

      const body = res.body as ApiResponse;
      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.warningThreshold).toBe(80);
      expect(body.data).toHaveProperty('creditType');
      expect(body.data).toHaveProperty('creditLimit');
    });

    it('✗ Wrong vendor for customer → 404', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${ownerB.vendorId}/customers/${customerAId}/credit-settings`)
        .set('Authorization', `Bearer ${ownerB.token}`)
        .send({ warningThreshold: 70 });

      expect(res.status).toBe(404);
    });

    it('✗ Invalid warningThreshold > 100 → 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${ownerA.vendorId}/customers/${customerAId}/credit-settings`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({ warningThreshold: 150 });

      const body = res.body as ApiResponse;
      expect(res.status).toBe(400);
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.correlationId).toBeDefined();
    });

    it('✗ No token → 401', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${ownerA.vendorId}/customers/${customerAId}/credit-settings`)
        .send({ warningThreshold: 80 });
      expect(res.status).toBe(401);
    });
  });

  // ── POST /customers/:customerId/enable-prepaid ────────────────────────────

  describe('POST /vendors/:vendorId/customers/:customerId/enable-prepaid', () => {
    it('✓ Owner enables prepaid when no outstanding → 200 switched=true', async () => {
      // Customer has zero balance (freshly created, no deliveries)
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/customers/${customerAId}/enable-prepaid`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({ clearOutstandingFirst: false, minimumBalanceWarning: 200 });

      const body = res.body as ApiResponse;
      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      // Controller omits "switched"; instead returns clearOutstandingRequired=false on success
      expect(body.data.clearOutstandingRequired).toBe(false);
      expect(body.data.creditType).toBe('prepaid');
    });

    it('✗ Already prepaid → 409 CONFLICT with correlationId', async () => {
      // Customer was just switched to prepaid in the test above
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/customers/${customerAId}/enable-prepaid`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({ clearOutstandingFirst: false });

      const body = res.body as ApiResponse;
      expect(res.status).toBe(409);
      expect(body.error.correlationId).toBeDefined();
    });

    it('✗ Wrong vendor → 404', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerB.vendorId}/customers/${customerAId}/enable-prepaid`)
        .set('Authorization', `Bearer ${ownerB.token}`)
        .send({ clearOutstandingFirst: false });

      expect(res.status).toBe(404);
    });

    it('✗ No token → 401', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/customers/${customerAId}/enable-prepaid`)
        .send({ clearOutstandingFirst: false });
      expect(res.status).toBe(401);
    });
  });

  // ── POST /customers/:customerId/reminders (send-single) ───────────────────

  describe('POST /vendors/:vendorId/customers/:customerId/reminders', () => {
    it('✓ Owner sends single reminder → 200 with result shape', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/customers/${customerAId}/reminders`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({});

      const body = res.body as ApiResponse;
      // sendSingleReminder controller uses sendCreated → 201
      expect(res.status).toBe(201);
      expect(body.success).toBe(true);
      // Response shape: either { sent: true, ... } or { skipped: true, skipReason }
      expect(body.data).toHaveProperty('customerId');
      expect(body.data).toHaveProperty('skipped');
    });

    it('✗ Wrong vendor → 404', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerB.vendorId}/customers/${customerAId}/reminders`)
        .set('Authorization', `Bearer ${ownerB.token}`)
        .send({});

      expect(res.status).toBe(404);
    });

    it('✗ No token → 401', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/customers/${customerAId}/reminders`)
        .send({});
      expect(res.status).toBe(401);
    });
  });

  // ── PATCH /reminder-config ─────────────────────────────────────────────────

  describe('PATCH /vendors/:vendorId/reminder-config', () => {
    it('✓ Owner updates reminder config → 200', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${ownerA.vendorId}/reminder-config`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({
          autoRemindersEnabled: false,
          schedule3Days: true,
          schedule15Days: true,
          schedule30Days: false,
        });

      const body = res.body as ApiResponse;
      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.autoRemindersEnabled).toBe(false);
      expect(body.data.schedule30Days).toBe(false);
    });

    it('✗ autoRemindersEnabled=true with all schedules off → 422 ARGUMENT_INVALID', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${ownerA.vendorId}/reminder-config`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({
          autoRemindersEnabled: true,
          schedule3Days: false,
          schedule15Days: false,
          schedule30Days: false,
        });

      const body = res.body as ApiResponse;
      // ArgumentInvalidException → 422 UNPROCESSABLE_ENTITY via central error handler
      expect(res.status).toBe(422);
      expect(body.error.correlationId).toBeDefined();
    });

    it('✗ ownerB cannot update ownerA reminder config → 404', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${ownerA.vendorId}/reminder-config`)
        .set('Authorization', `Bearer ${ownerB.token}`)
        .send({ schedule3Days: false });

      expect(res.status).toBe(404);
    });

    it('✗ No token → 401', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${ownerA.vendorId}/reminder-config`)
        .send({ schedule3Days: true });
      expect(res.status).toBe(401);
    });

    it('✓ Unknown field in strict body → 400 with correlationId', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${ownerA.vendorId}/reminder-config`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({ unknownField: true });

      const body = res.body as ApiResponse;
      expect(res.status).toBe(400);
      expect(body.error.correlationId).toBeDefined();
      expect(typeof body.error.correlationId).toBe('string');
    });
  });

  // ── GET /reminder-config ──────────────────────────────────────────────────

  describe('GET /vendors/:vendorId/reminder-config', () => {
    it('✓ Owner gets reminder config → 200 with expected shape', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${ownerA.vendorId}/reminder-config`)
        .set('Authorization', `Bearer ${ownerA.token}`);

      const body = res.body as ApiResponse;
      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toHaveProperty('autoRemindersEnabled');
      expect(body.data).toHaveProperty('schedule3Days');
      expect(body.data).toHaveProperty('excludedCustomerIds');
    });

    it('✗ ownerB cannot read ownerA reminder config → 404', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${ownerA.vendorId}/reminder-config`)
        .set('Authorization', `Bearer ${ownerB.token}`);

      expect(res.status).toBe(404);
    });
  });
});
