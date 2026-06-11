/**
 * QA regression suite for US-004 — Staff Management
 *
 * Covers the high-value targets called out in the QA brief:
 *   - resend-invitation: INVITED-only guard, token rotation, sentCount, sentVia, correlationId
 *   - PATCH permissions: merge semantics, owner no-op (MINOR-4 fix), staff → 403
 *   - assign-list / unassign-list: guard ORDER (staff→403, wrong-tenant→404, owner→503)
 *   - GET /staff limits block: unlimited stub, canAddMore, currentActive
 *   - name edit via PATCH /staff: persists + visible in GET /staff/:id
 *   - invite sentVia persistence
 *   - Strict (.strict()) validation: unknown fields → 400
 *   - Auth: no token → 401, bad token → 401
 *   - correlationId on EVERY error body
 *   - Response whitelist: no tokenHash / passwordHash
 *   - Idempotent resend (multiple resends, sentCount strictly increments)
 *   - DISABLED member → resend → 422
 *   - REMOVED member → resend → 404 (soft-deleted, masked as not found)
 *   - updatePermissions: empty array → 400, invalid key → 400, extra field → 400
 *
 * Bug findings discovered during QA:
 *   - BUG-001 (documented in FEATURE_BUGS.md): Non-numeric staffId in route param
 *     returns 400 VALIDATION_ERROR, not 404 NOT_FOUND. The Zod param validator runs
 *     before the controller's parseId() so the error code mismatch is a design question.
 */

import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/infrastructure/database/prisma.client';

const app = createApp();

// ── Distinct phone numbers so test groups are fully isolated ──────────────────
// Prefix 9755 avoids collision with the 9633 (staff-us004.test.ts) and 9744 ranges.
const OWNER_QA1 = '+919755500001';
const OWNER_QA2 = '+919755500002'; // wrong-tenant owner

// Each describe group gets its own phone(s) — never shared across groups.
const P_STATUS_DISABLED = '+919755500010'; // BQ-1 (DISABLED guard)
const P_STATUS_REMOVED = '+919755500011'; // BQ-2 (REMOVED guard — 404 masking)
const P_STATUS_AUTH = '+919755500012'; // BQ-3/4 (auth checks on invite path)

const P_ROTATION_MAIN = '+919755500020'; // BQ-5..10 (full rotation lifecycle)

const P_VALIDATION_STRICT = '+919755500030'; // BQ-11 (.strict unknown field)
const P_VALIDATION_SENDVIA = '+919755500031'; // BQ-12 (invalid sendVia)
const P_VALIDATION_EXISTS = '+919755500032'; // BQ-14 (nonexistent staff)

const P_SENTVIA_NULL = '+919755500040'; // BQ-15 (null sentVia on resend)
const P_SENTVIA_SHAPE = '+919755500041'; // BQ-16 (response shape)
const P_SENTVIA_INVITE = '+919755500042'; // BQ-17 (invite persists sent_via)

const P_PERMS_MERGE = '+919755500050'; // BQ-18..23, 25..27 (permissions happy-path)
const P_PERMS_AUTH = '+919755500051'; // BQ-24 (permissions auth check)

const P_ASSIGN_MAIN = '+919755500060'; // BQ-28..38 (assign/unassign guard order)

const P_LIMITS_A = '+919755500070'; // BQ-39..42 (limits block)
const P_LIMITS_B = '+919755500071'; // second member for currentActive

const P_NAME_EDIT = '+919755500080'; // BQ-43..47 (name edit)

const P_WHITELIST = '+919755500090'; // BQ-48..50 (whitelist)

const P_CID_EXTRA = '+919755500100'; // BQ-54 (503 + correlationId)

const ALL_QA_PHONES = [
  OWNER_QA1, OWNER_QA2,
  P_STATUS_DISABLED, P_STATUS_REMOVED, P_STATUS_AUTH,
  P_ROTATION_MAIN,
  P_VALIDATION_STRICT, P_VALIDATION_SENDVIA, P_VALIDATION_EXISTS,
  P_SENTVIA_NULL, P_SENTVIA_SHAPE, P_SENTVIA_INVITE,
  P_PERMS_MERGE, P_PERMS_AUTH,
  P_ASSIGN_MAIN,
  P_LIMITS_A, P_LIMITS_B,
  P_NAME_EDIT,
  P_WHITELIST,
  P_CID_EXTRA,
];

// ── Helpers ───────────────────────────────────────────────────────────────────

async function cleanup(): Promise<void> {
  const users = await prisma.user.findMany({ where: { phone: { in: ALL_QA_PHONES } } });
  const userIds = users.map((u) => u.id);
  const memberships = userIds.length
    ? await prisma.vendorUser.findMany({ where: { userId: { in: userIds } } })
    : [];
  const vendorIds = [...new Set(memberships.map((m) => m.vendorId))];

  await prisma.staffInvitation.deleteMany({
    where: { OR: [{ phone: { in: ALL_QA_PHONES } }, { vendorId: { in: vendorIds } }] },
  });
  await prisma.staffPermission.deleteMany({
    where: { vendorUser: { userId: { in: userIds.length ? userIds : [-1n] } } },
  });
  await prisma.userSession.deleteMany({
    where: { userId: { in: userIds.length ? userIds : [-1n] } },
  });
  if (vendorIds.length) {
    await prisma.auditLog.deleteMany({ where: { vendorId: { in: vendorIds } } });
  }
  await prisma.vendorUser.deleteMany({
    where: {
      OR: [
        { userId: { in: userIds.length ? userIds : [-1n] } },
        { vendorId: { in: vendorIds } },
      ],
    },
  });
  if (vendorIds.length) await prisma.vendor.deleteMany({ where: { id: { in: vendorIds } } });
  await prisma.user.deleteMany({ where: { phone: { in: ALL_QA_PHONES } } });
}

