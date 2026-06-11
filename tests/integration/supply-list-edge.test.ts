/**
 * Stream E: Edge case integration tests for US-005.
 * Covers: OQ-3 archive-is-terminal, OQ-4 otherLists cap + otherListsCount,
 * OQ-5 case-insensitive unique active name, OQ-2 zero stats,
 * subscription dedup (PAUSED customer → skip), validation boundaries,
 * WEEKLY/MONTHLY day-range rejection, deleted list mutations, ended-sub mutations,
 * staff-removed unassignAll, assign-list to missing list → 404, idempotent unassign.
 */
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/infrastructure/database/prisma.client';

const app = createApp();

const EDGE_OWNER_PHONE = '+919822299001';
const EDGE_OWNER2_PHONE = '+919822299002';
const EDGE_STAFF_PHONE = '+919822299003';
const EDGE_CUST_PHONES = [
  '+919822299010', '+919822299011', '+919822299012',
  '+919822299013', '+919822299014', '+919822299015', '+919822299016',
];

interface Owner { token: string; vendorId: string; }
interface StaffCtx { token: string; staffId: string; membershipId: string; }

async function cleanupEdge(): Promise<void> {
  const allPhones = [EDGE_OWNER_PHONE, EDGE_OWNER2_PHONE, EDGE_STAFF_PHONE, ...EDGE_CUST_PHONES];
  const custObjs = await prisma.customer.findMany({ where: { phone: { in: EDGE_CUST_PHONES } } });
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

async function signup(phone: string, name: string): Promise<Owner> {
  const res = await request(app).post('/api/v1/auth/signup').send({ phone, password: 'Edge@123', vendorName: name });
  expect(res.status).toBe(201);
  return { token: res.body.data.tokens.accessToken as string, vendorId: res.body.data.vendorContext.vendorId as string };
}

async function inviteStaff(ownerToken: string, vendorId: string): Promise<StaffCtx> {
  const inv = await request(app)
    .post(`/api/v1/vendors/${vendorId}/staff/invite`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ phone: EDGE_STAFF_PHONE, name: 'Edge Staff' });
  expect(inv.status).toBe(201);
  // Response: { staff: { staffId: "...", ... }, inviteUrl: "http://host/accept-invite?token=XXX", expiresAt }
  const inviteUrl = inv.body.data.inviteUrl as string;
  const membershipId = (inv.body.data.staff?.staffId ?? inv.body.data.staff?.id) as string;
  const rawToken = new URL(inviteUrl).searchParams.get('token') ?? '';
  const acc = await request(app).post('/api/v1/auth/accept-invite').send({ token: rawToken, password: 'Staff@123' });
  expect(acc.status).toBe(200);
  // staffId (vendor_user.id) is the membership id
  return { token: acc.body.data.tokens.accessToken as string, staffId: membershipId, membershipId };
}

