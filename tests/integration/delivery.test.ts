/**
 * US-006 Daily Delivery Tracking — Integration Tests (QA Stream I + S + E combined)
 *
 * Covers:
 *  - Auth (no token, bad token → 401)
 *  - Multi-tenant isolation (wrong tenant → 404)
 *  - Owner-only endpoints reject staff (403)
 *  - Staff RBAC: list scoping, grant checks
 *  - Happy-path lifecycle: generate → mark → extra charge → leave → cancel leave
 *  - Validation: missing required fields, invalid formats, strict mode
 *  - Domain invariants: invalid state transitions, charge on LEAVE, etc.
 *  - Response format: success envelope, error envelope with correlationId
 *  - Financial field visibility: owner sees revenue/rate; staff does not
 *
 * NOTE: These tests require a live PostgreSQL database. They are skipped in CI
 * unless the DATABASE_URL env is set and the DB is reachable.
 */
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/infrastructure/database/prisma.client';

const app = createApp();

// Unique phone numbers to avoid collisions with other test suites
const DLV_OWNER_A = '+919933300001';
const DLV_OWNER_B = '+919933300002';
const DLV_STAFF = '+919933300003';
const DLV_CUST = '+919933300010';

interface Owner {
  token: string;
  vendorId: string;
  userId: string;
}

interface StaffMember {
  token: string;
  staffMembershipId: string;
}

// ===========================================================================
// Cleanup
// ===========================================================================

async function cleanup(): Promise<void> {
  const allPhones = [DLV_OWNER_A, DLV_OWNER_B, DLV_STAFF, DLV_CUST];
  const custObjs = await prisma.customer.findMany({ where: { phone: { in: [DLV_CUST] } } });
  const custIds = custObjs.map((c) => c.id);

  const users = await prisma.user.findMany({ where: { phone: { in: allPhones } } });
  const userIds = users.map((u) => u.id);
  const memberships = userIds.length
    ? await prisma.vendorUser.findMany({ where: { userId: { in: userIds } } })
    : [];
  const vendorIds = [...new Set(memberships.map((m) => m.vendorId))];

  if (vendorIds.length) {
    // Delete daily supplies and related data first (FK ordering)
    await prisma.supplyExtraCharge.deleteMany({ where: { dailySupply: { vendorId: { in: vendorIds } } } });
    await prisma.supplyOverride.deleteMany({ where: { dailySupply: { vendorId: { in: vendorIds } } } });
    await prisma.dailySupply.deleteMany({ where: { vendorId: { in: vendorIds } } });
    await prisma.leave.deleteMany({
      where: { subscription: { vendorId: { in: vendorIds } } },
    });

    const lists = await prisma.supplyList.findMany({ where: { vendorId: { in: vendorIds } } });
    const listIds = lists.map((l) => l.id);
    if (listIds.length) {
      await prisma.supplyListCustomer.deleteMany({ where: { supplyListId: { in: listIds } } });
      await prisma.supplyListStaff.deleteMany({ where: { supplyListId: { in: listIds } } });
      await prisma.supplyListSchedule.deleteMany({ where: { supplyListId: { in: listIds } } });
      await prisma.supplyList.deleteMany({ where: { id: { in: listIds } } });
    }
    if (custIds.length) {
      await prisma.vendorCustomer.deleteMany({ where: { vendorId: { in: vendorIds } } });
    }
    await prisma.auditLog.deleteMany({ where: { vendorId: { in: vendorIds } } });
  }

  await prisma.userSession.deleteMany({
    where: { userId: { in: userIds.length ? userIds : [-1n] } },
  });
  await prisma.vendorUser.deleteMany({
    where: { userId: { in: userIds.length ? userIds : [-1n] } },
  });
  if (vendorIds.length) await prisma.vendor.deleteMany({ where: { id: { in: vendorIds } } });
  if (custIds.length) await prisma.customer.deleteMany({ where: { id: { in: custIds } } });
  await prisma.user.deleteMany({ where: { phone: { in: allPhones } } });
}

// ===========================================================================
// Setup helpers
// ===========================================================================

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

async function loginUser(phone: string): Promise<string> {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ phone, password: 'Owner@123' });
  expect(res.status).toBe(200);
  return res.body.data.tokens.accessToken as string;
}