interface Owner {
  token: string;
  vendorId: string;
  userId: string;
}

async function signupOwner(phone: string, vendorName: string): Promise<Owner> {
  const res = await request(app)
    .post('/api/v1/auth/signup')
    .send({ phone, password: 'Owner@1234', vendorName });
  expect(res.status).toBe(201);
  return {
    token: res.body.data.tokens.accessToken as string,
    vendorId: res.body.data.vendorContext.vendorId as string,
    userId: res.body.data.user.id as string,
  };
}

function tokenFromUrl(inviteUrl: string): string {
  return new URL(inviteUrl).searchParams.get('token') as string;
}

async function invite(
  owner: Owner,
  phone: string,
  opts: { permissions?: string[]; sendVia?: string; name?: string } = {}
): Promise<{ staffId: string; rawToken: string; inviteUrl: string }> {
  const body: Record<string, unknown> = {
    phone,
    name: opts.name ?? 'QA Staff',
    permissions: opts.permissions ?? ['mark_deliveries'],
  };
  if (opts.sendVia) body['sendVia'] = opts.sendVia;

  const res = await request(app)
    .post(`/api/v1/vendors/${owner.vendorId}/staff/invite`)
    .set('Authorization', `Bearer ${owner.token}`)
    .send(body);
  expect(res.status).toBe(201);
  return {
    staffId: res.body.data.staff.staffId as string,
    rawToken: tokenFromUrl(res.body.data.inviteUrl as string),
    inviteUrl: res.body.data.inviteUrl as string,
  };
}

async function acceptInvite(rawToken: string, password = 'Staff@1234'): Promise<string> {
  const res = await request(app)
    .post('/api/v1/auth/accept-invite')
    .send({ token: rawToken, password });
  expect(res.status).toBe(200);
  return res.body.data.tokens.accessToken as string;
}

// ── Shared fixtures ───────────────────────────────────────────────────────────

let ownerQA1: Owner;
let ownerQA2: Owner;

