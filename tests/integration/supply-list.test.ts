import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/infrastructure/database/prisma.client';

const app = createApp();

const OWNER_A = '+919622200001';
const OWNER_B = '+919622200002';
const CUST_PHONES = ['+919622200010', '+919622200011', '+919622200012'];
const ALL_PHONES = [OWNER_A, OWNER_B];

async function cleanup(): Promise<void> {
  const customers = await prisma.customer.findMany({ where: { phone: { in: CUST_PHONES } } });
  const customerIds = customers.map((c) => c.id);
  if (customerIds.length) {
    await prisma.supplyListCustomer.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.vendorCustomer.deleteMany({ where: { customerId: { in: customerIds } } });
  }

  const users = await prisma.user.findMany({ where: { phone: { in: ALL_PHONES } } });
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

  await prisma.userSession.deleteMany({
    where: { userId: { in: userIds.length ? userIds : [-1n] } },
  });
  await prisma.vendorUser.deleteMany({
    where: { OR: [{ userId: { in: userIds.length ? userIds : [-1n] } }, { vendorId: { in: vendorIds } }] },
  });
  if (vendorIds.length) await prisma.vendor.deleteMany({ where: { id: { in: vendorIds } } });
  if (customerIds.length) await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
  await prisma.user.deleteMany({ where: { phone: { in: ALL_PHONES } } });
}

interface Owner {
  token: string;
  vendorId: string;
}

async function signupOwner(phone: string, vendorName: string): Promise<Owner> {
  const res = await request(app)
    .post('/api/v1/auth/signup')
    .send({ phone, password: 'Owner@123', vendorName });
  expect(res.status).toBe(201);
  return {
    token: res.body.data.tokens.accessToken as string,
    vendorId: res.body.data.vendorContext.vendorId as string,
  };
}

async function seedCustomers(vendorId: string): Promise<string[]> {
  const ids: string[] = [];
  for (const phone of CUST_PHONES) {
    const customer = await prisma.customer.upsert({
      where: { phone },
      update: {},
      create: { phone, name: `Cust ${phone.slice(-3)}`, locality: 'Test' },
    });
    await prisma.vendorCustomer.upsert({
      where: { vendorId_customerId: { vendorId: BigInt(vendorId), customerId: customer.id } },
      update: {},
      create: { vendorId: BigInt(vendorId), customerId: customer.id, status: 'ACTIVE' },
    });
    ids.push(customer.id.toString());
  }
  return ids;
}