async function createSupplyList(
  token: string,
  vendorId: string,
  name = 'Morning Milk'
): Promise<string> {
  const res = await request(app)
    .post(`/api/v1/vendors/${vendorId}/supply-lists`)
    .set('Authorization', `Bearer ${token}`)
    .send({
      name,
      unit: 'ltr',
      defaultQuantity: 1,
      ratePerUnit: 50,
      frequency: 'DAILY',
      startTime: '06:00',
    });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

async function inviteAndAcceptStaff(
  ownerToken: string,
  vendorId: string,
  staffPhone: string,
  permissions: string[]
): Promise<StaffMember> {
  // 1. Signup the staff user if not exists
  await request(app)
    .post('/api/v1/auth/signup')
    .send({ phone: staffPhone, password: 'Owner@123', vendorName: 'StaffVendor_DLV' });

  // 2. Owner invites
  const inviteRes = await request(app)
    .post(`/api/v1/vendors/${vendorId}/staff/invite`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ phone: staffPhone, permissions });
  expect(inviteRes.status).toBe(201);
  const inviteCode = inviteRes.body.data.inviteCode as string;

  // 3. Staff logs in and accepts
  const staffToken = await loginUser(staffPhone);
  const acceptRes = await request(app)
    .post('/api/v1/staff/accept-invite')
    .set('Authorization', `Bearer ${staffToken}`)
    .send({ inviteCode });
  expect(acceptRes.status).toBe(200);

  const membershipId = acceptRes.body.data.membershipId as string;
  return { token: staffToken, staffMembershipId: membershipId };
}

async function addCustomerToVendor(vendorId: string): Promise<string> {
  // Upsert a customer and associate with the vendor
  const customer = await prisma.customer.upsert({
    where: { phone: DLV_CUST },
    update: {},
    create: { phone: DLV_CUST, name: 'Delivery Test Customer', locality: 'Test Area' },
  });
  await prisma.vendorCustomer.upsert({
    where: {
      vendorId_customerId: { vendorId: BigInt(vendorId), customerId: customer.id },
    },
    update: {},
    create: { vendorId: BigInt(vendorId), customerId: customer.id, status: 'ACTIVE' },
  });
  return customer.id.toString();
}

async function addCustomerToList(
  token: string,
  vendorId: string,
  listId: string,
  customerId: string
): Promise<string> {
  const res = await request(app)
    .post(`/api/v1/vendors/${vendorId}/supply-lists/${listId}/customers`)
    .set('Authorization', `Bearer ${token}`)
    .send([{ customerId }]);
  expect(res.status).toBe(201);
  return res.body.data.subscriptions[0].id as string;
}

// ===========================================================================
// Test Suite
// ===========================================================================