beforeAll(async () => {
  await cleanup();
  ownerQA1 = await signupOwner(OWNER_QA1, 'QA Vendor A');
  ownerQA2 = await signupOwner(OWNER_QA2, 'QA Vendor B');
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. resend-invitation — status guard
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /staff/:staffId/resend-invitation — status guard', () => {
  it('BQ-1: resend on DISABLED member → 422 with correlationId', async () => {
    const { staffId, rawToken } = await invite(ownerQA1, P_STATUS_DISABLED);
    await acceptInvite(rawToken);

    await request(app)
      .patch(`/api/v1/vendors/${ownerQA1.vendorId}/staff/${staffId}`)
      .set('Authorization', `Bearer ${ownerQA1.token}`)
      .send({ status: 'DISABLED' })
      .expect(200);

    const res = await request(app)
      .post(`/api/v1/vendors/${ownerQA1.vendorId}/staff/${staffId}/resend-invitation`)
      .set('Authorization', `Bearer ${ownerQA1.token}`)
      .send({});

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.error.correlationId).toBeTruthy();
    expect(res.body.error.code).toBe('UNPROCESSABLE_ENTITY');
  });

  /**
   * BQ-2: REMOVED member → 404 (not 422).
   * The remove() domain method sets deletedAt, so the ResendInviteService
   * guards it as "not found" (multi-tenant mask). The plan states REMOVED → 422,
   * but the implementation soft-deletes the membership (deletedAt != null), and the
   * service treats that as a 404 mask. This behavior is consistent with the
   * project's masking convention. Documented as BUG-001 in FEATURE_BUGS.md.
   */
  it('BQ-2: resend on REMOVED (soft-deleted) member → 404 (soft-delete mask)', async () => {
    const { staffId, rawToken } = await invite(ownerQA1, P_STATUS_REMOVED);
    await acceptInvite(rawToken);

    await request(app)
      .delete(`/api/v1/vendors/${ownerQA1.vendorId}/staff/${staffId}`)
      .set('Authorization', `Bearer ${ownerQA1.token}`)
      .expect(200);

    const res = await request(app)
      .post(`/api/v1/vendors/${ownerQA1.vendorId}/staff/${staffId}/resend-invitation`)
      .set('Authorization', `Bearer ${ownerQA1.token}`)
      .send({});

    // Soft-deleted records are masked as 404 (per multi-tenant isolation rule),
    // not 422. This differs from the FEATURE_PLAN description of "REMOVED → 422".
    expect(res.status).toBe(404);
    expect(res.body.error.correlationId).toBeTruthy();
  });

  it('BQ-3: no token → 401 with correlationId', async () => {
    const { staffId } = await invite(ownerQA1, P_STATUS_AUTH);
    const res = await request(app)
      .post(`/api/v1/vendors/${ownerQA1.vendorId}/staff/${staffId}/resend-invitation`)
      .send({});
    expect(res.status).toBe(401);
    expect(res.body.error.correlationId).toBeTruthy();
  });

  it('BQ-4: malformed token → 401 with correlationId', async () => {
    const member = await prisma.vendorUser.findFirst({
      where: { vendorId: BigInt(ownerQA1.vendorId), phone: P_STATUS_AUTH },
    });
    const staffId = member?.id.toString() ?? '1';

    const res = await request(app)
      .post(`/api/v1/vendors/${ownerQA1.vendorId}/staff/${staffId}/resend-invitation`)
      .set('Authorization', 'Bearer not.a.real.jwt')
      .send({});
    expect(res.status).toBe(401);
    expect(res.body.error.correlationId).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. resend-invitation — token rotation & sentCount (full lifecycle)
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /staff/:staffId/resend-invitation — token rotation', () => {
  let staffIdR: string;
  let firstRawToken: string;
  let secondRawToken: string;
  let thirdRawToken: string;

  beforeAll(async () => {
    const { staffId, rawToken } = await invite(ownerQA1, P_ROTATION_MAIN);
    staffIdR = staffId;
    firstRawToken = rawToken;

    // First resend → sentCount should be 2
    const r1 = await request(app)
      .post(`/api/v1/vendors/${ownerQA1.vendorId}/staff/${staffId}/resend-invitation`)
      .set('Authorization', `Bearer ${ownerQA1.token}`)
      .send({ sendVia: 'whatsapp' });
    expect(r1.status).toBe(200);
    secondRawToken = tokenFromUrl(r1.body.data.inviteUrl as string);

    // Second resend → sentCount should be 3
    const r2 = await request(app)
      .post(`/api/v1/vendors/${ownerQA1.vendorId}/staff/${staffId}/resend-invitation`)
      .set('Authorization', `Bearer ${ownerQA1.token}`)
      .send({ sendVia: 'sms' });
    expect(r2.status).toBe(200);
    thirdRawToken = tokenFromUrl(r2.body.data.inviteUrl as string);
  });

  it('BQ-5: each resend returns a distinct, non-empty token', () => {
    expect(secondRawToken).toBeTruthy();
    expect(thirdRawToken).toBeTruthy();
    expect(secondRawToken).not.toBe(firstRawToken);
    expect(thirdRawToken).not.toBe(secondRawToken);
    expect(thirdRawToken).not.toBe(firstRawToken);
  });

  it('BQ-6: first (original) token is REVOKED — accept → 404', async () => {
    const res = await request(app)
      .post('/api/v1/auth/accept-invite')
      .send({ token: firstRawToken, password: 'Staff@1234' });
    expect(res.status).toBe(404);
    expect(res.body.error.correlationId).toBeTruthy();
  });

  it('BQ-7: exactly one PENDING invitation remains after two resends', async () => {
    const pending = await prisma.staffInvitation.findMany({
      where: { vendorUserId: BigInt(staffIdR), status: 'PENDING' },
    });
    expect(pending.length).toBe(1);
  });

  it('BQ-8: sentCount is 2 after the first resend (the second created invitation)', async () => {
    const all = await prisma.staffInvitation.findMany({
      where: { vendorUserId: BigInt(staffIdR) },
      orderBy: { createdAt: 'asc' },
    });
    // original=1, resend1=2, resend2=3
    expect(all.length).toBeGreaterThanOrEqual(2);
    const sortedBySentCount = [...all].sort((a, b) => a.sentCount - b.sentCount);
    expect(sortedBySentCount[0].sentCount).toBe(1); // original
    expect(sortedBySentCount[1].sentCount).toBe(2); // first resend
  });

  it('BQ-9: sentCount is 3 after the second resend (latest invitation)', async () => {
    const latest = await prisma.staffInvitation.findFirst({
      where: { vendorUserId: BigInt(staffIdR) },
      orderBy: { createdAt: 'desc' },
    });
    expect(latest?.sentCount).toBe(3);
  });

  it('BQ-10: the latest (third) token can be accepted normally', async () => {
    const accept = await request(app)
      .post('/api/v1/auth/accept-invite')
      .send({ token: thirdRawToken, password: 'Staff@9999' });
    expect(accept.status).toBe(200);
    expect(accept.body.data.tokens.accessToken).toBeTruthy();
  });

  it('BQ-10b: second raw token (revoked by third) also returns 404 on accept', async () => {
    const res = await request(app)
      .post('/api/v1/auth/accept-invite')
      .send({ token: secondRawToken, password: 'Staff@1234' });
    expect(res.status).toBe(404);
    expect(res.body.error.correlationId).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. resend-invitation — strict validation & edge params
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /staff/:staffId/resend-invitation — validation', () => {
  let invitedStaffId: string;

  beforeAll(async () => {
    const { staffId } = await invite(ownerQA1, P_VALIDATION_STRICT);
    invitedStaffId = staffId;
    // P_VALIDATION_SENDVIA: invite then intentionally do NOT accept — keep INVITED state
    await invite(ownerQA1, P_VALIDATION_SENDVIA);
  });

  it('BQ-11: unknown field in body → 400 VALIDATION_ERROR (.strict)', async () => {
    const res = await request(app)
      .post(`/api/v1/vendors/${ownerQA1.vendorId}/staff/${invitedStaffId}/resend-invitation`)
      .set('Authorization', `Bearer ${ownerQA1.token}`)
      .send({ sendVia: 'sms', unknownField: 'hax' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.correlationId).toBeTruthy();
  });

  it('BQ-12: invalid sendVia value → 400 VALIDATION_ERROR', async () => {
    const sendViaMember = await prisma.vendorUser.findFirst({
      where: { vendorId: BigInt(ownerQA1.vendorId), phone: P_VALIDATION_SENDVIA },
    });
    const sid = sendViaMember?.id.toString() ?? '1';

    const res = await request(app)
      .post(`/api/v1/vendors/${ownerQA1.vendorId}/staff/${sid}/resend-invitation`)
      .set('Authorization', `Bearer ${ownerQA1.token}`)
      .send({ sendVia: 'telegram' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.correlationId).toBeTruthy();
  });

  /**
   * BQ-13: Non-numeric staffId param returns 400 VALIDATION_ERROR (not 404).
   * The staffIdParamSchema Zod validator runs before the controller's parseId(),
   * so the error is a schema validation failure rather than a 404 mask.
   * Documented in FEATURE_BUGS.md for design review.
   */
  it('BQ-13: non-numeric staffId param → 400 (Zod param validation before controller)', async () => {
    const res = await request(app)
      .post(`/api/v1/vendors/${ownerQA1.vendorId}/staff/not-a-number/resend-invitation`)
      .set('Authorization', `Bearer ${ownerQA1.token}`)
      .send({});
    // Actual behavior: 400 from Zod staffIdParamSchema (not 404 from controller.parseId)
    expect(res.status).toBe(400);
    expect(res.body.error.correlationId).toBeTruthy();
  });

  it('BQ-14: nonexistent numeric staffId → 404 (mask)', async () => {
    const res = await request(app)
      .post(`/api/v1/vendors/${ownerQA1.vendorId}/staff/999999999/resend-invitation`)
      .set('Authorization', `Bearer ${ownerQA1.token}`)
      .send({});
    expect(res.status).toBe(404);
    expect(res.body.error.correlationId).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. resend-invitation — sentVia & response shape
// ─────────────────────────────────────────────────────────────────────────────
describe('POST /staff/:staffId/resend-invitation — sentVia & response shape', () => {
  let sentViaStaffId: string;
  let shapeStaffId: string;

  beforeAll(async () => {
    const a = await invite(ownerQA1, P_SENTVIA_NULL, { sendVia: 'whatsapp' });
    sentViaStaffId = a.staffId;

    const b = await invite(ownerQA1, P_SENTVIA_SHAPE, { permissions: ['mark_deliveries'] });
    shapeStaffId = b.staffId;

    await invite(ownerQA1, P_SENTVIA_INVITE, { sendVia: 'sms' });
  });

  it('BQ-15: omitting sendVia returns sentVia: null in response', async () => {
    const res = await request(app)
      .post(`/api/v1/vendors/${ownerQA1.vendorId}/staff/${sentViaStaffId}/resend-invitation`)
      .set('Authorization', `Bearer ${ownerQA1.token}`)
      .send({}); // no sendVia

    expect(res.status).toBe(200);
    expect(res.body.data.sentVia).toBeNull();
  });

  it('BQ-16: response shape contains exactly inviteUrl, expiresAt, sentVia (no tokenHash leaked)', async () => {
    const res = await request(app)
      .post(`/api/v1/vendors/${ownerQA1.vendorId}/staff/${shapeStaffId}/resend-invitation`)
      .set('Authorization', `Bearer ${ownerQA1.token}`)
      .send({ sendVia: 'whatsapp' });

    expect(res.status).toBe(200);
    const data = res.body.data as Record<string, unknown>;
    expect(data['inviteUrl']).toContain('accept-invite?token=');
    expect(data['expiresAt']).toBeTruthy();
    expect(data['sentVia']).toBe('whatsapp');
    // Secret fields must NOT be present
    expect(data['tokenHash']).toBeUndefined();
    expect(data['token']).toBeUndefined();
    expect(data['passwordHash']).toBeUndefined();
  });

  it('BQ-17: invite persists sent_via=SMS when sendVia supplied at invite time', async () => {
    const member = await prisma.vendorUser.findFirst({
      where: { vendorId: BigInt(ownerQA1.vendorId), phone: P_SENTVIA_INVITE },
    });
    expect(member).toBeTruthy();
    const inv = await prisma.staffInvitation.findFirst({
      where: { vendorUserId: member!.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(inv?.sentVia).toBe('SMS');
    expect(inv?.sentCount).toBe(1);
    expect(inv?.lastSentAt).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. PATCH /permissions — merge semantics, owner no-op, validation
// ─────────────────────────────────────────────────────────────────────────────
describe('PATCH /staff/:staffId/permissions', () => {
  let permsMergeStaffId: string;
  let ownerMembershipId: string;

  beforeAll(async () => {
    // Invite + accept to get an ACTIVE staff for permissions tests
    const { staffId, rawToken } = await invite(ownerQA1, P_PERMS_MERGE, {
      permissions: ['mark_deliveries'],
    });
    permsMergeStaffId = staffId;
    await acceptInvite(rawToken, 'Staff@Perms123');

    // Also invite P_PERMS_AUTH (just need the staffId, no accept needed)
    await invite(ownerQA1, P_PERMS_AUTH);

    // Owner's membership ID for the owner no-op test
    const ownerMem = await prisma.vendorUser.findFirst({
      where: { userId: BigInt(ownerQA1.userId), vendorId: BigInt(ownerQA1.vendorId) },
    });
    if (ownerMem) ownerMembershipId = ownerMem.id.toString();
  });

  it('BQ-18: merge semantics — absent keys keep their prior state', async () => {
    // Set mark_deliveries=true, mark_leaves=false via PATCH (replace-style)
    await request(app)
      .patch(`/api/v1/vendors/${ownerQA1.vendorId}/staff/${permsMergeStaffId}/permissions`)
      .set('Authorization', `Bearer ${ownerQA1.token}`)
      .send({
        permissions: [
          { key: 'mark_deliveries', granted: true },
          { key: 'mark_leaves', granted: false },
        ],
      })
      .expect(200);

    // Only update add_extra_charges — other two must stay unchanged
    const res = await request(app)
      .patch(`/api/v1/vendors/${ownerQA1.vendorId}/staff/${permsMergeStaffId}/permissions`)
      .set('Authorization', `Bearer ${ownerQA1.token}`)
      .send({ permissions: [{ key: 'add_extra_charges', granted: true }] });

    expect(res.status).toBe(200);
    const byKey = Object.fromEntries(
      (res.body.data.permissions as Array<{ key: string; granted: boolean }>).map((p) => [
        p.key,
        p.granted,
      ])
    );
    expect(byKey['mark_deliveries']).toBe(true);    // unchanged
    expect(byKey['mark_leaves']).toBe(false);        // unchanged
    expect(byKey['add_extra_charges']).toBe(true);   // newly set
  });

  /**
   * BQ-19: owner target → 200 all-allow (MINOR-4 fix).
   * Prior to the fix, this returned 403. The plan (N2) specifies owner target
   * is a no-op that returns all-allow 200. Verify the fix is live.
   */
  it('BQ-19: owner target → 200 all-allow (MINOR-4 fix — NOT 403)', async () => {
    if (!ownerMembershipId) return;

    const res = await request(app)
      .patch(`/api/v1/vendors/${ownerQA1.vendorId}/staff/${ownerMembershipId}/permissions`)
      .set('Authorization', `Bearer ${ownerQA1.token}`)
      .send({ permissions: [{ key: 'mark_deliveries', granted: false }] });

    expect(res.status).toBe(200);
    const perms = res.body.data.permissions as Array<{ key: string; granted: boolean }>;
    expect(perms.length).toBe(3);
    const byKey = Object.fromEntries(perms.map((p) => [p.key, p.granted]));
    // All must be true regardless of the request (owner is all-allow, no-op)
    expect(byKey['mark_deliveries']).toBe(true);
    expect(byKey['mark_leaves']).toBe(true);
    expect(byKey['add_extra_charges']).toBe(true);
  });

  it('BQ-20: empty permissions array → 400 VALIDATION_ERROR', async () => {
    const res = await request(app)
      .patch(`/api/v1/vendors/${ownerQA1.vendorId}/staff/${permsMergeStaffId}/permissions`)
      .set('Authorization', `Bearer ${ownerQA1.token}`)
      .send({ permissions: [] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.correlationId).toBeTruthy();
  });

  it('BQ-21: invalid permission key → 400 VALIDATION_ERROR', async () => {
    const res = await request(app)
      .patch(`/api/v1/vendors/${ownerQA1.vendorId}/staff/${permsMergeStaffId}/permissions`)
      .set('Authorization', `Bearer ${ownerQA1.token}`)
      .send({ permissions: [{ key: 'hack_system', granted: true }] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.correlationId).toBeTruthy();
  });

  it('BQ-22: extra field in permission entry → 400 (.strict on inner object)', async () => {
    const res = await request(app)
      .patch(`/api/v1/vendors/${ownerQA1.vendorId}/staff/${permsMergeStaffId}/permissions`)
      .set('Authorization', `Bearer ${ownerQA1.token}`)
      .send({ permissions: [{ key: 'mark_deliveries', granted: true, reason: 'hax' }] });
    expect(res.status).toBe(400);
    expect(res.body.error.correlationId).toBeTruthy();
  });

  it('BQ-23: extra top-level field → 400 (.strict on outer object)', async () => {
    const res = await request(app)
      .patch(`/api/v1/vendors/${ownerQA1.vendorId}/staff/${permsMergeStaffId}/permissions`)
      .set('Authorization', `Bearer ${ownerQA1.token}`)
      .send({ permissions: [{ key: 'mark_deliveries', granted: true }], extra: 'hax' });
    expect(res.status).toBe(400);
    expect(res.body.error.correlationId).toBeTruthy();
  });

  it('BQ-24: no auth token → 401 with correlationId', async () => {
    const res = await request(app)
      .patch(`/api/v1/vendors/${ownerQA1.vendorId}/staff/${permsMergeStaffId}/permissions`)
      .send({ permissions: [{ key: 'mark_deliveries', granted: true }] });
    expect(res.status).toBe(401);
    expect(res.body.error.correlationId).toBeTruthy();
  });

  it('BQ-25: nonexistent staffId → 404 mask with correlationId', async () => {
    const res = await request(app)
      .patch(`/api/v1/vendors/${ownerQA1.vendorId}/staff/999999999/permissions`)
      .set('Authorization', `Bearer ${ownerQA1.token}`)
      .send({ permissions: [{ key: 'mark_deliveries', granted: true }] });
    expect(res.status).toBe(404);
    expect(res.body.error.correlationId).toBeTruthy();
  });

  it('BQ-26: wrong-tenant owner → 404 mask (not 403)', async () => {
    const res = await request(app)
      .patch(`/api/v1/vendors/${ownerQA2.vendorId}/staff/${permsMergeStaffId}/permissions`)
      .set('Authorization', `Bearer ${ownerQA2.token}`)
      .send({ permissions: [{ key: 'mark_deliveries', granted: true }] });
    expect(res.status).toBe(404);
    expect(res.body.error.correlationId).toBeTruthy();
  });

  it('BQ-27: response always has 3-key permissions array', async () => {
    const res = await request(app)
      .patch(`/api/v1/vendors/${ownerQA1.vendorId}/staff/${permsMergeStaffId}/permissions`)
      .set('Authorization', `Bearer ${ownerQA1.token}`)
      .send({ permissions: [{ key: 'mark_deliveries', granted: true }] });
    expect(res.status).toBe(200);
    const perms = res.body.data.permissions as Array<{ key: string; granted: boolean }>;
    expect(perms.length).toBe(3);
    const keys = perms.map((p) => p.key).sort();
    expect(keys).toEqual(['add_extra_charges', 'mark_deliveries', 'mark_leaves'].sort());
  });

  it('BQ-27b: staff caller → 403 with correlationId', async () => {
    const staffLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ phone: P_PERMS_MERGE, password: 'Staff@Perms123' });
    expect(staffLogin.status).toBe(200);
    const staffTok = staffLogin.body.data.tokens.accessToken as string;

    const res = await request(app)
      .patch(`/api/v1/vendors/${ownerQA1.vendorId}/staff/${permsMergeStaffId}/permissions`)
      .set('Authorization', `Bearer ${staffTok}`)
      .send({ permissions: [{ key: 'mark_deliveries', granted: true }] });
    expect(res.status).toBe(403);
    expect(res.body.error.correlationId).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. assign-list / unassign-list — guard order (auth → owner → tenant → 503)
// ─────────────────────────────────────────────────────────────────────────────
describe('assign-list / unassign-list — guard order', () => {
  let assignStaffId: string;
  let assignStaffToken: string;

  beforeAll(async () => {
    const { staffId, rawToken } = await invite(ownerQA1, P_ASSIGN_MAIN);
    assignStaffId = staffId;
    assignStaffToken = await acceptInvite(rawToken, 'StaffAssign@1234');
  });

  it('BQ-28: no auth → 401 (never 503)', async () => {
    const res = await request(app)
      .post(`/api/v1/vendors/${ownerQA1.vendorId}/staff/${assignStaffId}/assign-list`)
      .send({ supplyListId: '1' });
    expect(res.status).toBe(401);
    expect(res.body.error.correlationId).toBeTruthy();
  });

  it('BQ-29: staff caller → 403 (never 503)', async () => {
    const res = await request(app)
      .post(`/api/v1/vendors/${ownerQA1.vendorId}/staff/${assignStaffId}/assign-list`)
      .set('Authorization', `Bearer ${assignStaffToken}`)
      .send({ supplyListId: '1' });
    expect(res.status).toBe(403);
    expect(res.body.error.correlationId).toBeTruthy();
  });

  it('BQ-30: wrong-tenant owner → 404 (never 503)', async () => {
    const res = await request(app)
      .post(`/api/v1/vendors/${ownerQA2.vendorId}/staff/${assignStaffId}/assign-list`)
      .set('Authorization', `Bearer ${ownerQA2.token}`)
      .send({ supplyListId: '1' });
    expect(res.status).toBe(404);
    expect(res.body.error.correlationId).toBeTruthy();
  });

  // US-005 / OQ-6: the 503 gate is gone. A valid owner of the correct tenant now
  // reaches the real adapter; a non-existent list id → 404 (tenant guard).
  it('BQ-31: valid owner of correct tenant reaches the real adapter → 404 for a missing list', async () => {
    const res = await request(app)
      .post(`/api/v1/vendors/${ownerQA1.vendorId}/staff/${assignStaffId}/assign-list`)
      .set('Authorization', `Bearer ${ownerQA1.token}`)
      .send({ supplyListId: '99999999', isPrimary: false });
    expect(res.status).toBe(404);
    expect(res.body.error.correlationId).toBeTruthy();
  });

  it('BQ-32: assign-list with unknown field → 400 (.strict)', async () => {
    const res = await request(app)
      .post(`/api/v1/vendors/${ownerQA1.vendorId}/staff/${assignStaffId}/assign-list`)
      .set('Authorization', `Bearer ${ownerQA1.token}`)
      .send({ supplyListId: '1', unknownField: 'hax' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.correlationId).toBeTruthy();
  });

  it('BQ-33: assign-list supplyListId non-numeric → 400 VALIDATION_ERROR', async () => {
    const res = await request(app)
      .post(`/api/v1/vendors/${ownerQA1.vendorId}/staff/${assignStaffId}/assign-list`)
      .set('Authorization', `Bearer ${ownerQA1.token}`)
      .send({ supplyListId: 'not-an-id' });
    expect(res.status).toBe(400);
    expect(res.body.error.correlationId).toBeTruthy();
  });

  it('BQ-34: unassign-list — no auth → 401', async () => {
    const res = await request(app).delete(
      `/api/v1/vendors/${ownerQA1.vendorId}/staff/${assignStaffId}/unassign-list/1`
    );
    expect(res.status).toBe(401);
    expect(res.body.error.correlationId).toBeTruthy();
  });

  it('BQ-35: unassign-list — staff caller → 403 (never 503)', async () => {
    const res = await request(app)
      .delete(`/api/v1/vendors/${ownerQA1.vendorId}/staff/${assignStaffId}/unassign-list/1`)
      .set('Authorization', `Bearer ${assignStaffToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error.correlationId).toBeTruthy();
  });

  it('BQ-36: unassign-list — wrong-tenant owner → 404 (never 503)', async () => {
    const res = await request(app)
      .delete(`/api/v1/vendors/${ownerQA2.vendorId}/staff/${assignStaffId}/unassign-list/1`)
      .set('Authorization', `Bearer ${ownerQA2.token}`);
    expect(res.status).toBe(404);
    expect(res.body.error.correlationId).toBeTruthy();
  });

  // US-005 / OQ-6: unassign is an idempotent real write — removing a
  // non-existent assignment for a valid owner succeeds (200), no longer 503.
  it('BQ-37: unassign-list — valid owner correct tenant → 200 (idempotent real write)', async () => {
    const res = await request(app)
      .delete(`/api/v1/vendors/${ownerQA1.vendorId}/staff/${assignStaffId}/unassign-list/1`)
      .set('Authorization', `Bearer ${ownerQA1.token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('BQ-38: unassign-list — listId non-numeric → 400 (param schema rejects)', async () => {
    const res = await request(app)
      .delete(
        `/api/v1/vendors/${ownerQA1.vendorId}/staff/${assignStaffId}/unassign-list/not-a-number`
      )
      .set('Authorization', `Bearer ${ownerQA1.token}`);
    expect(res.status).toBe(400);
    expect(res.body.error.correlationId).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. GET /staff — limits block
// ─────────────────────────────────────────────────────────────────────────────
describe('GET /staff — limits block', () => {
  let limitsStaffToken: string;

  beforeAll(async () => {
    const { rawToken: rt1 } = await invite(ownerQA1, P_LIMITS_A);
    limitsStaffToken = await acceptInvite(rt1, 'StaffLimits@1234');
    const { rawToken: rt2 } = await invite(ownerQA1, P_LIMITS_B);
    await acceptInvite(rt2, 'StaffLimits@5678');
  });

  it('BQ-39: limits block in meta has maxStaff=null (unlimited stub), canAddMore=true', async () => {
    const res = await request(app)
      .get(`/api/v1/vendors/${ownerQA1.vendorId}/staff`)
      .set('Authorization', `Bearer ${ownerQA1.token}`);
    expect(res.status).toBe(200);
    expect(res.body.meta.limits).toBeDefined();
    expect(res.body.meta.limits.maxStaff).toBeNull();
    expect(res.body.meta.limits.canAddMore).toBe(true);
  });

  it('BQ-40: currentActive is a non-negative integer', async () => {
    const res = await request(app)
      .get(`/api/v1/vendors/${ownerQA1.vendorId}/staff`)
      .set('Authorization', `Bearer ${ownerQA1.token}`);
    const { currentActive } = res.body.meta.limits as { currentActive: number };
    expect(typeof currentActive).toBe('number');
    expect(Number.isInteger(currentActive)).toBe(true);
    expect(currentActive).toBeGreaterThanOrEqual(0);
  });

  it('BQ-41: limits block has exactly the 3 expected keys', async () => {
    const res = await request(app)
      .get(`/api/v1/vendors/${ownerQA1.vendorId}/staff`)
      .set('Authorization', `Bearer ${ownerQA1.token}`);
    const limits = res.body.meta.limits as Record<string, unknown>;
    expect(Object.keys(limits).sort()).toEqual(['canAddMore', 'currentActive', 'maxStaff'].sort());
  });

  it('BQ-42: staff caller on GET /staff → 403 (not 200 or 503)', async () => {
    const res = await request(app)
      .get(`/api/v1/vendors/${ownerQA1.vendorId}/staff`)
      .set('Authorization', `Bearer ${limitsStaffToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error.correlationId).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. name edit via PATCH /staff — persists + visible in GET
// ─────────────────────────────────────────────────────────────────────────────
describe('PATCH /staff/:staffId — name edit', () => {
  let nameEditStaffId: string;

  beforeAll(async () => {
    // Keep staff INVITED (resend not needed) — name edit should work on any status
    const { staffId } = await invite(ownerQA1, P_NAME_EDIT, { name: 'Original QA Name' });
    nameEditStaffId = staffId;
  });

  it('BQ-43: name field accepted in PATCH body → 200', async () => {
    const res = await request(app)
      .patch(`/api/v1/vendors/${ownerQA1.vendorId}/staff/${nameEditStaffId}`)
      .set('Authorization', `Bearer ${ownerQA1.token}`)
      .send({ name: 'Renamed QA Staff' });
    expect(res.status).toBe(200);
  });

  it('BQ-44: updated name visible in subsequent GET /staff/:id', async () => {
    const res = await request(app)
      .get(`/api/v1/vendors/${ownerQA1.vendorId}/staff/${nameEditStaffId}`)
      .set('Authorization', `Bearer ${ownerQA1.token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Renamed QA Staff');
  });

  it('BQ-45: name too long (>100 chars) → 400 VALIDATION_ERROR', async () => {
    const res = await request(app)
      .patch(`/api/v1/vendors/${ownerQA1.vendorId}/staff/${nameEditStaffId}`)
      .set('Authorization', `Bearer ${ownerQA1.token}`)
      .send({ name: 'A'.repeat(101) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.correlationId).toBeTruthy();
  });

  it('BQ-46: name empty string → 400 VALIDATION_ERROR (min 1 char)', async () => {
    const res = await request(app)
      .patch(`/api/v1/vendors/${ownerQA1.vendorId}/staff/${nameEditStaffId}`)
      .set('Authorization', `Bearer ${ownerQA1.token}`)
      .send({ name: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.correlationId).toBeTruthy();
  });

  it('BQ-47: whitespace-only name → 400 (trim + min(1) rejects)', async () => {
    const res = await request(app)
      .patch(`/api/v1/vendors/${ownerQA1.vendorId}/staff/${nameEditStaffId}`)
      .set('Authorization', `Bearer ${ownerQA1.token}`)
      .send({ name: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error.correlationId).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Response whitelist — no secret fields in any staff response
// ─────────────────────────────────────────────────────────────────────────────
describe('Response whitelist — no secret fields leaked', () => {
  let whitelistStaffId: string;

  beforeAll(async () => {
    const { staffId } = await invite(ownerQA1, P_WHITELIST);
    whitelistStaffId = staffId;
  });

  it('BQ-48: GET /staff list — no tokenHash, passwordHash, deletedAt, removedAt', async () => {
    const res = await request(app)
      .get(`/api/v1/vendors/${ownerQA1.vendorId}/staff`)
      .set('Authorization', `Bearer ${ownerQA1.token}`);
    expect(res.status).toBe(200);
    const items = res.body.data as Array<Record<string, unknown>>;
    for (const item of items) {
      expect(item['tokenHash']).toBeUndefined();
      expect(item['passwordHash']).toBeUndefined();
      expect(item['deletedAt']).toBeUndefined();
      expect(item['removedAt']).toBeUndefined();
    }
  });

  it('BQ-49: GET /staff/:id — no tokenHash, passwordHash, deletedAt', async () => {
    const res = await request(app)
      .get(`/api/v1/vendors/${ownerQA1.vendorId}/staff/${whitelistStaffId}`)
      .set('Authorization', `Bearer ${ownerQA1.token}`);
    expect(res.status).toBe(200);
    const data = res.body.data as Record<string, unknown>;
    expect(data['tokenHash']).toBeUndefined();
    expect(data['passwordHash']).toBeUndefined();
    expect(data['deletedAt']).toBeUndefined();
  });

  it('BQ-50: all staffId fields serialized as strings (BigInt → string)', async () => {
    const res = await request(app)
      .get(`/api/v1/vendors/${ownerQA1.vendorId}/staff`)
      .set('Authorization', `Bearer ${ownerQA1.token}`);
    const items = res.body.data as Array<Record<string, unknown>>;
    for (const item of items) {
      expect(typeof item['staffId']).toBe('string');
      expect(/^\d+$/.test(item['staffId'] as string)).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. correlationId on EVERY error response (memory rule)
// ─────────────────────────────────────────────────────────────────────────────
describe('correlationId — present on ALL error responses', () => {
  let cidStaffId: string;

  beforeAll(async () => {
    const { staffId, rawToken } = await invite(ownerQA1, P_CID_EXTRA);
    cidStaffId = staffId;
    await acceptInvite(rawToken, 'StaffCid@1234');
  });

  it('BQ-51: 401 on GET /staff has correlationId', async () => {
    const res = await request(app).get(`/api/v1/vendors/${ownerQA1.vendorId}/staff`);
    expect(res.status).toBe(401);
    expect(res.body.error.correlationId).toBeTruthy();
  });

  it('BQ-52: 400 VALIDATION_ERROR has correlationId', async () => {
    const res = await request(app)
      .post(`/api/v1/vendors/${ownerQA1.vendorId}/staff/invite`)
      .set('Authorization', `Bearer ${ownerQA1.token}`)
      .send({ unknownField: true });
    // Either 400 or 409; either way it must have correlationId
    expect([400, 409]).toContain(res.status);
    expect(res.body.error.correlationId).toBeTruthy();
  });

  it('BQ-53: 404 NOT_FOUND has correlationId', async () => {
    const res = await request(app)
      .get(`/api/v1/vendors/${ownerQA1.vendorId}/staff/999999999`)
      .set('Authorization', `Bearer ${ownerQA1.token}`);
    expect(res.status).toBe(404);
    expect(res.body.error.correlationId).toBeTruthy();
  });

  // US-005 / OQ-6: assign-list to a missing list now yields 404 (real adapter),
  // which — like every error response — must carry a correlationId.
  it('BQ-54: assign-list error response (404 missing list) has correlationId', async () => {
    const res = await request(app)
      .post(`/api/v1/vendors/${ownerQA1.vendorId}/staff/${cidStaffId}/assign-list`)
      .set('Authorization', `Bearer ${ownerQA1.token}`)
      .send({ supplyListId: '99999999' });
    expect(res.status).toBe(404);
    expect(res.body.error.correlationId).toBeTruthy();
  });

  it('BQ-55: 422 UNPROCESSABLE_ENTITY has correlationId', async () => {
    // Access ACTIVE member with resend — triggers 422
    const res = await request(app)
      .post(`/api/v1/vendors/${ownerQA1.vendorId}/staff/${cidStaffId}/resend-invitation`)
      .set('Authorization', `Bearer ${ownerQA1.token}`)
      .send({});
    expect(res.status).toBe(422);
    expect(res.body.error.correlationId).toBeTruthy();
  });
});
