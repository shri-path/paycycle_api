/**
 * Enhanced demo seed — comprehensive 6-month business scenario.
 *
 * Vendor 1 — Krishna Dairy Farm : 15 customers, 3 active staff, 4 supply lists
 * Vendor 2 — Sunrise Grocery Hub: 12 customers, 2 active staff, 3 supply lists
 *
 * Scenarios:
 *  - Staff route separation (each staff owns specific supply lists)
 *  - 6 months delivery data (Jan–Jun 2026) with leaves, auto-mark, pending
 *  - Customer leave periods: vacation, festival, business travel
 *  - CONFLICT: Bharati Krishnan has leave Mar 20–25 but Mar 22 delivery marked DELIVERED
 *  - Subscription lifecycle: start mid-period, churn (Vikram Singh ends Apr 1)
 *  - Payment history: regular payers, late payers, 2–3 months outstanding
 *  - Extra charges: special orders, discount adjustments
 *
 * Run: npm run db:seed:demo   (safe to re-run — idempotent)
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

// ── tiny helpers ──────────────────────────────────────────────────────────────
const d = (s: string) => new Date(s + 'T00:00:00.000Z');
const addDays = (dt: Date, n: number) => { const r = new Date(dt); r.setUTCDate(r.getUTCDate() + n); return r; };
const ymd = (dt: Date) => dt.toISOString().slice(0, 10);
const dow = (dt: Date) => { const w = dt.getUTCDay(); return w === 0 ? 7 : w; }; // 1=Mon…7=Sun

// ── types ─────────────────────────────────────────────────────────────────────
interface LeaveBlock { start: string; end: string; reason: string; conflict?: boolean; }
interface CustomerRow { id: bigint; phone: string; startDate: string; }
interface SubRow {
  id: bigint; customerId: bigint; customerPhone: string; supplyListId: bigint;
  startDate: string; endDate?: string;
  qty: string; rate: string; unit: string; frequency: string; daysOfWeek: number[];
}

// ── leave config ──────────────────────────────────────────────────────────────
const V1_LEAVES: Record<string, LeaveBlock[]> = {
  '+919000100001': [                                          // Ramesh Iyer
    { start: '2026-01-26', end: '2026-01-27', reason: 'Republic Day travel' },
    { start: '2026-03-25', end: '2026-03-30', reason: 'Ugadi festival' },
  ],
  '+919000100002': [                                          // Sunita Sharma
    { start: '2026-03-08', end: '2026-03-15', reason: 'Personal leave' },
    { start: '2026-06-01', end: '2026-06-05', reason: 'Festival week' },
  ],
  '+919000100003': [                                          // Arjun Mehta
    { start: '2026-01-13', end: '2026-01-16', reason: 'Makar Sankranti' },
    { start: '2026-05-05', end: '2026-05-25', reason: 'Summer vacation' },
  ],
  '+919000100004': [                                          // Priya Nair
    { start: '2026-04-10', end: '2026-04-12', reason: 'Family event' },
    { start: '2026-05-20', end: '2026-05-22', reason: 'Wedding function' },
  ],
  '+919000100005': [                                          // Vikram Singh (ends Apr 1)
    { start: '2026-02-20', end: '2026-02-28', reason: 'Business trip' },
  ],
  '+919000100009': [                                          // Kavya Reddy
    { start: '2026-04-14', end: '2026-04-19', reason: 'Easter vacation' },
  ],
  '+919000100012': [                                          // Bharati Krishnan — CONFLICT
    { start: '2026-03-20', end: '2026-03-25', reason: 'Out of town', conflict: true },
  ],
  '+919000100008': [                                          // Deepa Menon
    { start: '2026-02-14', end: '2026-02-16', reason: 'Family visit' },
    { start: '2026-04-28', end: '2026-05-03', reason: 'Travel' },
  ],
};

const V2_LEAVES: Record<string, LeaveBlock[]> = {
  '+919111100002': [                                          // Deepak Nair
    { start: '2026-02-10', end: '2026-02-15', reason: 'Out of town' },
    { start: '2026-05-01', end: '2026-05-05', reason: 'Labour Day' },
  ],
  '+919111100004': [                                          // Harish Shetty
    { start: '2026-03-15', end: '2026-03-20', reason: 'Medical leave' },
    { start: '2026-05-25', end: '2026-06-02', reason: 'Summer break' },
  ],
  '+919111100009': [                                          // Kavitha Rao
    { start: '2026-04-01', end: '2026-04-10', reason: 'Ugadi holiday' },
  ],
  '+919111100012': [                                          // Vinod Hegde (joined Apr)
    { start: '2026-05-18', end: '2026-05-20', reason: 'Short break' },
  ],
};

// ── helper: check leave ───────────────────────────────────────────────────────
function checkLeave(phone: string, dt: Date, leaveMap: Record<string, LeaveBlock[]>): boolean {
  const dateStr = ymd(dt);
  for (const block of leaveMap[phone] ?? []) {
    if (dt < d(block.start) || dt > d(block.end)) continue;
    // Conflict scenario: treat Mar 22 as delivered even though leave spans it
    if (block.conflict && dateStr === '2026-03-22') return false;
    return true;
  }
  return false;
}

// ── helper: staff grant ───────────────────────────────────────────────────────
async function grantAllStaff(vendorUserId: bigint) {
  for (const key of ['mark_deliveries', 'mark_leaves', 'add_extra_charges'] as const) {
    await prisma.staffPermission.upsert({
      where: { vendorUserId_permissionKey: { vendorUserId, permissionKey: key } },
      update: { granted: true },
      create: { vendorUserId, permissionKey: key, granted: true },
    });
  }
}

// ── helper: ensure supply list + staff assignment ─────────────────────────────
async function ensureList(
  vendorId: bigint,
  name: string,
  data: { supplyType: string; unit: string; defaultQuantity: string; ratePerUnit: string; startTime: string; frequency: 'DAILY' | 'WEEKLY'; daysOfWeek?: number[]; },
  primaryMemberId: bigint,
) {
  let list = await prisma.supplyList.findFirst({ where: { vendorId, name, deletedAt: null } });
  if (!list) {
    list = await prisma.supplyList.create({
      data: {
        vendorId, name,
        supplyType: data.supplyType, unit: data.unit,
        defaultQuantity: data.defaultQuantity, ratePerUnit: data.ratePerUnit,
        startTime: data.startTime, frequency: data.frequency, isActive: true,
        ...(data.daysOfWeek ? { schedule: { create: data.daysOfWeek.map((d) => ({ dayOfWeek: d })) } } : {}),
      },
    });
  }
  // Demote any other primary before setting the new one.
  await prisma.supplyListStaff.updateMany({
    where: { supplyListId: list.id, isPrimary: true, vendorUserId: { not: primaryMemberId } },
    data: { isPrimary: false },
  });
  await prisma.supplyListStaff.upsert({
    where: { supplyListId_vendorUserId: { supplyListId: list.id, vendorUserId: primaryMemberId } },
    update: { isPrimary: true },
    create: { supplyListId: list.id, vendorUserId: primaryMemberId, isPrimary: true },
  });
  // Fetch schedule for weekly lists
  const schedule = await prisma.supplyListSchedule.findMany({ where: { supplyListId: list.id } });
  return {
    id: list.id,
    unit: list.unit,
    rate: list.ratePerUnit?.toString() ?? data.ratePerUnit,
    frequency: list.frequency,
    daysOfWeek: schedule.map((s) => s.dayOfWeek ?? 0),
  };
}

// ── helper: ensure subscription ───────────────────────────────────────────────
async function ensureSub(
  vendorId: bigint,
  listId: bigint,
  customerId: bigint,
  customerPhone: string,
  qty: string,
  rate: string,
  startDate: string,
  endDate?: string,
): Promise<bigint | null> {
  const existing = await prisma.supplyListCustomer.findFirst({
    where: { supplyListId: listId, customerId, deletedAt: null },
  });
  if (existing) return existing.id;
  const sub = await prisma.supplyListCustomer.create({
    data: {
      vendorId, supplyListId: listId, customerId,
      customQuantity: qty, customRatePerUnit: rate,
      startDate: d(startDate), endDate: endDate ? d(endDate) : null,
      isActive: !endDate,
    },
  });
  return sub.id;
}

// ── V1 SETUP ──────────────────────────────────────────────────────────────────

async function setupV1(testHash: string, ownerRoleId: bigint, staffRoleId: bigint) {
  // Owner
  const owner = await prisma.user.update({ where: { phone: '+919000000001' }, data: { name: 'Rajesh Kumar' } });
  const ownerMem = await prisma.vendorUser.findFirstOrThrow({ where: { userId: owner.id, roleId: ownerRoleId } });
  const v1Id = ownerMem.vendorId;
  await prisma.vendor.update({ where: { id: v1Id }, data: { name: 'Krishna Dairy Farm', phone: '+919000000001', category: 'dairy' } });

  // Staff names
  await prisma.user.update({ where: { phone: '+919000000010' }, data: { name: 'Amit Verma' } });
  await prisma.user.update({ where: { phone: '+919000000011' }, data: { name: 'Ravi Sharma' } });
  await prisma.user.update({ where: { phone: '+919000000012' }, data: { name: 'Meena Pillai' } }); // still invited

  // Activate Ravi
  await prisma.vendorUser.updateMany({
    where: { vendorId: v1Id, phone: '+919000000011' },
    data: { status: 'ACTIVE', joinedAt: d('2026-01-01'), disabledAt: null },
  });

  // New staff: Priya Devi
  const priyaDUser = await prisma.user.upsert({
    where: { phone: '+919000000013' },
    update: { name: 'Priya Devi' },
    create: { phone: '+919000000013', passwordHash: testHash, name: 'Priya Devi', preferredLanguage: 'en' },
  });
  let priyaDMem = await prisma.vendorUser.findUnique({ where: { vendorId_userId: { vendorId: v1Id, userId: priyaDUser.id } } });
  if (!priyaDMem) {
    priyaDMem = await prisma.vendorUser.create({
      data: {
        vendorId: v1Id, userId: priyaDUser.id, roleId: staffRoleId,
        status: 'ACTIVE', phone: '+919000000013',
        areaRouteLabel: 'Whitefield & BTM Route',
        invitedAt: d('2025-12-20'), joinedAt: d('2026-01-01'),
      },
    });
  }

  const amitMem = await prisma.vendorUser.findFirstOrThrow({ where: { vendorId: v1Id, phone: '+919000000010' } });
  const raviMem = await prisma.vendorUser.findFirstOrThrow({ where: { vendorId: v1Id, phone: '+919000000011' } });
  for (const m of [amitMem, raviMem, priyaDMem]) await grantAllStaff(m.id);

  // Customers (15)
  const customerSeeds = [
    { phone: '+919000100001', name: 'Ramesh Iyer',        locality: 'Koramangala', address: '12, 5th Block, Koramangala',      start: '2026-01-01' },
    { phone: '+919000100002', name: 'Sunita Sharma',      locality: 'Indiranagar', address: '404, 12th Main, Indiranagar',      start: '2026-01-01' },
    { phone: '+919000100003', name: 'Arjun Mehta',        locality: 'HSR Layout',  address: '7, Sector 2, HSR Layout',          start: '2026-01-01' },
    { phone: '+919000100004', name: 'Priya Nair',         locality: 'Jayanagar',   address: '88, 4th Block, Jayanagar',         start: '2026-01-01' },
    { phone: '+919000100005', name: 'Vikram Singh',       locality: 'Whitefield',  address: '21, Palm Meadows, Whitefield',     start: '2026-01-01' },
    { phone: '+919000100006', name: 'Lakshmi Rao',        locality: 'BTM Layout',  address: '15, 2nd Stage, BTM Layout',        start: '2026-01-01' },
    { phone: '+919000100007', name: 'Imran Khan',         locality: 'Koramangala', address: '34, 6th Block, Koramangala',       start: '2026-01-01' },
    { phone: '+919000100008', name: 'Deepa Menon',        locality: 'Indiranagar', address: '9, 100ft Road, Indiranagar',       start: '2026-01-01' },
    { phone: '+919000100009', name: 'Kavya Reddy',        locality: 'Whitefield',  address: '3, Prestige Tech Park, Whitefield',start: '2026-02-01' },
    { phone: '+919000100010', name: 'Sumanth Gowda',      locality: 'Whitefield',  address: '18, EPIP Zone, Whitefield',        start: '2026-02-01' },
    { phone: '+919000100011', name: 'Nandita Joshi',      locality: 'Koramangala', address: '22, 7th Block, Koramangala',       start: '2026-01-01' },
    { phone: '+919000100012', name: 'Bharati Krishnan',   locality: 'Indiranagar', address: '57, CMH Road, Indiranagar',        start: '2026-02-01' },
    { phone: '+919000100013', name: 'Venkatesh Murthy',   locality: 'HSR Layout',  address: '9, 27th Main, HSR Layout',         start: '2026-01-01' },
    { phone: '+919000100014', name: 'Padma Subramaniam',  locality: 'Jayanagar',   address: '14, 9th Block, Jayanagar',         start: '2026-01-01' },
    { phone: '+919000100015', name: 'Gopal Singh',        locality: 'BTM Layout',  address: '8, Arekere, BTM Layout',           start: '2026-03-01' },
  ];
  const customers: CustomerRow[] = [];
  for (const c of customerSeeds) {
    const cust = await prisma.customer.upsert({
      where: { phone: c.phone },
      update: { name: c.name, locality: c.locality, address: c.address },
      create: { phone: c.phone, name: c.name, locality: c.locality, address: c.address, autoMarkEnabled: true, customerSince: d(c.start) },
    });
    await prisma.vendorCustomer.upsert({
      where: { vendorId_customerId: { vendorId: v1Id, customerId: cust.id } },
      update: {},
      create: { vendorId: v1Id, customerId: cust.id, status: 'ACTIVE', acquisitionSource: 'MANUAL_ADD' },
    });
    customers.push({ id: cust.id, phone: c.phone, startDate: c.start });
  }

  const byPhone = Object.fromEntries(customers.map((c) => [c.phone, c]));

  // Supply lists: Morning Milk → Amit | Evening Milk → Ravi | Bread & Curd → Priya
  const morningMilk = await ensureList(v1Id, 'Morning Milk', { supplyType: 'Milk', unit: 'ltr', defaultQuantity: '1.000', ratePerUnit: '60.00', startTime: '06:30', frequency: 'DAILY' }, amitMem.id);
  const eveningMilk = await ensureList(v1Id, 'Evening Milk', { supplyType: 'Milk', unit: 'ltr', defaultQuantity: '0.500', ratePerUnit: '62.00', startTime: '18:00', frequency: 'DAILY' }, raviMem.id);
  const bread       = await ensureList(v1Id, 'Morning Bread', { supplyType: 'Bread', unit: 'pieces', defaultQuantity: '1.000', ratePerUnit: '45.00', startTime: '07:00', frequency: 'WEEKLY', daysOfWeek: [1, 3, 5] }, priyaDMem.id);
  const curd        = await ensureList(v1Id, 'Premium Curd', { supplyType: 'Curd', unit: 'packets', defaultQuantity: '1.000', ratePerUnit: '35.00', startTime: '07:00', frequency: 'DAILY' }, priyaDMem.id);

  // Subscriptions — route-aware mapping
  type SubPlan = { phone: string; qty: string; rate: string; end?: string; };
  const milkMorningSubs: SubPlan[] = [
    { phone: '+919000100001', qty: '1.000', rate: '60.00' },  // Ramesh
    { phone: '+919000100002', qty: '0.500', rate: '60.00' },  // Sunita
    { phone: '+919000100006', qty: '1.000', rate: '58.00' },  // Lakshmi (custom rate)
    { phone: '+919000100007', qty: '1.000', rate: '60.00' },  // Imran
    { phone: '+919000100008', qty: '0.500', rate: '60.00' },  // Deepa
    { phone: '+919000100011', qty: '1.000', rate: '60.00' },  // Nandita
    { phone: '+919000100012', qty: '0.500', rate: '60.00' },  // Bharati (joins Feb)
    { phone: '+919000100015', qty: '1.000', rate: '60.00' },  // Gopal (joins Mar)
  ];
  const milkEveSubs: SubPlan[] = [
    { phone: '+919000100002', qty: '0.500', rate: '62.00' },  // Sunita (gets both!)
    { phone: '+919000100003', qty: '1.000', rate: '62.00' },  // Arjun
    { phone: '+919000100004', qty: '0.500', rate: '62.00' },  // Priya
    { phone: '+919000100008', qty: '0.500', rate: '62.00' },  // Deepa (gets both!)
    { phone: '+919000100013', qty: '1.000', rate: '62.00' },  // Venkatesh
    { phone: '+919000100014', qty: '0.500', rate: '60.00' },  // Padma (custom rate)
  ];
  const breadSubs: SubPlan[] = [
    { phone: '+919000100001', qty: '1.000', rate: '45.00' },  // Ramesh
    { phone: '+919000100004', qty: '2.000', rate: '45.00' },  // Priya
    { phone: '+919000100005', qty: '1.000', rate: '45.00', end: '2026-03-31' },  // Vikram (churns)
    { phone: '+919000100009', qty: '1.000', rate: '45.00' },  // Kavya (joins Feb)
    { phone: '+919000100010', qty: '2.000', rate: '43.00' },  // Sumanth (custom rate, joins Feb)
  ];
  const curdSubs: SubPlan[] = [
    { phone: '+919000100005', qty: '1.000', rate: '35.00', end: '2026-03-31' },  // Vikram (churns)
    { phone: '+919000100006', qty: '1.000', rate: '35.00' },  // Lakshmi
    { phone: '+919000100009', qty: '1.000', rate: '35.00' },  // Kavya (joins Feb)
    { phone: '+919000100014', qty: '1.000', rate: '35.00' },  // Padma
    { phone: '+919000100015', qty: '2.000', rate: '33.00' },  // Gopal (custom rate, joins Mar)
  ];

  const subs: SubRow[] = [];
  for (const [plans, list] of [
    [milkMorningSubs, morningMilk], [milkEveSubs, eveningMilk],
    [breadSubs, bread], [curdSubs, curd],
  ] as [SubPlan[], typeof morningMilk][]) {
    for (const p of plans) {
      const customer = byPhone[p.phone];
      if (!customer) continue;
      const subId = await ensureSub(v1Id, list.id, customer.id, p.phone, p.qty, p.rate, customer.startDate, p.end);
      if (subId) {
        subs.push({
          id: subId, customerId: customer.id, customerPhone: p.phone,
          supplyListId: list.id, startDate: customer.startDate, endDate: p.end,
          qty: p.qty, rate: p.rate, unit: list.unit,
          frequency: list.frequency, daysOfWeek: list.daysOfWeek,
        });
      }
    }
  }

  return { v1Id, owner, customers, subs };
}

// ── V2 SETUP ──────────────────────────────────────────────────────────────────

async function setupV2(demoHash: string, ownerRoleId: bigint, staffRoleId: bigint) {
  const ownerUser = await prisma.user.upsert({
    where: { phone: '+919111000001' },
    update: { name: 'Kiran Patil' },
    create: { phone: '+919111000001', passwordHash: demoHash, name: 'Kiran Patil', preferredLanguage: 'en' },
  });

  let v2Id: bigint;
  const existingMem = await prisma.vendorUser.findFirst({ where: { userId: ownerUser.id, roleId: ownerRoleId } });
  if (!existingMem) {
    const v2 = await prisma.vendor.create({ data: { name: 'Sunrise Grocery Hub', phone: '+919111000001', category: 'grocery' } });
    v2Id = v2.id;
    await prisma.vendorUser.create({ data: { vendorId: v2Id, userId: ownerUser.id, roleId: ownerRoleId, status: 'ACTIVE', joinedAt: d('2026-01-01') } });
  } else {
    v2Id = existingMem.vendorId;
    await prisma.vendor.update({ where: { id: v2Id }, data: { name: 'Sunrise Grocery Hub', category: 'grocery' } });
  }

  // Staff
  const sureshUser = await prisma.user.upsert({
    where: { phone: '+919111000010' },
    update: { name: 'Suresh Das' },
    create: { phone: '+919111000010', passwordHash: demoHash, name: 'Suresh Das', preferredLanguage: 'en' },
  });
  const fatimaUser = await prisma.user.upsert({
    where: { phone: '+919111000011' },
    update: { name: 'Fatima Sheikh' },
    create: { phone: '+919111000011', passwordHash: demoHash, name: 'Fatima Sheikh', preferredLanguage: 'en' },
  });

  let sureshMem = await prisma.vendorUser.findUnique({ where: { vendorId_userId: { vendorId: v2Id, userId: sureshUser.id } } });
  if (!sureshMem) sureshMem = await prisma.vendorUser.create({ data: { vendorId: v2Id, userId: sureshUser.id, roleId: staffRoleId, status: 'ACTIVE', phone: '+919111000010', areaRouteLabel: 'North Zone — Morning', joinedAt: d('2026-01-01') } });

  let fatimaMem = await prisma.vendorUser.findUnique({ where: { vendorId_userId: { vendorId: v2Id, userId: fatimaUser.id } } });
  if (!fatimaMem) fatimaMem = await prisma.vendorUser.create({ data: { vendorId: v2Id, userId: fatimaUser.id, roleId: staffRoleId, status: 'ACTIVE', phone: '+919111000011', areaRouteLabel: 'South Zone', joinedAt: d('2026-01-01') } });

  for (const m of [sureshMem, fatimaMem]) await grantAllStaff(m.id);

  // Customers (12)
  const customerSeeds = [
    { phone: '+919111100001', name: 'Anita Roy',          locality: 'Jayanagar',    address: '14, 3rd Cross, Jayanagar',      start: '2026-01-01' },
    { phone: '+919111100002', name: 'Deepak Nair',        locality: 'Malleshwaram', address: '28, 8th Cross, Malleshwaram',   start: '2026-01-01' },
    { phone: '+919111100003', name: 'Geeta Pillai',       locality: 'JP Nagar',     address: '5, Phase 3, JP Nagar',          start: '2026-01-01' },
    { phone: '+919111100004', name: 'Harish Shetty',      locality: 'Koramangala',  address: '11, 3rd Block, Koramangala',    start: '2026-01-01' },
    { phone: '+919111100005', name: 'Indira Rao',         locality: 'Banashankari', address: '33, 2nd Stage, Banashankari',   start: '2026-01-01' },
    { phone: '+919111100006', name: 'Ramakrishna Pillai', locality: 'Banashankari', address: '7, 6th Block, Banashankari',    start: '2026-02-01' },
    { phone: '+919111100007', name: 'Usha Mehta',         locality: 'Rajajinagar',  address: '19, 3rd Block, Rajajinagar',   start: '2026-02-01' },
    { phone: '+919111100008', name: 'Pradeep Gowda',      locality: 'Malleshwaram', address: '45, 15th Cross, Malleshwaram', start: '2026-03-01' },
    { phone: '+919111100009', name: 'Kavitha Rao',        locality: 'JP Nagar',     address: '11, Phase 7, JP Nagar',        start: '2026-01-01' },
    { phone: '+919111100010', name: 'Sanjay Kumar',       locality: 'Koramangala',  address: '6, 4th Block, Koramangala',    start: '2026-01-01' },
    { phone: '+919111100011', name: 'Meena Murthy',       locality: 'Jayanagar',    address: '29, 5th Block, Jayanagar',     start: '2026-03-01' },
    { phone: '+919111100012', name: 'Vinod Hegde',        locality: 'Indiranagar',  address: '12, Defence Colony, Indiranagar', start: '2026-04-01' },
  ];
  const customers: CustomerRow[] = [];
  for (const c of customerSeeds) {
    const cust = await prisma.customer.upsert({
      where: { phone: c.phone },
      update: { name: c.name, locality: c.locality, address: c.address },
      create: { phone: c.phone, name: c.name, locality: c.locality, address: c.address, autoMarkEnabled: true, customerSince: d(c.start) },
    });
    await prisma.vendorCustomer.upsert({
      where: { vendorId_customerId: { vendorId: v2Id, customerId: cust.id } },
      update: {},
      create: { vendorId: v2Id, customerId: cust.id, status: 'ACTIVE', acquisitionSource: 'MANUAL_ADD' },
    });
    customers.push({ id: cust.id, phone: c.phone, startDate: c.start });
  }

  const byPhone = Object.fromEntries(customers.map((c) => [c.phone, c]));

  // Supply lists: Vegetables → Suresh | Fruits + Eggs → Fatima
  const veggies = await ensureList(v2Id, 'Morning Vegetables', { supplyType: 'Vegetables', unit: 'kg', defaultQuantity: '1.000', ratePerUnit: '80.00', startTime: '07:00', frequency: 'DAILY' }, sureshMem.id);
  const fruits  = await ensureList(v2Id, 'Weekend Fruits',     { supplyType: 'Fruits',     unit: 'kg', defaultQuantity: '2.000', ratePerUnit: '120.00',startTime: '08:00', frequency: 'WEEKLY', daysOfWeek: [6, 7] }, fatimaMem.id);
  const eggs    = await ensureList(v2Id, 'Daily Eggs',         { supplyType: 'Eggs',       unit: 'pieces', defaultQuantity: '6.000', ratePerUnit: '8.00', startTime: '06:30', frequency: 'DAILY' }, fatimaMem.id);

  type SubPlan = { phone: string; qty: string; rate: string; end?: string; };
  const vegSubs: SubPlan[] = [
    { phone: '+919111100001', qty: '1.000', rate: '80.00' },
    { phone: '+919111100002', qty: '0.500', rate: '80.00' },
    { phone: '+919111100006', qty: '1.000', rate: '80.00' },
    { phone: '+919111100007', qty: '0.500', rate: '78.00' },
    { phone: '+919111100008', qty: '1.000', rate: '80.00' },
    { phone: '+919111100009', qty: '1.500', rate: '80.00' },
    { phone: '+919111100010', qty: '1.000', rate: '80.00' },
  ];
  const fruitSubs: SubPlan[] = [
    { phone: '+919111100003', qty: '1.000', rate: '120.00' },
    { phone: '+919111100004', qty: '2.000', rate: '120.00' },
    { phone: '+919111100005', qty: '1.000', rate: '115.00' },
    { phone: '+919111100006', qty: '2.000', rate: '120.00' },
    { phone: '+919111100009', qty: '1.000', rate: '120.00' },
    { phone: '+919111100011', qty: '1.000', rate: '120.00' },
    { phone: '+919111100012', qty: '1.500', rate: '120.00' },
  ];
  const eggSubs: SubPlan[] = [
    { phone: '+919111100003', qty: '6.000',  rate: '8.00' },
    { phone: '+919111100004', qty: '12.000', rate: '8.00' },
    { phone: '+919111100005', qty: '6.000',  rate: '8.00' },
    { phone: '+919111100010', qty: '6.000',  rate: '8.00' },
    { phone: '+919111100011', qty: '12.000', rate: '7.50' },
    { phone: '+919111100012', qty: '6.000',  rate: '8.00' },
  ];

  const subs: SubRow[] = [];
  for (const [plans, list] of [
    [vegSubs, veggies], [fruitSubs, fruits], [eggSubs, eggs],
  ] as [SubPlan[], typeof veggies][]) {
    for (const p of plans) {
      const customer = byPhone[p.phone];
      if (!customer) continue;
      const subId = await ensureSub(v2Id, list.id, customer.id, p.phone, p.qty, p.rate, customer.startDate, p.end);
      if (subId) {
        subs.push({
          id: subId, customerId: customer.id, customerPhone: p.phone,
          supplyListId: list.id, startDate: customer.startDate, endDate: p.end,
          qty: p.qty, rate: p.rate, unit: list.unit,
          frequency: list.frequency, daysOfWeek: list.daysOfWeek,
        });
      }
    }
  }

  return { v2Id, owner: ownerUser, customers, subs };
}

// ── generate Leave records ────────────────────────────────────────────────────

async function generateLeaves(
  subs: SubRow[],
  leaveMap: Record<string, LeaveBlock[]>,
  createdByUserId: bigint,
) {
  let count = 0;
  for (const sub of subs) {
    const blocks = leaveMap[sub.customerPhone] ?? [];
    for (const block of blocks) {
      const existing = await prisma.leave.findFirst({
        where: { supplyListCustomerId: sub.id, startDate: d(block.start) },
      });
      if (existing) continue;
      await prisma.leave.create({
        data: {
          supplyListCustomerId: sub.id,
          startDate: d(block.start), endDate: d(block.end),
          leaveType: 'VENDOR_MARKED', reason: block.reason,
          createdByUserId,
        },
      });
      count++;
    }
  }
  return count;
}

// ── generate delivery history ─────────────────────────────────────────────────

async function generateDeliveryHistory(
  vendorId: bigint,
  subs: SubRow[],
  leaveMap: Record<string, LeaveBlock[]>,
  markedByUserId: bigint,
): Promise<number> {
  const todayStr = '2026-06-13';
  const startDate = d('2026-01-01');
  const endDate   = d(todayStr);

  type DsRow = {
    vendorId: bigint; supplyListCustomerId: bigint; supplyListId: bigint;
    serviceDate: Date; status: string;
    quantity: string; unit: string; ratePerUnit: string; baseAmount: string; finalAmount: string;
    isAutoMarked: boolean; markedByUserId: bigint | null; markedAt: Date | null;
  };

  const batch: DsRow[] = [];

  for (const sub of subs) {
    const subStart = d(sub.startDate);
    const subEnd   = sub.endDate ? d(sub.endDate) : endDate;
    const effectiveStart = subStart > startDate ? subStart : startDate;
    const effectiveEnd   = subEnd   < endDate   ? subEnd   : endDate;

    let cur = new Date(effectiveStart);
    let idx = 0;
    while (cur <= effectiveEnd) {
      const curStr = ymd(cur);

      // Weekly filter
      if (sub.frequency === 'WEEKLY' && sub.daysOfWeek.length > 0 && !sub.daysOfWeek.includes(dow(cur))) {
        cur = addDays(cur, 1); idx++; continue;
      }

      const baseAmt = (parseFloat(sub.qty) * parseFloat(sub.rate)).toFixed(2);
      const onLv = checkLeave(sub.customerPhone, cur, leaveMap);

      // Status logic
      let status: string;
      if (onLv) {
        status = 'LEAVE';
      } else if (curStr === todayStr) {
        // Today: 25% pending (not yet marked)
        status = (idx % 4 === 0) ? 'PENDING' : 'DELIVERED';
      } else if (curStr === ymd(addDays(d(todayStr), -1))) {
        // Yesterday: 10% pending
        status = (idx % 10 === 0) ? 'PENDING' : 'DELIVERED';
      } else {
        // Past: 2% still pending (forgot to mark), rest delivered
        status = (idx % 50 === 3) ? 'PENDING' : 'DELIVERED';
      }

      const isAuto = status === 'DELIVERED' && idx % 3 !== 0; // 67% auto-marked

      batch.push({
        vendorId,
        supplyListCustomerId: sub.id,
        supplyListId: sub.supplyListId,
        serviceDate: new Date(cur),
        status,
        quantity: sub.qty,
        unit: sub.unit,
        ratePerUnit: sub.rate,
        baseAmount: baseAmt,
        finalAmount: baseAmt,
        isAutoMarked: isAuto,
        markedByUserId: status === 'DELIVERED' ? markedByUserId : null,
        markedAt: status === 'DELIVERED' ? new Date(cur.getTime() + 8 * 3600 * 1000) : null,
      });

      cur = addDays(cur, 1); idx++;
    }
  }

  // Insert in chunks of 200 (skipDuplicates for idempotency)
  let created = 0;
  for (let i = 0; i < batch.length; i += 200) {
    const chunk = batch.slice(i, i + 200);
    const result = await prisma.dailySupply.createMany({ data: chunk as any, skipDuplicates: true });
    created += result.count;
  }
  return created;
}

// ── generate payments ─────────────────────────────────────────────────────────

async function generatePayments(
  vendorId: bigint,
  customers: CustomerRow[],
  leaveMap: Record<string, LeaveBlock[]>,
  recordedByUserId: bigint,
  monthlyAmounts: Record<string, number>,
  paymentBehaviour: Record<string, { payDay: number; skipMonths?: number[]; partialMonths?: number[]; }>,
): Promise<number> {
  const months = [
    { year: 2026, month: 1 }, { year: 2026, month: 2 }, { year: 2026, month: 3 },
    { year: 2026, month: 4 }, { year: 2026, month: 5 }, { year: 2026, month: 6 },
  ];

  let count = 0;
  for (const cust of customers) {
    const base = monthlyAmounts[cust.phone];
    if (!base) continue;
    const beh = paymentBehaviour[cust.phone] ?? { payDay: 5 };

    for (const { year, month } of months) {
      // Only pay from the customer's start month
      const startM = new Date(d(cust.startDate));
      if (year < startM.getFullYear() || (year === startM.getFullYear() && month < startM.getMonth() + 1)) continue;
      // Stop before current month for some (outstanding)
      if (beh.skipMonths?.includes(month)) continue;

      // Don't seed future payments
      if (year > 2026 || (year === 2026 && month > 5)) continue; // cap at May (Jun outstanding)
      if (year === 2026 && month === 6) continue;

      const payDay = beh.payDay + (month % 3); // slight variation
      const payDate = new Date(Date.UTC(year, month - 1, Math.min(payDay, 28)));
      const amount  = beh.partialMonths?.includes(month) ? (base * 0.6).toFixed(2) : base.toFixed(2);

      // Idempotency: check existence by vendor+customer+date+amount
      const existing = await prisma.payment.findFirst({
        where: { vendorId, customerId: cust.id, paymentDate: payDate },
      });
      if (existing) continue;

      await prisma.payment.create({
        data: {
          customerId: cust.id, vendorId,
          amount, paymentDate: payDate,
          paymentMethod: month % 3 === 0 ? 'UPI' : 'CASH',
          referenceNumber: month % 3 === 0 ? `UPI${year}${String(month).padStart(2,'0')}${cust.id.toString().slice(-4)}` : null,
          recordedByUserId,
        },
      });
      count++;
    }
  }
  return count;
}

// ── generate extra charges ────────────────────────────────────────────────────

async function generateExtraCharges(vendorId: bigint, subs: SubRow[], recordedByUserId: bigint) {
  // Extra orders + discount cases
  const cases = [
    { phone: '+919000100001', date: '2026-04-01', amount: '180.00',  comment: 'Ugadi special order — 3L extra milk' },
    { phone: '+919000100002', date: '2026-02-14', amount: '120.00',  comment: "Valentine's Day — extra 2L milk" },
    { phone: '+919000100006', date: '2026-01-15', amount: '-30.00',  comment: 'Quality issue refund — partial discount' },
    { phone: '+919000100007', date: '2026-03-10', amount: '90.00',   comment: 'Extra 1.5L — guest visit' },
    { phone: '+919000100015', date: '2026-03-15', amount: '-35.00',  comment: 'First-month welcome discount' },
    { phone: '+919111100004', date: '2026-02-01', amount: '240.00',  comment: 'Bulk order — 2kg extra vegetables' },
    { phone: '+919111100010', date: '2026-03-25', amount: '96.00',   comment: 'Extra 12 eggs for party' },
  ];

  for (const c of cases) {
    const sub = subs.find((s) => s.customerPhone === c.phone);
    if (!sub) continue;
    const ds = await prisma.dailySupply.findFirst({
      where: { supplyListCustomerId: sub.id, serviceDate: d(c.date) },
    });
    if (!ds) continue;
    const exists = await prisma.supplyExtraCharge.findFirst({ where: { dailySupplyId: ds.id } });
    if (exists) continue;
    await prisma.supplyExtraCharge.create({
      data: {
        dailySupplyId: ds.id,
        amount: c.amount,
        comment: c.comment,
        addedByUserId: recordedByUserId,
        addedByRole: 'VENDOR_OWNER',
      },
    });
    // Update finalAmount on the daily supply
    const newFinal = (parseFloat(ds.finalAmount.toString()) + parseFloat(c.amount)).toFixed(2);
    await prisma.dailySupply.update({ where: { id: ds.id }, data: { finalAmount: newFinal } });
  }
}

// ── vendor settings ───────────────────────────────────────────────────────────

async function ensureVendorSettings(vendorId: bigint, opts?: Partial<{
  autoSendBillsEnabled: boolean; defaultCreditLimit: number; defaultCreditPeriodDays: number;
}>) {
  await prisma.vendorSettings.upsert({
    where: { vendorId },
    update: {
      defaultCreditLimit: opts?.defaultCreditLimit ?? 2000,
      defaultCreditPeriodDays: opts?.defaultCreditPeriodDays ?? 30,
      bulkOperationConcurrencyLimit: 50,
      autoSendBillsEnabled: opts?.autoSendBillsEnabled ?? false,
    },
    create: {
      vendorId,
      autoMarkEnabled: true,
      autoSendBillsEnabled: opts?.autoSendBillsEnabled ?? false,
      autoSendBillsTime: '20:00',
      notificationPreferences: {},
      defaultCreditLimit: opts?.defaultCreditLimit ?? 2000,
      defaultCreditPeriodDays: opts?.defaultCreditPeriodDays ?? 30,
      bulkOperationConcurrencyLimit: 50,
    },
  });
}

// ── GROWTH subscription for V2 ────────────────────────────────────────────────

async function ensureV2Subscription(v2Id: bigint) {
  const growthPlan = await prisma.subscriptionPlan.findFirst({ where: { planCode: 'GROWTH' } });
  if (!growthPlan) return;
  const existing = await prisma.vendorSubscription.findFirst({
    where: { vendorId: v2Id, status: { in: ['ACTIVE', 'TRIAL', 'PAST_DUE'] } },
  });
  if (existing) return;
  const today = new Date();
  const nextBilling = addDays(today, 30);
  await prisma.vendorSubscription.create({
    data: {
      vendorId: v2Id, subscriptionPlanId: growthPlan.id, billingCycle: 'MONTHLY',
      startDate: d('2026-01-01'), nextBillingDate: nextBilling,
      status: 'ACTIVE', amountPaid: 499, autoRenewal: true, isTrial: false,
    },
  });
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🎬 Running enhanced demo seed...\n');

  const testHash = await bcrypt.hash('Test@123', 10);
  const demoHash = await bcrypt.hash('Demo@123', 10);
  const ownerRole = await prisma.role.findUniqueOrThrow({ where: { name: 'vendor_owner' } });
  const staffRole = await prisma.role.findUniqueOrThrow({ where: { name: 'vendor_staff' } });

  // ── V1 ──
  const { v1Id, owner: v1Owner, customers: v1Customers, subs: v1Subs } =
    await setupV1(testHash, ownerRole.id, staffRole.id);
  console.log(`✓ V1 ready — ${v1Customers.length} customers, ${v1Subs.length} subscriptions`);

  // ── V2 ──
  const { v2Id, owner: v2Owner, customers: v2Customers, subs: v2Subs } =
    await setupV2(demoHash, ownerRole.id, staffRole.id);
  console.log(`✓ V2 ready — ${v2Customers.length} customers, ${v2Subs.length} subscriptions`);

  // ── Leaves ──
  const v1Leaves = await generateLeaves(v1Subs, V1_LEAVES, v1Owner.id);
  const v2Leaves = await generateLeaves(v2Subs, V2_LEAVES, v2Owner.id);
  console.log(`✓ Leave records — V1: ${v1Leaves}, V2: ${v2Leaves}`);

  // ── Delivery history ──
  const v1Del = await generateDeliveryHistory(v1Id, v1Subs, V1_LEAVES, v1Owner.id);
  const v2Del = await generateDeliveryHistory(v2Id, v2Subs, V2_LEAVES, v2Owner.id);
  console.log(`✓ Delivery records — V1: ${v1Del} new, V2: ${v2Del} new`);

  // ── Payments ──
  // V1 monthly amounts (estimated based on subscription plan per customer)
  const v1Amounts: Record<string, number> = {
    '+919000100001': 2280, '+919000100002': 1800, '+919000100003': 1860,
    '+919000100004': 2010, '+919000100005': 1050, '+919000100006': 2850,
    '+919000100007': 1800, '+919000100008': 1800, '+919000100009': 1635,
    '+919000100010': 1170, '+919000100011': 1800, '+919000100012': 1830,
    '+919000100013': 1860, '+919000100014': 1980, '+919000100015': 3900,
  };
  // V1 payment behaviour: payDay, skipMonths (outstanding)
  const v1Behaviour: Record<string, { payDay: number; skipMonths?: number[]; partialMonths?: number[]; }> = {
    '+919000100001': { payDay: 2  },                        // Ramesh — always early
    '+919000100002': { payDay: 10 },                        // Sunita — slightly late
    '+919000100003': { payDay: 3  },                        // Arjun — early
    '+919000100004': { payDay: 12 },                        // Priya — slightly late
    '+919000100005': { payDay: 5, skipMonths: [4, 5] },     // Vikram — churned, 2 months outstanding
    '+919000100006': { payDay: 1  },                        // Lakshmi — model payer
    '+919000100007': { payDay: 15, skipMonths: [5] },       // Imran — late, May outstanding
    '+919000100008': { payDay: 8, skipMonths: [4, 5] },     // Deepa — 2 months outstanding
    '+919000100009': { payDay: 5  },                        // Kavya — good
    '+919000100010': { payDay: 7  },                        // Sumanth — good
    '+919000100011': { payDay: 4  },                        // Nandita — early
    '+919000100012': { payDay: 10 },                        // Bharati — on time
    '+919000100013': { payDay: 6  },                        // Venkatesh — good
    '+919000100014': { payDay: 14, partialMonths: [3] },    // Padma — paid partial in Mar
    '+919000100015': { payDay: 10, skipMonths: [5] },       // Gopal — May outstanding
  };

  const v2Amounts: Record<string, number> = {
    '+919111100001': 2400, '+919111100002': 1200, '+919111100003': 2208,
    '+919111100004': 3840, '+919111100005': 2316, '+919111100006': 3200,
    '+919111100007': 1560, '+919111100008': 2400, '+919111100009': 3360,
    '+919111100010': 1728, '+919111100011': 1830, '+919111100012': 2160,
  };
  const v2Behaviour: Record<string, { payDay: number; skipMonths?: number[]; partialMonths?: number[]; }> = {
    '+919111100001': { payDay: 3  },
    '+919111100002': { payDay: 8  },
    '+919111100003': { payDay: 5  },
    '+919111100004': { payDay: 10, skipMonths: [5] },   // Harish — May outstanding
    '+919111100005': { payDay: 2  },
    '+919111100006': { payDay: 6  },
    '+919111100007': { payDay: 12 },
    '+919111100008': { payDay: 5  },
    '+919111100009': { payDay: 4  },
    '+919111100010': { payDay: 7  },
    '+919111100011': { payDay: 8  },
    '+919111100012': { payDay: 15, skipMonths: [5] },   // Vinod — new customer, May outstanding
  };

  const v1Pmts = await generatePayments(v1Id, v1Customers, V1_LEAVES, v1Owner.id, v1Amounts, v1Behaviour);
  const v2Pmts = await generatePayments(v2Id, v2Customers, V2_LEAVES, v2Owner.id, v2Amounts, v2Behaviour);
  console.log(`✓ Payments — V1: ${v1Pmts}, V2: ${v2Pmts}`);

  // ── Extra charges ──
  const allSubs = [...v1Subs, ...v2Subs];
  await generateExtraCharges(v1Id, v1Subs, v1Owner.id);
  await generateExtraCharges(v2Id, v2Subs, v2Owner.id);
  console.log('✓ Extra charges done');

  // ── Settings & subscription ──
  await ensureVendorSettings(v1Id);
  await ensureVendorSettings(v2Id, { autoSendBillsEnabled: true, defaultCreditLimit: 1500, defaultCreditPeriodDays: 15 });
  await ensureV2Subscription(v2Id);

  console.log('\n✅ Enhanced demo seed complete!\n');
  printSummary();
}

function printSummary() {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║              DEMO CREDENTIALS                                 ║
╠══════════════════════════════════════════════════════════════╣
║ VENDOR 1 — Krishna Dairy Farm (dairy)                         ║
║  Owner          Rajesh Kumar   +919000000001  Test@123        ║
║  Staff (Active) Amit Verma     +919000000010  Test@123        ║
║  Staff (Active) Ravi Sharma    +919000000011  Test@123        ║
║  Staff (Active) Priya Devi     +919000000013  Test@123        ║
║  Staff (Invited)Meena Pillai   +919000000012  Test@123        ║
║  Customers: 15 | Supply lists: 4 | 6 months delivery data     ║
╠══════════════════════════════════════════════════════════════╣
║ VENDOR 2 — Sunrise Grocery Hub (grocery)                      ║
║  Owner          Kiran Patil    +919111000001  Demo@123        ║
║  Staff (Active) Suresh Das     +919111000010  Demo@123        ║
║  Staff (Active) Fatima Sheikh  +919111000011  Demo@123        ║
║  Customers: 12 | Supply lists: 3 | 6 months delivery data     ║
╠══════════════════════════════════════════════════════════════╣
║ DEMO SCENARIOS TO TEST                                        ║
║  • Conflict: Bharati Krishnan — leave Mar 20-25 but           ║
║    delivery marked DELIVERED on Mar 22 (check dashboard)      ║
║  • Churn:    Vikram Singh — subscription ended Apr 1          ║
║  • Outstanding: Deepa Menon, Imran Khan — 2 months unpaid     ║
║  • Multi-list: Sunita Sharma & Deepa Menon on Morning +       ║
║    Evening milk both                                          ║
║  • Staff routes: Amit=Morning Milk | Ravi=Evening Milk |      ║
║    Priya=Bread+Curd | Suresh=Vegetables | Fatima=Fruits+Eggs  ║
╚══════════════════════════════════════════════════════════════╝
  `);
}

main()
  .catch((e) => { console.error('❌ Demo seed failed:', e); process.exit(1); })
  .finally(() => { void prisma.$disconnect(); });
