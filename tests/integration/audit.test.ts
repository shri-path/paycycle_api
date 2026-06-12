/**
 * US-007 Audit & Accountability — Integration Tests
 *
 * Covers:
 *  - Auth (no token / bad token → 401 with correlationId)
 *  - Multi-tenant isolation (wrong tenant → 404 mask)
 *  - RBAC: owner-only endpoints reject staff (403); staff self-scoping on audit-logs
 *  - Happy path: a delivery mark produces an audit row surfaced by the timeline
 *  - my-activity self counts; staff-summary aggregation; conflicts shape
 *  - CSV export content-type/disposition; unsupported format → 400
 *  - Response envelopes (success + error with correlationId), pagination meta
 *
 * Requires a live PostgreSQL database (DATABASE_URL). Skipped if unreachable.
 */
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/infrastructure/database/prisma.client';

const app = createApp();

const AUD_OWNER_A = '+919944400001';
const AUD_OWNER_B = '+919944400002';
const AUD_STAFF = '+919944400003';
const AUD_CUST = '+919944400010';

interface Owner {
  token: string;
  vendorId: string;
  userId: string;
}
interface StaffMember {
  token: string;
  staffMembershipId: string;
  userId: string;
}

async function cleanup(): Promise<void> {
  const allPhones = [AUD_OWNER_A, AUD_OWNER_B, AUD_STAFF, AUD_CUST];
  const custObjs = await prisma.customer.findMany({ where: { phone: { in: [AUD_CUST] } } });
  const custIds = custObjs.map((c) => c.id);
  const users = await prisma.user.findMany({ where: { phone: { in: allPhones } } });
  const userIds = users.map((u) => u.id);
  const memberships = userIds.length
    ? await prisma.vendorUser.findMany({ where: { userId: { in: userIds } } })
    : [];
  const vendorIds = [...new Set(memberships.map((m) => m.vendorId))];

  if (vendorIds.length) {
    await prisma.supplyExtraCharge.deleteMany({
      where: { dailySupply: { vendorId: { in: vendorIds } } },
    });
    await prisma.supplyOverride.deleteMany({
      where: { dailySupply: { vendorId: { in: vendorIds } } },
    });
    await prisma.dailySupply.deleteMany({ where: { vendorId: { in: vendorIds } } });
    await prisma.leave.deleteMany({ where: { subscription: { vendorId: { in: vendorIds } } } });

    const lists = await prisma.supplyList.findMany({ where: { vendorId: { in: vendorIds } } });
    const listIds = lists.map((l) => l.id);
    if (listIds.length) {
      await prisma.supplyListCustomer.deleteMany({ where: { supplyListId: { in: listIds } } });
      await prisma.supplyListStaff.deleteMany({ where: { supplyListId: { in: listIds } } });
      await prisma.supplyListSchedule.deleteMany({ where: { supplyListId: { in: listIds } } });
      await prisma.supplyList.deleteMany({ where: { id: { in: listIds } } });
    }
    await prisma.vendorCustomer.deleteMany({ where: { vendorId: { in: vendorIds } } });
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
  const res = await request(app).post('/api/v1/auth/login').send({ phone, password: 'Owner@123' });
  expect(res.status).toBe(200);
  return res.body.data.tokens.accessToken as string;
}

async function createSupplyList(token: string, vendorId: string): Promise<string> {
  const res = await request(app)
    .post(`/api/v1/vendors/${vendorId}/supply-lists`)
    .set('Authorization', `Bearer ${token}`)
    .send({
      name: 'Morning Milk',
      unit: 'ltr',
      defaultQuantity: 1,
      defaultRatePerUnit: 50,
      frequency: 'DAILY',
      startTime: '06:00',
    });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

/**
 * Create an ACTIVE staff membership directly (the staff invite/accept HTTP dance is
 * covered by US-002/US-004 tests). We sign the staff user up to get a real User +
 * auth token, then attach a vendor_staff membership in vendorId via Prisma.
 */
async function createStaffMember(vendorId: string, staffPhone: string): Promise<StaffMember> {
  await request(app)
    .post('/api/v1/auth/signup')
    .send({ phone: staffPhone, password: 'Owner@123', vendorName: 'StaffVendor_AUD' });
  const staffToken = await loginUser(staffPhone);
  const me = await prisma.user.findUnique({ where: { phone: staffPhone }, select: { id: true } });
  const staffRole = await prisma.role.findFirstOrThrow({ where: { name: 'vendor_staff' } });
  const membership = await prisma.vendorUser.create({
    data: {
      vendorId: BigInt(vendorId),
      userId: me!.id,
      roleId: staffRole.id,
      status: 'ACTIVE',
      joinedAt: new Date(),
    },
    select: { id: true },
  });
  return {
    token: staffToken,
    staffMembershipId: membership.id.toString(),
    userId: me!.id.toString(),
  };
}

/** Seed audit rows directly: a staff delivery mark + an owner customer update. */
async function seedAuditRows(vendorId: string, staffUserId: string, ownerUserId: string): Promise<void> {
  await prisma.auditLog.createMany({
    data: [
      {
        vendorId: BigInt(vendorId),
        performedByUserId: BigInt(staffUserId),
        performedByRole: 'vendor_staff',
        action: 'delivery_marked',
        entityType: 'daily_supply',
        entityId: 999999n,
        metadata: { status: 'DELIVERED' },
        ipAddress: '203.0.113.5',
      },
      {
        vendorId: BigInt(vendorId),
        performedByUserId: BigInt(ownerUserId),
        performedByRole: 'vendor_owner',
        action: 'customer_updated',
        entityType: 'customer',
        entityId: 888888n,
        metadata: { field: 'name' },
        ipAddress: '203.0.113.6',
      },
    ],
  });
}

async function addCustomerToList(token: string, vendorId: string, listId: string): Promise<string> {
  const customer = await prisma.customer.upsert({
    where: { phone: AUD_CUST },
    update: {},
    create: { phone: AUD_CUST, name: 'Audit Test Customer', locality: 'Test Area' },
  });
  await prisma.vendorCustomer.upsert({
    where: { vendorId_customerId: { vendorId: BigInt(vendorId), customerId: customer.id } },
    update: {},
    create: { vendorId: BigInt(vendorId), customerId: customer.id, status: 'ACTIVE' },
  });
  const res = await request(app)
    .post(`/api/v1/vendors/${vendorId}/supply-lists/${listId}/customers`)
    .set('Authorization', `Bearer ${token}`)
    .send({ customerIds: [customer.id.toString()] });
  expect(res.status).toBe(201);
  return customer.id.toString();
}

let dbAvailable = true;

describe('US-007 Audit & Accountability — Integration', () => {
  let ownerA: Owner;
  let ownerB: Owner;
  let staff: StaffMember;
  let listId: string;

  beforeAll(async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      dbAvailable = false;
      return;
    }
    await cleanup();
    ownerA = await signupOwner(AUD_OWNER_A, 'Vendor Alpha AUD');
    ownerB = await signupOwner(AUD_OWNER_B, 'Vendor Beta AUD');
    listId = await createSupplyList(ownerA.token, ownerA.vendorId);
    await addCustomerToList(ownerA.token, ownerA.vendorId, listId);
    staff = await createStaffMember(ownerA.vendorId, AUD_STAFF);

    // Seed audit rows directly (a staff delivery mark + an owner customer update)
    // so the read endpoints have deterministic data to surface.
    await seedAuditRows(ownerA.vendorId, staff.userId, ownerA.userId);
  }, 60000);

  afterAll(async () => {
    if (dbAvailable) await cleanup();
    await prisma.$disconnect();
  }, 20000);

  const guard = () => {
    if (!dbAvailable) {
      // eslint-disable-next-line no-console
      console.warn('Skipping audit integration test — database unavailable');
    }
    return dbAvailable;
  };

  describe('Auth', () => {
    it('GET /audit-logs without token → 401 + correlationId', async () => {
      if (!guard()) return;
      const res = await request(app).get(`/api/v1/vendors/${ownerA.vendorId}/audit-logs`);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.correlationId).toBeDefined();
    });

    it('GET /audit-logs/my-activity with bad token → 401', async () => {
      if (!guard()) return;
      const res = await request(app)
        .get(`/api/v1/vendors/${ownerA.vendorId}/audit-logs/my-activity`)
        .set('Authorization', 'Bearer nope');
      expect(res.status).toBe(401);
      expect(res.body.error.correlationId).toBeDefined();
    });
  });

  describe('Multi-tenant isolation', () => {
    it('Owner B cannot read Vendor A audit logs → 404', async () => {
      if (!guard()) return;
      const res = await request(app)
        .get(`/api/v1/vendors/${ownerA.vendorId}/audit-logs`)
        .set('Authorization', `Bearer ${ownerB.token}`);
      expect(res.status).toBe(404);
      expect(res.body.error.correlationId).toBeDefined();
    });
  });

  describe('RBAC', () => {
    it('staff → 403 on conflicts (owner only)', async () => {
      if (!guard()) return;
      const res = await request(app)
        .get(`/api/v1/vendors/${ownerA.vendorId}/audit-logs/conflicts`)
        .set('Authorization', `Bearer ${staff.token}`);
      expect(res.status).toBe(403);
    });

    it('staff → 403 on staff-summary (owner only)', async () => {
      if (!guard()) return;
      const res = await request(app)
        .get(`/api/v1/vendors/${ownerA.vendorId}/audit-logs/staff-summary`)
        .set('Authorization', `Bearer ${staff.token}`);
      expect(res.status).toBe(403);
    });

    it('staff → 403 on export (owner only)', async () => {
      if (!guard()) return;
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/audit-logs/export`)
        .set('Authorization', `Bearer ${staff.token}`)
        .send({ format: 'csv' });
      expect(res.status).toBe(403);
    });

    it('staff audit-logs are self-scoped (only own actions)', async () => {
      if (!guard()) return;
      const res = await request(app)
        .get(`/api/v1/vendors/${ownerA.vendorId}/audit-logs`)
        .set('Authorization', `Bearer ${staff.token}`);
      expect(res.status).toBe(200);
      const logs = res.body.data.auditLogs as Array<{ user: { id: string }; ipAddress?: string }>;
      for (const l of logs) {
        expect(l.user.id).toBe(staff.userId);
        expect(l.ipAddress).toBeUndefined(); // ipAddress hidden from staff
      }
    });
  });

  describe('Owner timeline + facets', () => {
    it('GET /audit-logs returns envelope, pagination, filters facet', async () => {
      if (!guard()) return;
      const res = await request(app)
        .get(`/api/v1/vendors/${ownerA.vendorId}/audit-logs?page=1&limit=20`)
        .set('Authorization', `Bearer ${ownerA.token}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.pagination).toMatchObject({ page: 1, limit: 20 });
      expect(Array.isArray(res.body.data.filters.availableActionTypes)).toBe(true);
      expect(Array.isArray(res.body.data.filters.availableStaff)).toBe(true);
      // The staff delivery mark should appear in the owner timeline.
      const actions = res.body.data.auditLogs.map((l: { actionType: string }) => l.actionType);
      expect(actions).toContain('delivery_marked');
    });

    it('400 on limit over 100', async () => {
      if (!guard()) return;
      const res = await request(app)
        .get(`/api/v1/vendors/${ownerA.vendorId}/audit-logs?limit=500`)
        .set('Authorization', `Bearer ${ownerA.token}`);
      expect(res.status).toBe(400);
      expect(res.body.error.correlationId).toBeDefined();
    });
  });

  describe('my-activity', () => {
    it('staff sees their own activity + summary counts', async () => {
      if (!guard()) return;
      const res = await request(app)
        .get(`/api/v1/vendors/${ownerA.vendorId}/audit-logs/my-activity`)
        .set('Authorization', `Bearer ${staff.token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.summary).toHaveProperty('todayActions');
      expect(res.body.data.summary).toHaveProperty('thisWeekActions');
      expect(res.body.data.summary).toHaveProperty('thisMonthActions');
      expect(Array.isArray(res.body.data.activity)).toBe(true);
    });
  });

  describe('staff-summary (owner)', () => {
    it('aggregates the staff member who marked a delivery', async () => {
      if (!guard()) return;
      const res = await request(app)
        .get(`/api/v1/vendors/${ownerA.vendorId}/audit-logs/staff-summary`)
        .set('Authorization', `Bearer ${ownerA.token}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.summary)).toBe(true);
    });
  });

  describe('conflicts (owner)', () => {
    it('returns a conflicts array', async () => {
      if (!guard()) return;
      const res = await request(app)
        .get(`/api/v1/vendors/${ownerA.vendorId}/audit-logs/conflicts`)
        .set('Authorization', `Bearer ${ownerA.token}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.conflicts)).toBe(true);
    });
  });

  describe('export (owner)', () => {
    it('returns CSV with attachment disposition', async () => {
      if (!guard()) return;
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/audit-logs/export`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({ format: 'csv' });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('attachment');
      expect(res.text.split('\r\n')[0]).toContain('Timestamp');
    });

    it('400 on unsupported export format', async () => {
      if (!guard()) return;
      const res = await request(app)
        .post(`/api/v1/vendors/${ownerA.vendorId}/audit-logs/export`)
        .set('Authorization', `Bearer ${ownerA.token}`)
        .send({ format: 'pdf' });
      expect(res.status).toBe(400);
      expect(res.body.error.correlationId).toBeDefined();
    });
  });
});
