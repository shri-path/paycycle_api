import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/infrastructure/database/prisma.client';

const app = createApp();

// Test phone numbers to clean up after
const TEST_PHONE = '+919111222333';
const TEST_PHONE_2 = '+919444555666';
const TEST_VENDOR_NAME = 'Integration Test Vendor';

async function cleanupTestData() {
  // Clean sessions first, then tokens, then vendor users, then users/vendors
  await prisma.userSession.deleteMany({
    where: {
      user: { phone: { in: [TEST_PHONE, TEST_PHONE_2] } },
    },
  });
  await prisma.passwordResetToken.deleteMany({
    where: {
      user: { phone: { in: [TEST_PHONE, TEST_PHONE_2] } },
    },
  });
  await prisma.vendorUser.deleteMany({
    where: {
      user: { phone: { in: [TEST_PHONE, TEST_PHONE_2] } },
    },
  });
  const users = await prisma.user.findMany({
    where: { phone: { in: [TEST_PHONE, TEST_PHONE_2] } },
  });
  const userIds = users.map((u) => u.id);
  // Delete vendors created by these users
  if (userIds.length > 0) {
    const vendorUserRows = await prisma.vendorUser.findMany({
      where: { userId: { in: userIds } },
    });
    const vendorIds = vendorUserRows.map((vu) => vu.vendorId);
    if (vendorIds.length > 0) {
      await prisma.vendor.deleteMany({ where: { id: { in: vendorIds } } });
    }
  }
  await prisma.user.deleteMany({ where: { phone: { in: [TEST_PHONE, TEST_PHONE_2] } } });
}

beforeAll(async () => {
  await cleanupTestData();
});

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

describe('POST /api/v1/auth/signup', () => {
  it('201 — valid signup creates user, vendor, returns tokens', async () => {
    const res = await request(app).post('/api/v1/auth/signup').send({
      phone: TEST_PHONE,
      password: 'Test@123x',
      vendorName: TEST_VENDOR_NAME,
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.phone).toBe(TEST_PHONE);
    expect(res.body.data.tokens.accessToken).toBeTruthy();
    expect(res.body.data.tokens.refreshToken).toBeTruthy();
    expect(res.body.data.vendorContext.vendorName).toBe(TEST_VENDOR_NAME);
    expect(res.body.data.vendorContext.role).toBe('vendor_owner');
    // Sensitive fields must not be exposed
    expect(res.body.data.user.passwordHash).toBeUndefined();
    expect(res.body.data.user.deletedAt).toBeUndefined();
  });

  it('400 — missing phone', async () => {
    const res = await request(app).post('/api/v1/auth/signup').send({
      password: 'Test@123x',
      vendorName: 'Test',
    });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('400 — invalid phone format', async () => {
    const res = await request(app).post('/api/v1/auth/signup').send({
      phone: 'notaphone',
      password: 'Test@123x',
      vendorName: 'Test',
    });
    expect(res.status).toBe(400);
  });

  it('400 — weak password', async () => {
    const res = await request(app).post('/api/v1/auth/signup').send({
      phone: TEST_PHONE_2,
      password: 'weak',
      vendorName: 'Test',
    });
    expect(res.status).toBe(400);
  });

  it('400 — missing vendorName', async () => {
    const res = await request(app).post('/api/v1/auth/signup').send({
      phone: TEST_PHONE_2,
      password: 'Test@123x',
    });
    expect(res.status).toBe(400);
  });

  it('409 — duplicate phone', async () => {
    const res = await request(app).post('/api/v1/auth/signup').send({
      phone: TEST_PHONE, // already registered above
      password: 'Test@123x',
      vendorName: 'Another Vendor',
    });
    expect(res.status).toBe(409);
  });

  it('400 — unknown fields rejected (strict schema)', async () => {
    const res = await request(app).post('/api/v1/auth/signup').send({
      phone: TEST_PHONE_2,
      password: 'Test@123x',
      vendorName: 'Test',
      unknownField: 'should be rejected',
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/auth/login', () => {
  it('200 — valid credentials returns user, tokens, vendorContexts', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({
      phone: TEST_PHONE,
      password: 'Test@123x',
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.phone).toBe(TEST_PHONE);
    expect(res.body.data.tokens.accessToken).toBeTruthy();
    expect(Array.isArray(res.body.data.vendorContexts)).toBe(true);
  });

  it('401 — phone not found returns generic error', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({
      phone: '+919999999999',
      password: 'Test@123x',
    });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Invalid credentials');
  });

  it('401 — wrong password returns same generic error', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({
      phone: TEST_PHONE,
      password: 'WrongPass!1',
    });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Invalid credentials');
  });

  it('400 — invalid phone format', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({
      phone: 'bad',
      password: 'Test@123x',
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/auth/refresh', () => {
  let refreshToken: string;

  beforeAll(async () => {
    const loginRes = await request(app).post('/api/v1/auth/login').send({
      phone: TEST_PHONE,
      password: 'Test@123x',
    });
    refreshToken = loginRes.body.data.tokens.refreshToken as string;
  });

  it('200 — valid refresh token returns new tokens', async () => {
    const res = await request(app).post('/api/v1/auth/refresh').send({ refreshToken });
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.refreshToken).toBeTruthy();
  });

  it('401 — invalid JWT string', async () => {
    const res = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: 'invalid.jwt' });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/auth/forgot-password', () => {
  it('200 — existing phone returns success', async () => {
    const res = await request(app).post('/api/v1/auth/forgot-password').send({ phone: TEST_PHONE });
    expect(res.status).toBe(200);
    expect(res.body.data.message).toContain('OTP');
  });

  it('200 — non-existing phone returns same success (enumeration prevention)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ phone: '+919888888888' });
    expect(res.status).toBe(200);
    expect(res.body.data.message).toContain('OTP');
  });

  it('400 — invalid phone format', async () => {
    const res = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ phone: 'bad' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/auth/reset-password', () => {
  it('400 — wrong OTP code', async () => {
    const res = await request(app).post('/api/v1/auth/reset-password').send({
      phone: TEST_PHONE,
      resetToken: 'fake-reset-token',
      otpCode: '000000',
      newPassword: 'NewPass@123',
    });
    expect(res.status).toBe(400);
  });

  it('400 — invalid otpCode format (not 6 digits)', async () => {
    const res = await request(app).post('/api/v1/auth/reset-password').send({
      phone: TEST_PHONE,
      resetToken: 'some-token',
      otpCode: 'abcdef',
      newPassword: 'NewPass@123',
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/auth/logout', () => {
  let accessToken: string;
  let refreshToken: string;

  beforeAll(async () => {
    const loginRes = await request(app).post('/api/v1/auth/login').send({
      phone: TEST_PHONE,
      password: 'Test@123x',
    });
    accessToken = loginRes.body.data.tokens.accessToken as string;
    refreshToken = loginRes.body.data.tokens.refreshToken as string;
  });

  it('200 — valid access token + refresh token revokes session', async () => {
    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ refreshToken });
    expect(res.status).toBe(200);
    expect(res.body.data.message).toContain('Logged out');
  });

  it('200 — idempotent: already-revoked refresh token returns 200', async () => {
    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ refreshToken }); // same token again
    expect(res.status).toBe(200);
  });

  it('401 — missing Authorization header', async () => {
    const res = await request(app).post('/api/v1/auth/logout').send({ refreshToken });
    expect(res.status).toBe(401);
  });
});