async function createList(token: string, vendorId: string, body: object): Promise<string> {
  const res = await request(app)
    .post(`/api/v1/vendors/${vendorId}/supply-lists`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

async function seedCustomers(vendorId: string, phones: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const phone of phones) {
    const c = await prisma.customer.upsert({
      where: { phone },
      update: {},
      create: { phone, name: `E ${phone.slice(-3)}` },
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

beforeAll(async () => { await cleanupEdge(); });
afterAll(async () => { await cleanupEdge(); await prisma.$disconnect(); });

describe('US-005 — Edge Cases', () => {
  let owner: Owner;
  let owner2: Owner;
  let staff: StaffCtx;
  let custIds: string[];

  beforeAll(async () => {
    owner = await signup(EDGE_OWNER_PHONE, 'Edge Vendor');
    owner2 = await signup(EDGE_OWNER2_PHONE, 'Edge Vendor 2');
    staff = await inviteStaff(owner.token, owner.vendorId);
    custIds = await seedCustomers(owner.vendorId, EDGE_CUST_PHONES);
  });

  // ============================================================
  // OQ-3: Archive is terminal — no re-archive, no mutation after archive
  // ============================================================
  describe('OQ-3: Archive is terminal', () => {
    let archivedListId: string;

    beforeAll(async () => {
      archivedListId = await createList(owner.token, owner.vendorId, { name: 'To Be Archived', unit: 'kg', frequency: 'DAILY' });
      const del = await request(app)
        .delete(`/api/v1/vendors/${owner.vendorId}/supply-lists/${archivedListId}`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(del.status).toBe(200);
      expect(del.body.data.status).toBe('archived');
    });

    it('archived list is excluded from active listing', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${owner.vendorId}/supply-lists?status=active`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.find((l: { id: string }) => l.id === archivedListId)).toBeUndefined();
    });

    it('archived list appears with status=archived filter', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${owner.vendorId}/supply-lists?status=archived`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.find((l: { id: string }) => l.id === archivedListId)).toBeDefined();
    });

    it('PATCH on archived list → 404 (archived lists reject mutation)', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${owner.vendorId}/supply-lists/${archivedListId}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ name: 'Mutation Attempt' });
      expect(res.status).toBe(404);
    });

    it('POST staff on archived list → 404', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${owner.vendorId}/supply-lists/${archivedListId}/staff`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ staffId: staff.staffId });
      expect(res.status).toBe(404);
    });

    it('POST customers on archived list → 404', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${owner.vendorId}/supply-lists/${archivedListId}/customers`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ customerIds: [custIds[0]] });
      expect(res.status).toBe(404);
    });

    it('second DELETE on archived list → 404', async () => {
      const res = await request(app)
        .delete(`/api/v1/vendors/${owner.vendorId}/supply-lists/${archivedListId}`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(res.status).toBe(404);
    });

    // BUG-4: archived lists are terminal and must reject reads, not just mutations.
    it('GET customers on archived list → 404', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${owner.vendorId}/supply-lists/${archivedListId}/customers`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(res.status).toBe(404);
    });

    it('GET available-customers on archived list → 404', async () => {
      const res = await request(app)
        .get(
          `/api/v1/vendors/${owner.vendorId}/supply-lists/${archivedListId}/available-customers`
        )
        .set('Authorization', `Bearer ${owner.token}`);
      expect(res.status).toBe(404);
    });
  });

  // ============================================================
  // OQ-5: Case-insensitive unique active list name → 409
  // ============================================================
  describe('OQ-5: Case-insensitive unique active list name', () => {
    let uniqListId: string;

    beforeAll(async () => {
      uniqListId = await createList(owner.token, owner.vendorId, { name: 'Morning Bread', unit: 'pieces', frequency: 'DAILY' });
    });

    it('exact duplicate name → 409', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${owner.vendorId}/supply-lists`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ name: 'Morning Bread', unit: 'pieces', frequency: 'DAILY' });
      expect(res.status).toBe(409);
      expect(res.body.error?.correlationId).toBeDefined();
    });

    it('case-insensitive duplicate → 409', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${owner.vendorId}/supply-lists`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ name: 'MORNING BREAD', unit: 'pieces', frequency: 'DAILY' });
      expect(res.status).toBe(409);
    });

    it('mixed-case duplicate → 409', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${owner.vendorId}/supply-lists`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ name: 'mOrNiNg bReAd', unit: 'pieces', frequency: 'DAILY' });
      expect(res.status).toBe(409);
    });

    it('same name on different vendor is allowed', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${owner2.vendorId}/supply-lists`)
        .set('Authorization', `Bearer ${owner2.token}`)
        .send({ name: 'Morning Bread', unit: 'pieces', frequency: 'DAILY' });
      expect(res.status).toBe(201);
    });

    it('PATCH rename to existing active name → 409', async () => {
      const secondList = await createList(owner.token, owner.vendorId, {
        name: 'Evening Bread',
        unit: 'pieces',
        frequency: 'DAILY',
      });
      const res = await request(app)
        .patch(`/api/v1/vendors/${owner.vendorId}/supply-lists/${secondList}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ name: 'Morning Bread' });
      expect(res.status).toBe(409);
    });

    it('PATCH to same name (no change) → 200', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${owner.vendorId}/supply-lists/${uniqListId}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ name: 'Morning Bread' });
      expect(res.status).toBe(200);
    });
  });

  // ============================================================
  // OQ-2: todayStats and monthStats return zeros (stub)
  // ============================================================
  describe('OQ-2: DeliveryStatsPort stub returns zeros', () => {
    let zeroStatsListId: string;

    beforeAll(async () => {
      zeroStatsListId = await createList(owner.token, owner.vendorId, {
        name: 'Zero Stats List',
        unit: 'ltr',
        frequency: 'DAILY',
        defaultQuantity: 1,
        defaultRatePerUnit: 50,
      });
    });

    it('GET supply-list returns zeroed todayStats', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${owner.vendorId}/supply-lists/${zeroStatsListId}`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.todayStats).toBeDefined();
      expect(res.body.data.todayStats.delivered).toBe(0);
      expect(res.body.data.todayStats.onLeave).toBe(0);
      expect(res.body.data.todayStats.pending).toBe(0);
    });

    it('GET supply-list returns zeroed monthStats', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${owner.vendorId}/supply-lists/${zeroStatsListId}`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.monthStats).toBeDefined();
      expect(res.body.data.monthStats.daysCompleted).toBe(0);
      expect(res.body.data.monthStats.totalQuantity).toBe(0);
      expect(res.body.data.monthStats.revenue).toBe(0);
    });

    it('GET supply-lists (list view) has todayStats on each item', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${owner.vendorId}/supply-lists`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(res.status).toBe(200);
      for (const item of res.body.data) {
        expect(item.todayStats).toBeDefined();
        expect(typeof item.todayStats.delivered).toBe('number');
      }
    });
  });

  // ============================================================
  // OQ-4: otherLists capped to 5 names + otherListsCount
  // ============================================================
  describe('OQ-4: otherLists cap at 5, otherListsCount accurate', () => {
    it('otherLists capped to 5 when customer in many lists, otherListsCount reflects all', async () => {
      // Create 6 additional lists for the same vendor
      const listIds: string[] = [];
      for (let i = 1; i <= 6; i++) {
        const id = await createList(owner.token, owner.vendorId, {
          name: `OQ4 List ${i}`,
          unit: 'ltr',
          frequency: 'DAILY',
          defaultQuantity: 1,
          defaultRatePerUnit: 10,
        });
        listIds.push(id);
      }

      // Subscribe a single customer to all 6 lists
      const testCustId = custIds[0]!;
      for (const lid of listIds) {
        await request(app)
          .post(`/api/v1/vendors/${owner.vendorId}/supply-lists/${lid}/customers`)
          .set('Authorization', `Bearer ${owner.token}`)
          .send({ customerIds: [testCustId] });
      }

      // Create one more list and check otherLists for that customer
      const focusListId = await createList(owner.token, owner.vendorId, {
        name: 'OQ4 Focus List',
        unit: 'ltr',
        frequency: 'DAILY',
        defaultQuantity: 1,
        defaultRatePerUnit: 10,
      });
      await request(app)
        .post(`/api/v1/vendors/${owner.vendorId}/supply-lists/${focusListId}/customers`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ customerIds: [testCustId] });

      const res = await request(app)
        .get(`/api/v1/vendors/${owner.vendorId}/supply-lists/${focusListId}/customers`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(res.status).toBe(200);

      const subscription = res.body.data.find(
        (s: { customerId: string }) => s.customerId === testCustId
      );
      expect(subscription).toBeDefined();
      // otherLists should be capped at 5
      expect(subscription.otherLists.length).toBeLessThanOrEqual(5);
      // otherListsCount should reflect the actual total (6 other lists)
      expect(subscription.otherListsCount).toBeGreaterThanOrEqual(6);
    });
  });

  // ============================================================
  // Subscription dedup: PAUSED customer (non-ended) → skip/409
  // ============================================================
  describe('Subscription dedup — PAUSED customer is not re-added', () => {
    let dedupListId: string;
    let dedupSubId: string;

    beforeAll(async () => {
      dedupListId = await createList(owner.token, owner.vendorId, {
        name: 'Dedup List',
        unit: 'ltr',
        frequency: 'DAILY',
        defaultQuantity: 1,
        defaultRatePerUnit: 50,
      });
      const addRes = await request(app)
        .post(`/api/v1/vendors/${owner.vendorId}/supply-lists/${dedupListId}/customers`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ customerIds: [custIds[1]] });
      expect(addRes.status).toBe(201);
      dedupSubId = addRes.body.data.subscriptions[0].subscriptionId;

      // Pause the customer
      await request(app)
        .patch(`/api/v1/vendors/${owner.vendorId}/supply-lists/${dedupListId}/customers/${dedupSubId}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ status: 'paused' });
    });

    it('re-adding a PAUSED customer (non-ended) is skipped/409', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${owner.vendorId}/supply-lists/${dedupListId}/customers`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ customerIds: [custIds[1]] });
      // All customers already subscribed (non-ended includes PAUSED) → 409
      expect(res.status).toBe(409);
    });

    it('ended customer CAN be re-added', async () => {
      // End the subscription first
      await request(app)
        .delete(`/api/v1/vendors/${owner.vendorId}/supply-lists/${dedupListId}/customers/${dedupSubId}`)
        .set('Authorization', `Bearer ${owner.token}`);

      // Re-add should succeed
      const res = await request(app)
        .post(`/api/v1/vendors/${owner.vendorId}/supply-lists/${dedupListId}/customers`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ customerIds: [custIds[1]] });
      expect(res.status).toBe(201);
      expect(res.body.data.addedCount).toBe(1);
    });
  });

  // ============================================================
  // Validation boundaries
  // ============================================================
  describe('Validation boundaries', () => {
    describe('WEEKLY frequencyDays out of range', () => {
      it('frequencyDays with 0 → 400', async () => {
        const res = await request(app)
          .post(`/api/v1/vendors/${owner.vendorId}/supply-lists`)
          .set('Authorization', `Bearer ${owner.token}`)
          .send({ name: 'Bad Weekly', unit: 'ltr', frequency: 'WEEKLY', frequencyDays: [0] });
        expect(res.status).toBe(400);
      });

      it('frequencyDays with 8 → 400', async () => {
        const res = await request(app)
          .post(`/api/v1/vendors/${owner.vendorId}/supply-lists`)
          .set('Authorization', `Bearer ${owner.token}`)
          .send({ name: 'Bad Weekly 2', unit: 'ltr', frequency: 'WEEKLY', frequencyDays: [8] });
        expect(res.status).toBe(400);
      });

      it('WEEKLY with frequencyDays [1..7] → 201', async () => {
        const res = await request(app)
          .post(`/api/v1/vendors/${owner.vendorId}/supply-lists`)
          .set('Authorization', `Bearer ${owner.token}`)
          .send({
            name: 'Valid Weekly',
            unit: 'ltr',
            frequency: 'WEEKLY',
            frequencyDays: [1, 3, 5, 7],
          });
        expect(res.status).toBe(201);
      });
    });

    describe('MONTHLY frequencyDays out of range', () => {
      it('frequencyDays with 0 → 400', async () => {
        const res = await request(app)
          .post(`/api/v1/vendors/${owner.vendorId}/supply-lists`)
          .set('Authorization', `Bearer ${owner.token}`)
          .send({ name: 'Bad Monthly', unit: 'kg', frequency: 'MONTHLY', frequencyDays: [0] });
        expect(res.status).toBe(400);
      });

      it('frequencyDays with 32 → 400', async () => {
        const res = await request(app)
          .post(`/api/v1/vendors/${owner.vendorId}/supply-lists`)
          .set('Authorization', `Bearer ${owner.token}`)
          .send({ name: 'Bad Monthly 2', unit: 'kg', frequency: 'MONTHLY', frequencyDays: [32] });
        expect(res.status).toBe(400);
      });

      it('MONTHLY with frequencyDays [1..31] → 201', async () => {
        const res = await request(app)
          .post(`/api/v1/vendors/${owner.vendorId}/supply-lists`)
          .set('Authorization', `Bearer ${owner.token}`)
          .send({
            name: 'Valid Monthly',
            unit: 'kg',
            frequency: 'MONTHLY',
            frequencyDays: [1, 15, 31],
          });
        expect(res.status).toBe(201);
      });
    });

    describe('PATCH validator — WEEKLY frequencyDays out of range', () => {
      let testListId: string;

      beforeAll(async () => {
        testListId = await createList(owner.token, owner.vendorId, {
          name: 'Patch Boundary Test',
          unit: 'ltr',
          frequency: 'DAILY',
        });
      });

      it('PATCH frequency=WEEKLY without frequencyDays → 400', async () => {
        const res = await request(app)
          .patch(`/api/v1/vendors/${owner.vendorId}/supply-lists/${testListId}`)
          .set('Authorization', `Bearer ${owner.token}`)
          .send({ frequency: 'WEEKLY' });
        expect(res.status).toBe(400);
      });

      it('PATCH frequency=WEEKLY frequencyDays=[0] → 400', async () => {
        const res = await request(app)
          .patch(`/api/v1/vendors/${owner.vendorId}/supply-lists/${testListId}`)
          .set('Authorization', `Bearer ${owner.token}`)
          .send({ frequency: 'WEEKLY', frequencyDays: [0] });
        expect(res.status).toBe(400);
      });

      it('PATCH frequency=WEEKLY frequencyDays=[8] → 400', async () => {
        const res = await request(app)
          .patch(`/api/v1/vendors/${owner.vendorId}/supply-lists/${testListId}`)
          .set('Authorization', `Bearer ${owner.token}`)
          .send({ frequency: 'WEEKLY', frequencyDays: [8] });
        expect(res.status).toBe(400);
      });
    });

    describe('Strict schema — unknown fields rejected', () => {
      it('unknown field in create body → 400', async () => {
        const res = await request(app)
          .post(`/api/v1/vendors/${owner.vendorId}/supply-lists`)
          .set('Authorization', `Bearer ${owner.token}`)
          .send({
            name: 'Strict Test',
            unit: 'ltr',
            frequency: 'DAILY',
            unknownField: 'should_be_rejected',
          });
        expect(res.status).toBe(400);
      });

      it('unknown field in assign-staff body → 400', async () => {
        const listId = await createList(owner.token, owner.vendorId, { name: 'Strict Staff Test', unit: 'ltr', frequency: 'DAILY' });
        const res = await request(app)
          .post(`/api/v1/vendors/${owner.vendorId}/supply-lists/${listId}/staff`)
          .set('Authorization', `Bearer ${owner.token}`)
          .send({ staffId: staff.staffId, isPrimary: false, extraField: 'bad' });
        expect(res.status).toBe(400);
      });
    });

    describe('Name and unit edge cases', () => {
      it('empty name → 400', async () => {
        const res = await request(app)
          .post(`/api/v1/vendors/${owner.vendorId}/supply-lists`)
          .set('Authorization', `Bearer ${owner.token}`)
          .send({ name: '', unit: 'ltr', frequency: 'DAILY' });
        expect(res.status).toBe(400);
      });

      it('name > 100 chars → 400', async () => {
        const res = await request(app)
          .post(`/api/v1/vendors/${owner.vendorId}/supply-lists`)
          .set('Authorization', `Bearer ${owner.token}`)
          .send({ name: 'A'.repeat(101), unit: 'ltr', frequency: 'DAILY' });
        expect(res.status).toBe(400);
      });

      it('invalid unit → 400', async () => {
        const res = await request(app)
          .post(`/api/v1/vendors/${owner.vendorId}/supply-lists`)
          .set('Authorization', `Bearer ${owner.token}`)
          .send({ name: 'Unit Test', unit: 'barrels', frequency: 'DAILY' });
        expect(res.status).toBe(400);
      });

      it('negative defaultQuantity → 400', async () => {
        const res = await request(app)
          .post(`/api/v1/vendors/${owner.vendorId}/supply-lists`)
          .set('Authorization', `Bearer ${owner.token}`)
          .send({ name: 'Neg Qty', unit: 'ltr', frequency: 'DAILY', defaultQuantity: -1 });
        expect(res.status).toBe(400);
      });

      it('invalid startTime format → 400', async () => {
        const res = await request(app)
          .post(`/api/v1/vendors/${owner.vendorId}/supply-lists`)
          .set('Authorization', `Bearer ${owner.token}`)
          .send({ name: 'Bad Time', unit: 'ltr', frequency: 'DAILY', startTime: '6:30' });
        expect(res.status).toBe(400);
      });
    });

    describe('Add-customers validation', () => {
      let acListId: string;

      beforeAll(async () => {
        acListId = await createList(owner.token, owner.vendorId, {
          name: 'AddCust Validate',
          unit: 'ltr',
          frequency: 'DAILY',
          defaultQuantity: 1,
          defaultRatePerUnit: 50,
        });
      });

      it('empty customerIds array → 400', async () => {
        const res = await request(app)
          .post(`/api/v1/vendors/${owner.vendorId}/supply-lists/${acListId}/customers`)
          .set('Authorization', `Bearer ${owner.token}`)
          .send({ customerIds: [] });
        expect(res.status).toBe(400);
      });

      it('useDefaultQuantity=false without customQuantity → 400', async () => {
        const res = await request(app)
          .post(`/api/v1/vendors/${owner.vendorId}/supply-lists/${acListId}/customers`)
          .set('Authorization', `Bearer ${owner.token}`)
          .send({ customerIds: [custIds[2]], useDefaultQuantity: false });
        expect(res.status).toBe(400);
      });

      it('useDefaultRate=false without customRate → 400', async () => {
        const res = await request(app)
          .post(`/api/v1/vendors/${owner.vendorId}/supply-lists/${acListId}/customers`)
          .set('Authorization', `Bearer ${owner.token}`)
          .send({ customerIds: [custIds[2]], useDefaultRate: false });
        expect(res.status).toBe(400);
      });

      it('customer not in vendor → 422', async () => {
        const res = await request(app)
          .post(`/api/v1/vendors/${owner.vendorId}/supply-lists/${acListId}/customers`)
          .set('Authorization', `Bearer ${owner.token}`)
          .send({ customerIds: ['999999999'] });
        expect(res.status).toBe(422);
      });

      // BUG-3: a list with no default quantity (and no custom quantity provided)
      // must yield a clean 422, not an unhandled 500 leaking domain internals.
      it('add customer to list with no default quantity → 422 (not 500)', async () => {
        const noDefaultListId = await createList(owner.token, owner.vendorId, {
          name: 'No Default Qty List',
          unit: 'ltr',
          frequency: 'DAILY',
        });
        const res = await request(app)
          .post(`/api/v1/vendors/${owner.vendorId}/supply-lists/${noDefaultListId}/customers`)
          .set('Authorization', `Bearer ${owner.token}`)
          .send({ customerIds: [custIds[3]] });
        expect(res.status).toBe(422);
        expect(res.body.error.code).toBe('UNPROCESSABLE_ENTITY');
        expect(res.body.error.message).not.toMatch(/stack|prisma|undefined/i);
      });
    });
  });

  // ============================================================
  // Staff assignment edge cases
  // ============================================================
  describe('Staff assignment edge cases', () => {
    let staffListId: string;

    beforeAll(async () => {
      staffListId = await createList(owner.token, owner.vendorId, {
        name: 'Staff Assignment Test',
        unit: 'ltr',
        frequency: 'DAILY',
      });
    });

    it('assign staff to missing list → 404', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${owner.vendorId}/supply-lists/999999999/staff`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ staffId: staff.staffId, isPrimary: false });
      expect(res.status).toBe(404);
    });

    it('assign staff from different vendor → 422', async () => {
      // Get the staffId of owner2's own membership (owner role is not valid staff to assign)
      // We can test with a non-existent vendor_user_id
      const res = await request(app)
        .post(`/api/v1/vendors/${owner.vendorId}/supply-lists/${staffListId}/staff`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ staffId: '999999999', isPrimary: false });
      expect(res.status).toBe(422);
    });

    it('assign same staff twice → 409', async () => {
      const first = await request(app)
        .post(`/api/v1/vendors/${owner.vendorId}/supply-lists/${staffListId}/staff`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ staffId: staff.staffId, isPrimary: false });
      expect(first.status).toBe(201);

      const second = await request(app)
        .post(`/api/v1/vendors/${owner.vendorId}/supply-lists/${staffListId}/staff`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ staffId: staff.staffId, isPrimary: false });
      expect(second.status).toBe(409);
    });

    it('unassign idempotent — second unassign → 404', async () => {
      const unassign1 = await request(app)
        .delete(`/api/v1/vendors/${owner.vendorId}/supply-lists/${staffListId}/staff/${staff.staffId}`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(unassign1.status).toBe(200);

      const unassign2 = await request(app)
        .delete(`/api/v1/vendors/${owner.vendorId}/supply-lists/${staffListId}/staff/${staff.staffId}`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(unassign2.status).toBe(404);
    });

    it('assign with isPrimary=true → demotes previous primary', async () => {
      const secondStaffPhone = '+919822299098';
      // Create a second staff member
      const inv2 = await request(app)
        .post(`/api/v1/vendors/${owner.vendorId}/staff/invite`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ phone: secondStaffPhone, name: 'Staff 2' });

      if (inv2.status === 201) {
        const inviteUrl2 = inv2.body.data.inviteUrl as string;
        const staffId2 = (inv2.body.data.staff?.staffId ?? inv2.body.data.staff?.id) as string;
        const rawToken2 = new URL(inviteUrl2).searchParams.get('token') ?? '';
        await request(app).post('/api/v1/auth/accept-invite').send({ token: rawToken2, password: 'Staff2@123' });

        // Create a fresh list and assign first as primary
        const pListId = await createList(owner.token, owner.vendorId, { name: 'Primary Demotion List', unit: 'ltr', frequency: 'DAILY' });
        await request(app)
          .post(`/api/v1/vendors/${owner.vendorId}/supply-lists/${pListId}/staff`)
          .set('Authorization', `Bearer ${owner.token}`)
          .send({ staffId: staff.staffId, isPrimary: true });

        // Assign second as primary — first should be demoted
        await request(app)
          .post(`/api/v1/vendors/${owner.vendorId}/supply-lists/${pListId}/staff`)
          .set('Authorization', `Bearer ${owner.token}`)
          .send({ staffId: staffId2, isPrimary: true });

        const getRes = await request(app)
          .get(`/api/v1/vendors/${owner.vendorId}/supply-lists/${pListId}`)
          .set('Authorization', `Bearer ${owner.token}`);
        const primaries = getRes.body.data.assignedStaff.filter((s: { isPrimary: boolean }) => s.isPrimary);
        expect(primaries).toHaveLength(1);
        expect(primaries[0].staffId).toBe(staffId2);
      }
    });
  });

  // ============================================================
  // Staff-removed → unassignAll (edge #5)
  // ============================================================
  describe('StaffRemovedEvent → unassignAll clears supply_list_staff rows', () => {
    it('removing a staff member clears their supply list assignments', async () => {
      const removeStaffPhone = '+919822299099';
      // Create new staff
      const inv = await request(app)
        .post(`/api/v1/vendors/${owner.vendorId}/staff/invite`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ phone: removeStaffPhone, name: 'Removable Staff' });
      if (inv.status !== 201) return; // skip if already exists from prior run

      const inviteUrlRemove = inv.body.data.inviteUrl as string;
      const removableStaffId = (inv.body.data.staff?.staffId ?? inv.body.data.staff?.id) as string;
      const invTokenRemove = new URL(inviteUrlRemove).searchParams.get('token') ?? '';
      await request(app).post('/api/v1/auth/accept-invite').send({ token: invTokenRemove, password: 'Remove@123' });

      // Create a list and assign this staff
      const removeListId = await createList(owner.token, owner.vendorId, {
        name: 'Remove Staff List',
        unit: 'ltr',
        frequency: 'DAILY',
      });
      await request(app)
        .post(`/api/v1/vendors/${owner.vendorId}/supply-lists/${removeListId}/staff`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ staffId: removableStaffId, isPrimary: false });

      // Confirm staff is assigned
      const beforeRemove = await request(app)
        .get(`/api/v1/vendors/${owner.vendorId}/supply-lists/${removeListId}`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(beforeRemove.body.data.assignedStaff.length).toBeGreaterThan(0);

      // Remove the staff member
      const removeRes = await request(app)
        .delete(`/api/v1/vendors/${owner.vendorId}/staff/${removableStaffId}`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(removeRes.status).toBe(200);

      // After staff removal, the supply_list_staff row should be gone
      const afterRemove = await request(app)
        .get(`/api/v1/vendors/${owner.vendorId}/supply-lists/${removeListId}`)
        .set('Authorization', `Bearer ${owner.token}`);
      const assignedIds = afterRemove.body.data.assignedStaff.map(
        (s: { staffId: string }) => s.staffId
      );
      expect(assignedIds).not.toContain(removableStaffId);

      // Cleanup the test phone
      await prisma.user.deleteMany({ where: { phone: removeStaffPhone } });
    });
  });

  // ============================================================
  // Mutation on ended subscription → 422 (invalid transition)
  // ============================================================
  describe('Ended subscription → mutation rejected', () => {
    let endedListId: string;
    let endedSubId: string;

    beforeAll(async () => {
      endedListId = await createList(owner.token, owner.vendorId, {
        name: 'Ended Sub Test',
        unit: 'ltr',
        frequency: 'DAILY',
        defaultQuantity: 1,
        defaultRatePerUnit: 50,
      });
      const addRes = await request(app)
        .post(`/api/v1/vendors/${owner.vendorId}/supply-lists/${endedListId}/customers`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ customerIds: [custIds[3]] });
      expect(addRes.status).toBe(201);
      endedSubId = addRes.body.data.subscriptions[0].subscriptionId;

      // End it
      await request(app)
        .delete(`/api/v1/vendors/${owner.vendorId}/supply-lists/${endedListId}/customers/${endedSubId}`)
        .set('Authorization', `Bearer ${owner.token}`);
    });

    it('pausing an ended subscription → 422', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${owner.vendorId}/supply-lists/${endedListId}/customers/${endedSubId}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ status: 'paused' });
      expect(res.status).toBe(422);
    });

    it('resuming an ended subscription → 422', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${owner.vendorId}/supply-lists/${endedListId}/customers/${endedSubId}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ status: 'active' });
      expect(res.status).toBe(422);
    });

    it('ending an already-ended subscription → 422', async () => {
      const res = await request(app)
        .delete(`/api/v1/vendors/${owner.vendorId}/supply-lists/${endedListId}/customers/${endedSubId}`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(res.status).toBe(422);
    });
  });

  // ============================================================
  // PATCH subscription — at-least-one-field enforcement
  // ============================================================
  describe('PATCH subscription — at least one field', () => {
    let patchListId: string;
    let patchSubId: string;

    beforeAll(async () => {
      patchListId = await createList(owner.token, owner.vendorId, {
        name: 'Patch Sub Field Test',
        unit: 'ltr',
        frequency: 'DAILY',
        defaultQuantity: 1,
        defaultRatePerUnit: 50,
      });
      const addRes = await request(app)
        .post(`/api/v1/vendors/${owner.vendorId}/supply-lists/${patchListId}/customers`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ customerIds: [custIds[4]] });
      patchSubId = addRes.body.data.subscriptions[0].subscriptionId;
    });

    it('empty PATCH body → 400', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${owner.vendorId}/supply-lists/${patchListId}/customers/${patchSubId}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({});
      expect(res.status).toBe(400);
    });

    it('unknown field in PATCH subscription → 400 (strict)', async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${owner.vendorId}/supply-lists/${patchListId}/customers/${patchSubId}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ unknownField: 'bad' });
      expect(res.status).toBe(400);
    });

    it("'ended' in PATCH status is rejected (must use DELETE)", async () => {
      const res = await request(app)
        .patch(`/api/v1/vendors/${owner.vendorId}/supply-lists/${patchListId}/customers/${patchSubId}`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ status: 'ended' });
      expect(res.status).toBe(400);
    });
  });

  // ============================================================
  // Pagination — list and customer endpoints
  // ============================================================
  describe('Pagination', () => {
    it('page/limit respected in supply-lists', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${owner.vendorId}/supply-lists?page=1&limit=2`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeLessThanOrEqual(2);
      expect(res.body.meta.page).toBe(1);
      expect(res.body.meta.limit).toBe(2);
    });

    it('page 999 → empty data, total unchanged', async () => {
      const res = await request(app)
        .get(`/api/v1/vendors/${owner.vendorId}/supply-lists?page=999&limit=20`)
        .set('Authorization', `Bearer ${owner.token}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
      expect(res.body.meta.total).toBeGreaterThanOrEqual(0);
    });
  });

  // ============================================================
  // Staff module rewire (assign-list / unassign-list via staff endpoint)
  // ============================================================
  describe('Staff module rewire — assign-list / unassign-list do real writes', () => {
    let rewireListId: string;

    beforeAll(async () => {
      rewireListId = await createList(owner.token, owner.vendorId, {
        name: 'Staff Rewire List',
        unit: 'ltr',
        frequency: 'DAILY',
      });
    });

    it('POST /staff/:staffId/assign-list performs real write (not 503)', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${owner.vendorId}/staff/${staff.staffId}/assign-list`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ supplyListId: rewireListId, isPrimary: false });
      // Should succeed or 409 if already assigned, but never 503
      expect(res.status).not.toBe(503);
      expect([200, 201, 409]).toContain(res.status);
    });

    it('POST /staff/:staffId/assign-list to missing list → 404', async () => {
      const res = await request(app)
        .post(`/api/v1/vendors/${owner.vendorId}/staff/${staff.staffId}/assign-list`)
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ supplyListId: '999999999', isPrimary: false });
      expect(res.status).toBe(404);
    });

    it('DELETE /staff/:staffId/unassign-list performs real write (not 503)', async () => {
      const res = await request(app)
        .delete(`/api/v1/vendors/${owner.vendorId}/staff/${staff.staffId}/unassign-list/${rewireListId}`)
        .set('Authorization', `Bearer ${owner.token}`);
      // Should succeed or 404 if already unassigned, but never 503
      expect(res.status).not.toBe(503);
      expect([200, 404]).toContain(res.status);
    });
  });
});