beforeAll(async () => {
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('US-005 Supply Lists — integration', () => {
  let owner: Owner;
  let ownerB: Owner;
  let customerIds: string[];
  let listId: string;
  let subscriptionId: string;

  const auth = (token: string): string => `Bearer ${token}`;

  beforeAll(async () => {
    owner = await signupOwner(OWNER_A, 'Dairy A');
    ownerB = await signupOwner(OWNER_B, 'Dairy B');
    customerIds = await seedCustomers(owner.vendorId);
  });

  it('POST /supply-lists — creates a DAILY list (201)', async () => {
    const res = await request(app)
      .post(`/api/v1/vendors/${owner.vendorId}/supply-lists`)
      .set('Authorization', auth(owner.token))
      .send({
        name: 'Morning Milk',
        supplyType: 'Milk',
        unit: 'ltr',
        defaultQuantity: 1,
        defaultRatePerUnit: 60,
        startTime: '06:30',
        frequency: 'DAILY',
      });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('active');
    expect(res.body.data).not.toHaveProperty('deletedAt');
    listId = res.body.data.id;
  });

  it('POST /supply-lists — duplicate name → 409', async () => {
    const res = await request(app)
      .post(`/api/v1/vendors/${owner.vendorId}/supply-lists`)
      .set('Authorization', auth(owner.token))
      .send({ name: 'morning milk', unit: 'ltr', frequency: 'DAILY' });
    expect(res.status).toBe(409);
    expect(res.body.error.correlationId).toBeDefined();
  });

  it('POST /supply-lists — WEEKLY requires frequencyDays → 400', async () => {
    const res = await request(app)
      .post(`/api/v1/vendors/${owner.vendorId}/supply-lists`)
      .set('Authorization', auth(owner.token))
      .send({ name: 'Weekly Bread', unit: 'pieces', frequency: 'WEEKLY' });
    expect(res.status).toBe(400);
  });

  it('GET /supply-lists — owner sees the list', async () => {
    const res = await request(app)
      .get(`/api/v1/vendors/${owner.vendorId}/supply-lists`)
      .set('Authorization', auth(owner.token));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
  });

  it('GET /supply-lists/:id — cross-tenant masked as 404', async () => {
    const res = await request(app)
      .get(`/api/v1/vendors/${ownerB.vendorId}/supply-lists/${listId}`)
      .set('Authorization', auth(ownerB.token));
    expect(res.status).toBe(404);
  });

  it('POST customers — bulk add with skip dedupe (201)', async () => {
    const res = await request(app)
      .post(`/api/v1/vendors/${owner.vendorId}/supply-lists/${listId}/customers`)
      .set('Authorization', auth(owner.token))
      .send({ customerIds });
    expect(res.status).toBe(201);
    expect(res.body.data.addedCount).toBe(customerIds.length);
    subscriptionId = res.body.data.subscriptions[0].subscriptionId;

    // Re-add → all already subscribed → 409.
    const res2 = await request(app)
      .post(`/api/v1/vendors/${owner.vendorId}/supply-lists/${listId}/customers`)
      .set('Authorization', auth(owner.token))
      .send({ customerIds });
    expect(res2.status).toBe(409);
  });

  it('GET customers — lists subscriptions with computed amount', async () => {
    const res = await request(app)
      .get(`/api/v1/vendors/${owner.vendorId}/supply-lists/${listId}/customers`)
      .set('Authorization', auth(owner.token));
    expect(res.status).toBe(200);
    expect(res.body.data[0].amount).toBe(60);
    expect(res.body.data[0]).not.toHaveProperty('vendorId');
  });

  it('GET available-customers — excludes subscribed', async () => {
    const res = await request(app)
      .get(`/api/v1/vendors/${owner.vendorId}/supply-lists/${listId}/available-customers`)
      .set('Authorization', auth(owner.token));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(0);
  });

  it('PATCH subscription — custom override changes amount', async () => {
    const res = await request(app)
      .patch(`/api/v1/vendors/${owner.vendorId}/supply-lists/${listId}/customers/${subscriptionId}`)
      .set('Authorization', auth(owner.token))
      .send({ quantity: 2 });
    expect(res.status).toBe(200);
    expect(res.body.data.amount).toBe(120);
    expect(res.body.data.isCustomQuantity).toBe(true);
  });

  it('PATCH subscription — pause then resume', async () => {
    const pause = await request(app)
      .patch(`/api/v1/vendors/${owner.vendorId}/supply-lists/${listId}/customers/${subscriptionId}`)
      .set('Authorization', auth(owner.token))
      .send({ status: 'paused' });
    expect(pause.status).toBe(200);
    expect(pause.body.data.status).toBe('paused');
  });

  it('DELETE subscription — ends it', async () => {
    const res = await request(app)
      .delete(`/api/v1/vendors/${owner.vendorId}/supply-lists/${listId}/customers/${subscriptionId}`)
      .set('Authorization', auth(owner.token));
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ended');
    expect(res.body.data.endDate).toBeDefined();
  });

  it('PATCH /supply-lists/:id — updates price', async () => {
    const res = await request(app)
      .patch(`/api/v1/vendors/${owner.vendorId}/supply-lists/${listId}`)
      .set('Authorization', auth(owner.token))
      .send({ defaultRatePerUnit: 65 });
    expect(res.status).toBe(200);
    expect(res.body.data.defaultRatePerUnit).toBe(65);
  });

  it('DELETE /supply-lists/:id — archives (200)', async () => {
    const res = await request(app)
      .delete(`/api/v1/vendors/${owner.vendorId}/supply-lists/${listId}`)
      .set('Authorization', auth(owner.token));
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('archived');

    // Archived list excluded from active listing.
    const list = await request(app)
      .get(`/api/v1/vendors/${owner.vendorId}/supply-lists?status=active`)
      .set('Authorization', auth(owner.token));
    expect(list.body.data.find((l: { id: string }) => l.id === listId)).toBeUndefined();
  });

  it('rejects unauthenticated requests (401)', async () => {
    const res = await request(app).get(`/api/v1/vendors/${owner.vendorId}/supply-lists`);
    expect(res.status).toBe(401);
  });
});