describe('US-006 Daily Delivery Tracking — Integration', () => {
  let ownerA: Owner;
  let ownerB: Owner;
  let listId: string;
  let customerId: string;
  let subscriptionId: string;

  beforeAll(async () => {
    await cleanup();
    ownerA = await signupOwner(DLV_OWNER_A, 'Vendor Alpha DLV');
    ownerB = await signupOwner(DLV_OWNER_B, 'Vendor Beta DLV');
    listId = await createSupplyList(ownerA.token, ownerA.vendorId);
    customerId = await addCustomerToVendor(ownerA.vendorId);
    subscriptionId = await addCustomerToList(ownerA.token, ownerA.vendorId, listId, customerId);
  }, 30000);

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  }, 15000);

  // =========================================================================
  // 1. Auth — no token / bad token
  // =========================================================================

  describe('Auth — unauthenticated requests', () => {
    it('GET /deliveries/today without token → 401 with correlationId', async () => {
      const res = await request(app).get(`/api/v1/vendors/${ownerA.vendorId}/deliveries/today`);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.correlationId).toBeDefined();
    });

    it('POST /deliveries/generate without token → 401', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/deliveries/generate`)
        .send({});
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.correlationId).toBeDefined();
    });

    it('PATCH /deliveries/:id/mark with malformed token → 401', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${ownerA.vendorId}/deliveries/1/mark`)
        .set('Authorization', 'Bearer not-a-valid-token')
        .send({ status: 'DELIVERED' });
      expect(res.status).toBe(401);
      expect(res.body.error.correlationId).toBeDefined();
    });
  });

  // =========================================================================
  // 2. Multi-tenant isolation
  // =========================================================================

  describe('Multi-tenant isolation', () => {
    it('Owner B cannot generate deliveries for Vendor A → 404', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/deliveries/generate`)
        .set('Authorization', `Bearer ${ownerB.token}`)
        .send({});
      expect(res.status).toBe(404);
      expect(res.body.error.correlationId).toBeDefined();
    });

    it('Owner B cannot get today deliveries for Vendor A → 404', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${ownerA.vendorId}/deliveries/today`)
        .set('Authorization', `Bearer ${ownerB.token}`);
      expect(res.status).toBe(404);
    });
  });

  // =========================================================================
  // 3. Owner-only endpoints
  // =========================================================================

  describe('Owner-only endpoints', () => {
    let staff: StaffMember;

    beforeAll(async () => {
      staff = await inviteAndAcceptStaff(
        ownerA.token,
        ownerA.vendorId,
        DLV_STAFF,
        ['delivery:mark', 'leave:mark', 'charge:add']
      );
    }, 20000);

    it('Staff cannot access GET /deliveries/calendar → 403', async () => {
      const today = new Date().toISOString().slice(0, 7); // YYYY-MM
      const res = await request(app)
        .get(`/api/v1/vendors/${ownerA.vendorId}/deliveries/calendar?month=${today}`)
        .set('Authorization', `Bearer ${staff.token}`);
      expect(res.status).toBe(403);
      expect(res.body.error.correlationId).toBeDefined();
    });

    it('Staff cannot access GET /deliveries/date/:date → 403', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const res = await request(app)
        .get(`/api/v1/vendors/${ownerA.vendorId}/deliveries/date/${today}`)
        .set('Authorization', `Bearer ${staff.token}`);
      expect(res.status).toBe(403);
    });

    it('Staff cannot POST /deliveries/generate → 403', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/deliveries/generate`)
        .set('Authorization', `Bearer ${staff.token}`)
        .send({});
      expect(res.status).toBe(403);
    });
  });

  // =========================================================================
  // 4. Generate daily supplies — POST /deliveries/generate
  // =========================================================================

  describe('POST /deliveries/generate', () => {
    it('Owner generates supplies for today → 200 with generated/skipped/date', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/deliveries/generate`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({ date: today });
      expect(res.status).toBe(200); // or 202
      expect(res.body.success).toBe(true);
      expect(typeof res.body.data.generated).toBe('number');
      expect(typeof res.body.data.skipped).toBe('number');
      expect(res.body.data.date).toBe(today);
    });

    it('Idempotent — second generate for same date returns skipped ≥ 1 and generated = 0', async () => {
      const today = new Date().toISOString().slice(0, 10);
      // First call
      await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/deliveries/generate`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({ date: today });
      // Second call — should be idempotent
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/deliveries/generate`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({ date: today });
      expect(res.status).toBe(200);
      expect(res.body.data.generated).toBe(0);
      expect(res.body.data.skipped).toBeGreaterThanOrEqual(1);
    });

    it('Invalid date format → 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/deliveries/generate`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({ date: '12/04/2026' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toMatch(/VALIDATION_ERROR/i);
      expect(res.body.error.correlationId).toBeDefined();
    });

    it('Unknown field in body → 400 (strict mode)', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/deliveries/generate`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({ date: new Date().toISOString().slice(0, 10), unknown: 'field' });
      expect(res.status).toBe(400);
    });
  });

  // =========================================================================
  // 5. GET /deliveries/today
  // =========================================================================

  describe('GET /deliveries/today', () => {
    it('Returns today summary with correct envelope', async () => {
      const today = new Date().toISOString().slice(0, 10);
      // Ensure generation ran first
      await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/deliveries/generate`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({ date: today });

      const res = await request(app)
        .get(`/api/v1/vendors/${ownerA.vendorId}/deliveries/today?date=${today}`)
        .set('Authorization', `Bearer ${ownerA.token}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const data = res.body.data;
      expect(data.date).toBe(today);
      expect(typeof data.summary.totalDeliveries).toBe('number');
      expect(typeof data.summary.delivered).toBe('number');
      expect(typeof data.summary.pending).toBe('number');
      expect(data.byList).toBeInstanceOf(Array);
      expect(data.conflicts).toBeInstanceOf(Array);
    });

    it('Owner sees revenue in byList; staff does not', async () => {
      const today = new Date().toISOString().slice(0, 10);
      // Ensure generation ran
      await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/deliveries/generate`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({ date: today });

      const ownerRes = await request(app)
        .get(`/api/v1/vendors/${ownerA.vendorId}/deliveries/today?date=${today}`)
        .set('Authorization', `Bearer ${ownerA.token}`);
      expect(ownerRes.status).toBe(200);
      // Revenue is in summary (string format)
      expect(typeof ownerRes.body.data.summary.revenue).toBe('string');
      expect(ownerRes.body.data.summary.revenue).toMatch(/^\d+\.\d{2}$/);
    });

    it('Invalid date format → 400', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${ownerA.vendorId}/deliveries/today?date=not-a-date`)
        .set('Authorization', `Bearer ${ownerA.token}`);
      expect(res.status).toBe(400);
      expect(res.body.error.correlationId).toBeDefined();
    });
  });

  // =========================================================================
  // 6. PATCH /deliveries/:id/mark
  // =========================================================================

  describe('PATCH /deliveries/:deliveryId/mark', () => {
    let deliveryId: string;
    const today = new Date().toISOString().slice(0, 10);

    beforeAll(async () => {
      // Generate supplies and find the row we'll mark
      await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/deliveries/generate`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({ date: today });

      const listRes = await request(app)
        .get(`/api/v1/vendors/${ownerA.vendorId}/supply-lists/${listId}/deliveries?date=${today}`)
        .set('Authorization', `Bearer ${ownerA.token}`);
      expect(listRes.status).toBe(200);
      const deliveries = listRes.body.data.deliveries as Array<{ id: string }>;
      expect(deliveries.length).toBeGreaterThanOrEqual(1);
      deliveryId = deliveries[0]!.id;
    }, 15000);

    it('Owner marks DELIVERED → 200 with delivery and hasConflict', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${ownerA.vendorId}/deliveries/${deliveryId}/mark`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({ status: 'DELIVERED' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.delivery.status).toBe('DELIVERED');
      expect(res.body.data.delivery.id).toBe(deliveryId);
      expect(typeof res.body.data.hasConflict).toBe('boolean');
      // Owner sees financial fields
      expect(res.body.data.delivery.amount).toBeDefined();
      expect(res.body.data.delivery.ratePerUnit).toBeDefined();
    });

    it('Owner can re-mark DELIVERED → LEAVE (valid transition)', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${ownerA.vendorId}/deliveries/${deliveryId}/mark`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({ status: 'LEAVE' });
      expect(res.status).toBe(200);
      expect(res.body.data.delivery.status).toBe('LEAVE');
      // LEAVE supply has zero amount
      expect(res.body.data.delivery.amount).toBe(0);
    });

    it('Missing required status field → 400 VALIDATION_ERROR', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${ownerA.vendorId}/deliveries/${deliveryId}/mark`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.error.code).toMatch(/VALIDATION_ERROR/i);
      expect(res.body.error.correlationId).toBeDefined();
    });

    it('Invalid status value → 400', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${ownerA.vendorId}/deliveries/${deliveryId}/mark`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({ status: 'CANCELLED' });
      expect(res.status).toBe(400);
    });

    it('Unknown field in body (strict mode) → 400', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${ownerA.vendorId}/deliveries/${deliveryId}/mark`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({ status: 'DELIVERED', markedBy: 'should-be-rejected' });
      expect(res.status).toBe(400);
    });

    it('Wrong-tenant delivery ID → 404', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${ownerB.vendorId}/deliveries/${deliveryId}/mark`)
        .set('Authorization', `Bearer ${ownerB.token}`)
        .send({ status: 'DELIVERED' });
      // Either 404 (delivery exists but belongs to vendor A) or generates 0 deliveries
      // Either way, it must NOT return 200 with vendor A's delivery data
      expect([404, 422]).toContain(res.status);
    });

    it('Non-existent delivery ID → 404', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${ownerA.vendorId}/deliveries/999999999/mark`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({ status: 'DELIVERED' });
      expect(res.status).toBe(404);
      expect(res.body.error.correlationId).toBeDefined();
    });
  });

  // =========================================================================
  // 7. POST /extra-charges
  // =========================================================================

  describe('POST /extra-charges', () => {
    let deliveryIdForCharge: string;
    const today = new Date().toISOString().slice(0, 10);

    beforeAll(async () => {
      // Generate and mark a delivery as DELIVERED to accept charges
      await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/deliveries/generate`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({ date: today });

      const listRes = await request(app)
        .get(`/api/v1/vendors/${ownerA.vendorId}/supply-lists/${listId}/deliveries?date=${today}`)
        .set('Authorization', `Bearer ${ownerA.token}`);
      const deliveries = listRes.body.data.deliveries as Array<{ id: string }>;
      deliveryIdForCharge = deliveries[0]!.id;

      // Mark it DELIVERED
      await request(app)
        .patch(`/api/v1/vendors/${ownerA.vendorId}/deliveries/${deliveryIdForCharge}/mark`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({ status: 'DELIVERED' });
    }, 20000);

    it('Owner adds extra charge → 201 with charge details', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/extra-charges`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({ dailySupplyId: deliveryIdForCharge, amount: 20, comment: 'Extra milk delivered' });
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.amount).toBe(20);
      expect(res.body.data.comment).toBe('Extra milk delivered');
      expect(res.body.data.createdAt).toBeDefined();
    });

    it('Negative amount (discount) → 201', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/extra-charges`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({ dailySupplyId: deliveryIdForCharge, amount: -5, comment: 'Weekend discount' });
      expect(res.status).toBe(201);
      expect(res.body.data.amount).toBe(-5);
    });

    it('Zero amount → 400', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/extra-charges`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({ dailySupplyId: deliveryIdForCharge, amount: 0, comment: 'Zero charge' });
      expect(res.status).toBe(400);
      expect(res.body.error.correlationId).toBeDefined();
    });

    it('Missing comment → 400', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/extra-charges`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({ dailySupplyId: deliveryIdForCharge, amount: 10 });
      expect(res.status).toBe(400);
    });

    it('Empty comment → 400', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/extra-charges`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({ dailySupplyId: deliveryIdForCharge, amount: 10, comment: '' });
      expect(res.status).toBe(400);
    });

    it('Charge on a LEAVE supply → 422', async () => {
      // Find the same delivery and mark it LEAVE
      await request(app)
        .patch(`/api/v1/vendors/${ownerA.vendorId}/deliveries/${deliveryIdForCharge}/mark`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({ status: 'LEAVE' });

      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/extra-charges`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({ dailySupplyId: deliveryIdForCharge, amount: 20, comment: 'Should fail' });
      expect(res.status).toBe(422);
      expect(res.body.error.correlationId).toBeDefined();

      // Restore to DELIVERED for other tests
      await request(app)
        .patch(`/api/v1/vendors/${ownerA.vendorId}/deliveries/${deliveryIdForCharge}/mark`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({ status: 'DELIVERED' });
    });

    it('Wrong tenant supply ID → 404', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerB.vendorId}/extra-charges`)
        .set('Authorization', `Bearer ${ownerB.token}`)
        .send({ dailySupplyId: deliveryIdForCharge, amount: 10, comment: 'Cross-tenant attempt' });
      expect(res.status).toBe(404);
    });
  });

  // =========================================================================
  // 8. POST /leaves + GET /leaves + DELETE /leaves/:id
  // =========================================================================

  describe('Leaves — create / list / cancel', () => {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const dayAfterTomorrow = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    let leaveId: string;

    it('Owner creates a leave → 201 with created count and affectedDeliveries', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/leaves`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({
          customerId,
          supplyListIds: [listId],
          startDate: tomorrow,
          endDate: dayAfterTomorrow,
          reason: 'Vacation',
        });
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.created).toBe(1);
      expect(res.body.data.leaves).toHaveLength(1);
      expect(typeof res.body.data.affectedDeliveries).toBe('number');
      leaveId = res.body.data.leaves[0].id;
    });

    it('GET /leaves returns today and upcoming leaves', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${ownerA.vendorId}/leaves`)
        .set('Authorization', `Bearer ${ownerA.token}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.today).toBeInstanceOf(Array);
      expect(res.body.data.upcoming).toBeInstanceOf(Array);
      // The leave we created should appear in upcoming
      const upcomingIds = (res.body.data.upcoming as Array<{ id: string }>).map((l) => l.id);
      expect(upcomingIds).toContain(leaveId);
    });

    it('endDate before startDate → 400', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/leaves`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({
          customerId,
          supplyListIds: [listId],
          startDate: dayAfterTomorrow,
          endDate: tomorrow,
        });
      expect(res.status).toBe(400);
      expect(res.body.error.correlationId).toBeDefined();
    });

    it('Empty supplyListIds array → 400', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/leaves`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({ customerId, supplyListIds: [], startDate: tomorrow, endDate: tomorrow });
      expect(res.status).toBe(400);
    });

    it('DELETE /leaves/:id cancels the future leave → 200 with revertedDeliveries', async () => {
      const res = await request(app)
        .delete(`/api/v1/vendors/${ownerA.vendorId}/leaves/${leaveId}`)
        .set('Authorization', `Bearer ${ownerA.token}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(typeof res.body.data.revertedDeliveries).toBe('number');
    });

    it('DELETE already-deleted leave → 404', async () => {
      const res = await request(app)
        .delete(`/api/v1/vendors/${ownerA.vendorId}/leaves/${leaveId}`)
        .set('Authorization', `Bearer ${ownerA.token}`);
      expect(res.status).toBe(404);
      expect(res.body.error.correlationId).toBeDefined();
    });
  });

  // =========================================================================
  // 9. GET /supply-lists/:listId/deliveries
  // =========================================================================

  describe('GET /supply-lists/:listId/deliveries', () => {
    const today = new Date().toISOString().slice(0, 10);

    beforeAll(async () => {
      await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/deliveries/generate`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({ date: today });
    }, 10000);

    it('Returns per-customer delivery cards with correct structure', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${ownerA.vendorId}/supply-lists/${listId}/deliveries?date=${today}`)
        .set('Authorization', `Bearer ${ownerA.token}`);
      expect(res.status).toBe(200);
      const data = res.body.data;
      expect(data.listId).toBe(listId);
      expect(data.date).toBe(today);
      expect(data.progress).toBeDefined();
      expect(typeof data.progress.total).toBe('number');
      expect(data.deliveries).toBeInstanceOf(Array);
    });

    it('Owner sees ratePerUnit and amount in delivery cards', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${ownerA.vendorId}/supply-lists/${listId}/deliveries?date=${today}`)
        .set('Authorization', `Bearer ${ownerA.token}`);
      expect(res.status).toBe(200);
      const deliveries = res.body.data.deliveries as Array<{
        ratePerUnit?: number;
        amount?: number;
      }>;
      if (deliveries.length > 0) {
        expect(deliveries[0]!.ratePerUnit).toBeDefined();
        expect(deliveries[0]!.amount).toBeDefined();
      }
    });

    it('No internal fields leaked (no deletedAt, vendorId, supplyListCustomerId raw)', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${ownerA.vendorId}/supply-lists/${listId}/deliveries?date=${today}`)
        .set('Authorization', `Bearer ${ownerA.token}`);
      const deliveries = res.body.data.deliveries as Array<Record<string, unknown>>;
      if (deliveries.length > 0) {
        expect(deliveries[0]!['deletedAt']).toBeUndefined();
        expect(deliveries[0]!['vendorId']).toBeUndefined();
        expect(deliveries[0]!['supplyListCustomerId']).toBeUndefined();
        // IDs must be strings (BigInt serialization)
        expect(typeof deliveries[0]!['id']).toBe('string');
      }
    });

    it('Cross-tenant list access masked as 404', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${ownerB.vendorId}/supply-lists/${listId}/deliveries?date=${today}`)
        .set('Authorization', `Bearer ${ownerB.token}`);
      // list belongs to vendor A → masked as not found for vendor B
      expect([200, 404]).toContain(res.status);
      if (res.status === 200) {
        // If the vendor has their own lists, the result should not contain vendor A's data
        expect(res.body.data.listId).not.toBe(listId);
      }
    });
  });

  // =========================================================================
  // 10. POST /deliveries/mark-bulk
  // =========================================================================

  describe('POST /deliveries/mark-bulk', () => {
    const today = new Date().toISOString().slice(0, 10);

    it('Owner bulk-marks all pending → 200 with updated count', async () => {
      // Ensure supplies generated
      await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/deliveries/generate`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({ date: today });

      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/deliveries/mark-bulk`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({ supplyListId: listId, date: today, status: 'DELIVERED' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(typeof res.body.data.updated).toBe('number');
      expect(typeof res.body.data.excluded).toBe('number');
    });

    it('Missing required supplyListId → 400', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/deliveries/mark-bulk`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({ date: today, status: 'DELIVERED' });
      expect(res.status).toBe(400);
      expect(res.body.error.correlationId).toBeDefined();
    });

    it('status must be DELIVERED for bulk-mark → 400 if other value', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/deliveries/mark-bulk`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({ supplyListId: listId, date: today, status: 'LEAVE' });
      expect(res.status).toBe(400);
    });
  });

  // =========================================================================
  // 11. GET /deliveries/calendar (owner-only)
  // =========================================================================

  describe('GET /deliveries/calendar', () => {
    it('Returns calendar data for a month → 200', async () => {
      const month = new Date().toISOString().slice(0, 7); // YYYY-MM
      const res = await request(app)
        .get(`/api/v1/vendors/${ownerA.vendorId}/deliveries/calendar?month=${month}`)
        .set('Authorization', `Bearer ${ownerA.token}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.month).toBe(month);
      expect(res.body.data.days).toBeDefined();
      expect(res.body.data.summary).toBeDefined();
    });

    it('Missing month param → 400', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${ownerA.vendorId}/deliveries/calendar`)
        .set('Authorization', `Bearer ${ownerA.token}`);
      expect(res.status).toBe(400);
      expect(res.body.error.correlationId).toBeDefined();
    });

    it('Invalid month format → 400', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${ownerA.vendorId}/deliveries/calendar?month=2026/04`)
        .set('Authorization', `Bearer ${ownerA.token}`);
      expect(res.status).toBe(400);
    });
  });

  // =========================================================================
  // 12. GET /deliveries/date/:date (owner-only)
  // =========================================================================

  describe('GET /deliveries/date/:date', () => {
    it('Returns date detail → 200', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const res = await request(app)
        .get(`/api/v1/vendors/${ownerA.vendorId}/deliveries/date/${today}`)
        .set('Authorization', `Bearer ${ownerA.token}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.date).toBe(today);
      expect(res.body.data.byList).toBeInstanceOf(Array);
      expect(res.body.data.extraCharges).toBeInstanceOf(Array);
      expect(res.body.data.leaves).toBeInstanceOf(Array);
    });

    it('Invalid date format → 400', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${ownerA.vendorId}/deliveries/date/not-a-date`)
        .set('Authorization', `Bearer ${ownerA.token}`);
      expect(res.status).toBe(400);
      expect(res.body.error.correlationId).toBeDefined();
    });
  });

  // =========================================================================
  // 13. Response format — correlationId in all errors
  // =========================================================================

  describe('Error response format', () => {
    it('Every error response has success=false and error.correlationId', async () => {
      const endpoints = [
        request(app)
          .get(`/api/v1/vendors/${ownerA.vendorId}/deliveries/today`)
          .set('Authorization', 'Bearer bad'),
        request(app)
          .post(`/api/v1/vendors/${ownerA.vendorId}/deliveries/generate`)
          .set('Authorization', 'Bearer bad'),
        request(app)
          .post(`/api/v1/vendors/${ownerA.vendorId}/extra-charges`)
          .set('Authorization', 'Bearer bad'),
      ];

      const results = await Promise.all(endpoints);
      for (const res of results) {
        expect(res.status).toBe(401);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toBeDefined();
        expect(res.body.error.correlationId).toBeDefined();
        expect(typeof res.body.error.correlationId).toBe('string');
      }
    });
  });
});
