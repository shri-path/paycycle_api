import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const permissions = [
  { name: 'vendor:read', resource: 'vendor', action: 'read', description: 'View vendor details' },
  { name: 'vendor:write', resource: 'vendor', action: 'write', description: 'Edit vendor details' },
  { name: 'vendor:delete', resource: 'vendor', action: 'delete', description: 'Delete vendor' },
  { name: 'staff:read', resource: 'staff', action: 'read', description: 'View staff' },
  { name: 'staff:write', resource: 'staff', action: 'write', description: 'Add/edit staff' },
  { name: 'staff:delete', resource: 'staff', action: 'delete', description: 'Remove staff' },
  { name: 'customer:read', resource: 'customer', action: 'read', description: 'View customers' },
  { name: 'customer:write', resource: 'customer', action: 'write', description: 'Add/edit customers' },
  { name: 'customer:delete', resource: 'customer', action: 'delete', description: 'Delete customers' },
  { name: 'delivery:read', resource: 'delivery', action: 'read', description: 'View deliveries' },
  { name: 'delivery:write', resource: 'delivery', action: 'write', description: 'Mark deliveries' },
  { name: 'delivery:approve', resource: 'delivery', action: 'approve', description: 'Approve deliveries' },
  { name: 'leave:read', resource: 'leave', action: 'read', description: 'View leaves' },
  { name: 'leave:write', resource: 'leave', action: 'write', description: 'Mark leaves' },
  { name: 'billing:read', resource: 'billing', action: 'read', description: 'View bills' },
  { name: 'billing:write', resource: 'billing', action: 'write', description: 'Create bills' },
  { name: 'payment:read', resource: 'payment', action: 'read', description: 'View payments' },
  { name: 'payment:write', resource: 'payment', action: 'write', description: 'Record payments' },
  { name: 'extra_charge:read', resource: 'extra_charge', action: 'read', description: 'View extra charges' },
  { name: 'extra_charge:write', resource: 'extra_charge', action: 'write', description: 'Add extra charges' },
  { name: 'permissions:manage', resource: 'permissions', action: 'manage', description: 'Manage role permissions' },
  // US-002 RBAC catalog — staff-grantable capabilities (resource:action)
  { name: 'delivery:mark', resource: 'delivery', action: 'mark', description: 'Mark deliveries (staff grant: mark_deliveries)' },
  { name: 'leave:mark', resource: 'leave', action: 'mark', description: 'Mark customer leaves (staff grant: mark_leaves)' },
  { name: 'charge:add', resource: 'charge', action: 'add', description: 'Add extra charges (staff grant: add_extra_charges)' },
  // US-002 RBAC catalog — owner-exclusive markers
  { name: 'list:create', resource: 'list', action: 'create', description: 'Create supply lists (owner only)' },
  { name: 'list:edit', resource: 'list', action: 'edit', description: 'Edit supply lists (owner only)' },
  { name: 'payment:mark', resource: 'payment', action: 'mark', description: 'Mark payments received (owner only)' },
  { name: 'price:edit', resource: 'price', action: 'edit', description: 'Edit pricing (owner only)' },
  { name: 'staff:invite', resource: 'staff', action: 'invite', description: 'Invite/manage staff (owner only)' },
  { name: 'subscription:manage', resource: 'subscription', action: 'manage', description: 'Manage subscription (owner only)' },
  { name: 'revenue:view', resource: 'revenue', action: 'view', description: 'View revenue reports (owner only)' },
  // US-005 RBAC catalog — supply lists & subscriptions (resource:action)
  { name: 'list:read', resource: 'list', action: 'read', description: 'View supply lists' },
  { name: 'list:delete', resource: 'list', action: 'delete', description: 'Archive supply lists (owner only)' },
  { name: 'list:assign_staff', resource: 'list', action: 'assign_staff', description: 'Assign staff to supply lists (owner only)' },
  { name: 'subscription:read', resource: 'subscription', action: 'read', description: 'View customer subscriptions' },
  { name: 'subscription:write', resource: 'subscription', action: 'write', description: 'Manage customer subscriptions (owner only)' },
  // US-007 Audit & Accountability — read access to the activity log (owner default; forward-compat for staff delegation)
  { name: 'audit:read', resource: 'audit', action: 'read', description: 'View audit / activity logs (owner only in v1)' },
  // US-010 Dashboard — owner-only financial surfaces
  { name: 'dashboard:read', resource: 'dashboard', action: 'read', description: 'View owner dashboard, supply forecast, outstanding aging (owner only)' },
  { name: 'vendor-settings:read', resource: 'vendor-settings', action: 'read', description: 'View vendor automation settings (owner only)' },
  { name: 'vendor-settings:update', resource: 'vendor-settings', action: 'update', description: 'Update vendor automation settings (owner only)' },
  // US-010 Staff dashboard — held by both owner and staff
  { name: 'staff-dashboard:read', resource: 'staff-dashboard', action: 'read', description: 'View staff dashboard (owner: any staff; staff: self only)' },
  // US-011 Bulk Operations + Notification Preferences
  { name: 'bulk-operation:write', resource: 'bulk-operation', action: 'write', description: 'Trigger bulk operations (mark leave, adjust rate, send reminders) — owner only' },
  { name: 'bulk-operation:read', resource: 'bulk-operation', action: 'read', description: 'View bulk operation status — owner only' },
  { name: 'notification-preferences:update', resource: 'notification-preferences', action: 'update', description: 'Update vendor notification preferences — owner only' },
];

// Staff-grantable permission keys (per-membership grants, NOT role-level).
const STAFF_GRANT_KEYS = ['mark_deliveries', 'mark_leaves', 'add_extra_charges'] as const;

async function seed() {
  console.log('🌱 Seeding database...');

  // 1. Upsert roles
  const vendorOwnerRole = await prisma.role.upsert({
    where: { name: 'vendor_owner' },
    update: {},
    create: {
      name: 'vendor_owner',
      displayName: 'Vendor Owner',
      description: 'Full control over the vendor business',
    },
  });

  const vendorStaffRole = await prisma.role.upsert({
    where: { name: 'vendor_staff' },
    update: {},
    create: {
      name: 'vendor_staff',
      displayName: 'Vendor Staff',
      description: 'Limited permissions assigned by the owner',
    },
  });

  console.log('✓ Roles seeded:', vendorOwnerRole.name, vendorStaffRole.name);

  // 2. Upsert all permissions
  const permissionRecords = [];
  for (const perm of permissions) {
    const record = await prisma.permission.upsert({
      where: { name: perm.name },
      update: {},
      create: perm,
    });
    permissionRecords.push(record);
  }

  console.log(`✓ ${permissionRecords.length} permissions seeded`);

  // 3. Assign ALL permissions to vendor_owner
  for (const perm of permissionRecords) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: vendorOwnerRole.id, permissionId: perm.id } },
      update: {},
      create: { roleId: vendorOwnerRole.id, permissionId: perm.id },
    });
  }

  console.log('✓ All permissions assigned to vendor_owner');

  // US-009: Seed subscription plans (idempotent, always runs)
  await seedSubscriptionPlans();

  // 4. Assign read-only subset to vendor_staff
  const staffPermissionNames = [
    'delivery:read', 'delivery:write',
    'leave:read', 'leave:write',
    'customer:read',
    'billing:read',
    'payment:read',
    'extra_charge:read',
    // US-005 — staff read-side for supply lists & subscriptions
    'list:read',
    'subscription:read',
    // US-010 — staff dashboard (self-only, enforced in handler)
    'staff-dashboard:read',
  ];
  const staffPerms = permissionRecords.filter((p) => staffPermissionNames.includes(p.name));
  for (const perm of staffPerms) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: vendorStaffRole.id, permissionId: perm.id } },
      update: {},
      create: { roleId: vendorStaffRole.id, permissionId: perm.id },
    });
  }

  console.log('✓ Staff permissions assigned to vendor_staff');

  // 5. Development seed: test vendor owner
  if (process.env['NODE_ENV'] !== 'production') {
    const hash = await bcrypt.hash('Test@123', 10);

    const testUser = await prisma.user.upsert({
      where: { phone: '+919000000001' },
      update: {},
      create: {
        phone: '+919000000001',
        passwordHash: hash,
        name: 'Test Owner',
        preferredLanguage: 'en',
      },
    });

    let testVendorId: bigint;
    const existingOwnerMembership = await prisma.vendorUser.findFirst({
      where: { userId: testUser.id, roleId: vendorOwnerRole.id },
    });

    if (!existingOwnerMembership) {
      const testVendor = await prisma.vendor.create({
        data: { name: 'Test Vendor' },
      });
      testVendorId = testVendor.id;

      await prisma.vendorUser.create({
        data: {
          vendorId: testVendor.id,
          userId: testUser.id,
          roleId: vendorOwnerRole.id,
          status: 'ACTIVE',
          joinedAt: new Date(),
        },
      });
    } else {
      testVendorId = existingOwnerMembership.vendorId;
    }

    console.log('✓ Dev test user seeded: +919000000001 / Test@123');

    // US-002: dev staff memberships with varied statuses + permission grants
    const staffSeeds: Array<{
      phone: string;
      name: string;
      status: 'ACTIVE' | 'DISABLED' | 'INVITED';
      area: string;
      grants: Array<(typeof STAFF_GRANT_KEYS)[number]>;
    }> = [
      {
        phone: '+919000000010',
        name: 'Staff Active',
        status: 'ACTIVE',
        area: 'Sector 21 — Morning Route',
        grants: ['mark_deliveries', 'mark_leaves'],
      },
      {
        phone: '+919000000011',
        name: 'Staff Disabled',
        status: 'DISABLED',
        area: 'Sector 22 — Evening Route',
        grants: ['mark_deliveries'],
      },
      {
        phone: '+919000000012',
        name: 'Staff Invited',
        status: 'INVITED',
        area: 'Sector 23 — All Day',
        grants: ['mark_deliveries', 'mark_leaves', 'add_extra_charges'],
      },
    ];

    for (const s of staffSeeds) {
      const staffUser = await prisma.user.upsert({
        where: { phone: s.phone },
        update: {},
        create: { phone: s.phone, passwordHash: hash, name: s.name, preferredLanguage: 'en' },
      });

      let membership = await prisma.vendorUser.findUnique({
        where: { vendorId_userId: { vendorId: testVendorId, userId: staffUser.id } },
      });

      if (!membership) {
        membership = await prisma.vendorUser.create({
          data: {
            vendorId: testVendorId,
            userId: staffUser.id,
            roleId: vendorStaffRole.id,
            status: s.status,
            phone: s.phone,
            areaRouteLabel: s.area,
            invitedAt: new Date(),
            joinedAt: s.status === 'INVITED' ? null : new Date(),
            disabledAt: s.status === 'DISABLED' ? new Date() : null,
          },
        });
      }

      for (const key of STAFF_GRANT_KEYS) {
        await prisma.staffPermission.upsert({
          where: {
            vendorUserId_permissionKey: { vendorUserId: membership.id, permissionKey: key },
          },
          update: { granted: s.grants.includes(key) },
          create: { vendorUserId: membership.id, permissionKey: key, granted: s.grants.includes(key) },
        });
      }

      // Seed one PENDING invitation for the INVITED staff member
      if (s.status === 'INVITED') {
        const existingInvite = await prisma.staffInvitation.findFirst({
          where: { vendorUserId: membership.id, status: 'PENDING' },
        });
        if (!existingInvite) {
          // Deterministic dev token hash (NOT a real CSPRNG token — dev seed only).
          const devTokenHash = `dev-seed-${membership.id.toString()}`.padEnd(64, '0');
          await prisma.staffInvitation.create({
            data: {
              vendorId: testVendorId,
              vendorUserId: membership.id,
              invitedByUserId: testUser.id,
              phone: s.phone,
              tokenHash: devTokenHash,
              status: 'PENDING',
              expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
              // US-004: exercise the resend path — this invite was re-sent over WhatsApp.
              sentVia: 'WHATSAPP',
              sentCount: 2,
              lastSentAt: new Date(),
            },
          });
        }
      }
    }

    console.log('✓ Dev staff memberships + grants + pending invitation seeded');

    // =========================================================================
    // US-005: dev customers, supply lists, staff assignments, subscriptions
    // =========================================================================
    await seedSupplyListsDevData(testVendorId);

    // =========================================================================
    // US-009: dev vendor subscription (Starter plan + history + invoices)
    // =========================================================================
    await seedDevVendorSubscription(testVendorId);

    // =========================================================================
    // US-011: dev vendor settings (credit defaults, concurrency, bulk ops log)
    // =========================================================================
    await seedUS011DevData(testVendorId, testUser.id);
  }

  console.log('✅ Seeding complete!');
}

/**
 * US-005 dev seed: customers + vendor_customers, supply lists (DAILY + WEEKLY),
 * staff assignments (1 primary each), and subscriptions with a mix of default
 * and custom overrides. Deterministic + idempotent (upsert by stable keys).
 */
async function seedSupplyListsDevData(vendorId: bigint): Promise<void> {
  // Realistic Indian customer directory for the dev vendor.
  const customerSeeds: Array<{ phone: string; name: string; locality: string; address: string }> = [
    { phone: '+919000100001', name: 'Ramesh Iyer', locality: 'Koramangala', address: '12, 5th Block, Koramangala' },
    { phone: '+919000100002', name: 'Sunita Sharma', locality: 'Indiranagar', address: '404, 12th Main, Indiranagar' },
    { phone: '+919000100003', name: 'Arjun Mehta', locality: 'HSR Layout', address: '7, Sector 2, HSR Layout' },
    { phone: '+919000100004', name: 'Priya Nair', locality: 'Jayanagar', address: '88, 4th Block, Jayanagar' },
    { phone: '+919000100005', name: 'Vikram Singh', locality: 'Whitefield', address: '21, Palm Meadows, Whitefield' },
    { phone: '+919000100006', name: 'Lakshmi Rao', locality: 'BTM Layout', address: '15, 2nd Stage, BTM Layout' },
    { phone: '+919000100007', name: 'Imran Khan', locality: 'Koramangala', address: '34, 6th Block, Koramangala' },
    { phone: '+919000100008', name: 'Deepa Menon', locality: 'Indiranagar', address: '9, 100ft Road, Indiranagar' },
  ];

  const customerIds: bigint[] = [];
  for (const c of customerSeeds) {
    const customer = await prisma.customer.upsert({
      where: { phone: c.phone },
      update: { name: c.name, locality: c.locality, address: c.address },
      create: {
        phone: c.phone,
        name: c.name,
        locality: c.locality,
        address: c.address,
        autoMarkEnabled: true,
      },
    });
    customerIds.push(customer.id);

    await prisma.vendorCustomer.upsert({
      where: { vendorId_customerId: { vendorId, customerId: customer.id } },
      update: {},
      create: {
        vendorId,
        customerId: customer.id,
        status: 'ACTIVE',
        acquisitionSource: 'MANUAL_ADD',
      },
    });
  }

  console.log(`✓ Dev customers + vendor_customers seeded (${customerIds.length})`);

  // The dev staff member we assign to lists as primary.
  const activeStaff = await prisma.vendorUser.findFirst({
    where: { vendorId, phone: '+919000000010' },
  });

  // Supply list definitions (DAILY + WEEKLY examples).
  const listSeeds: Array<{
    name: string;
    supplyType: string;
    unit: string;
    defaultQuantity: string;
    ratePerUnit: string;
    startTime: string;
    frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY';
    daysOfWeek?: number[];
  }> = [
    { name: 'Morning Milk', supplyType: 'Milk', unit: 'ltr', defaultQuantity: '1.000', ratePerUnit: '60.00', startTime: '06:30', frequency: 'DAILY' },
    { name: 'Evening Milk', supplyType: 'Milk', unit: 'ltr', defaultQuantity: '0.500', ratePerUnit: '62.00', startTime: '18:00', frequency: 'DAILY' },
    { name: 'Morning Bread', supplyType: 'Bread', unit: 'pieces', defaultQuantity: '1.000', ratePerUnit: '45.00', startTime: '07:00', frequency: 'WEEKLY', daysOfWeek: [1, 3, 5] },
  ];

  for (let i = 0; i < listSeeds.length; i++) {
    const s = listSeeds[i]!;
    const existing = await prisma.supplyList.findFirst({
      where: { vendorId, name: s.name, deletedAt: null },
    });
    if (existing) continue;

    const list = await prisma.supplyList.create({
      data: {
        vendorId,
        name: s.name,
        supplyType: s.supplyType,
        unit: s.unit,
        defaultQuantity: s.defaultQuantity,
        ratePerUnit: s.ratePerUnit,
        startTime: s.startTime,
        frequency: s.frequency,
        isActive: true,
        ...(s.daysOfWeek
          ? { schedule: { create: s.daysOfWeek.map((d) => ({ dayOfWeek: d })) } }
          : {}),
      },
    });

    // Assign the active staff member as primary on each list.
    if (activeStaff) {
      await prisma.supplyListStaff.create({
        data: {
          supplyListId: list.id,
          vendorUserId: activeStaff.id,
          isPrimary: true,
        },
      });
    }

    // 4 subscriptions per list: 2 default, 2 with custom overrides.
    const subscriberSlice = customerIds.slice(i * 2, i * 2 + 4);
    for (let j = 0; j < subscriberSlice.length; j++) {
      const customerId = subscriberSlice[j]!;
      const useCustom = j >= 2; // last two carry overrides
      await prisma.supplyListCustomer.create({
        data: {
          vendorId,
          supplyListId: list.id,
          customerId,
          customQuantity: useCustom ? '2.000' : null,
          customRatePerUnit: useCustom ? '58.00' : null,
          startDate: new Date(),
          isActive: true,
        },
      });
    }
  }

  console.log('✓ Dev supply lists + staff assignments + subscriptions seeded');
}

/**
 * US-009: Seed subscription plans (idempotent upsert by planCode).
 */
async function seedSubscriptionPlans(): Promise<void> {
  const plans = [
    {
      planCode: 'STARTER',
      planName: 'Starter',
      priceMonthly: 0.0,
      priceYearly: null,
      maxCustomers: 20,
      maxStaff: 1,
      maxSupplyLists: 5,
      features: {
        basic_delivery_tracking: true,
        customer_management: true,
      },
      isActive: true,
    },
    {
      planCode: 'GROWTH',
      planName: 'Growth',
      priceMonthly: 499.0,
      priceYearly: 4990.0,
      maxCustomers: 150,
      maxStaff: 3,
      maxSupplyLists: 10,
      features: {
        basic_delivery_tracking: true,
        customer_management: true,
        staff_management: true,
        analytics: true,
        whatsapp_notifications: true,
        credit_control: true,
      },
      isActive: true,
    },
    {
      planCode: 'PRO',
      planName: 'Pro',
      priceMonthly: 999.0,
      priceYearly: 9990.0,
      maxCustomers: 0,
      maxStaff: 0,
      maxSupplyLists: 0,
      features: {
        basic_delivery_tracking: true,
        customer_management: true,
        staff_management: true,
        analytics: true,
        whatsapp_notifications: true,
        credit_control: true,
        advanced_reports: true,
        api_access: true,
        priority_support: true,
      },
      isActive: true,
    },
  ];

  for (const plan of plans) {
    await prisma.subscriptionPlan.upsert({
      where: { planCode: plan.planCode },
      update: {
        planName: plan.planName,
        priceMonthly: plan.priceMonthly,
        priceYearly: plan.priceYearly,
        maxCustomers: plan.maxCustomers,
        maxStaff: plan.maxStaff,
        maxSupplyLists: plan.maxSupplyLists,
        features: plan.features as object,
        isActive: plan.isActive,
      },
      create: {
        planCode: plan.planCode,
        planName: plan.planName,
        priceMonthly: plan.priceMonthly,
        priceYearly: plan.priceYearly,
        maxCustomers: plan.maxCustomers,
        maxStaff: plan.maxStaff,
        maxSupplyLists: plan.maxSupplyLists,
        features: plan.features as object,
        isActive: plan.isActive,
      },
    });
  }

  console.log('✓ Subscription plans seeded (STARTER, GROWTH, PRO)');
}

/**
 * US-009: Seed dev vendor subscription (Starter plan + history + 2 invoices).
 */
async function seedDevVendorSubscription(vendorId: bigint): Promise<void> {
  const starterPlan = await prisma.subscriptionPlan.findFirst({
    where: { planCode: 'STARTER', isActive: true },
  });
  if (!starterPlan) {
    console.log('✓ Skipping dev subscription seed (STARTER plan not found)');
    return;
  }

  const existing = await prisma.vendorSubscription.findFirst({
    where: {
      vendorId,
      status: { in: ['ACTIVE', 'TRIAL', 'PAST_DUE'] },
      endDate: null,
    },
  });

  if (existing) {
    console.log('✓ Dev vendor already has active subscription — skipping');
    return;
  }

  const today = new Date();
  const nextBilling = new Date(today);
  nextBilling.setDate(nextBilling.getDate() + 30);

  const sub = await prisma.vendorSubscription.create({
    data: {
      vendorId,
      subscriptionPlanId: starterPlan.id,
      billingCycle: 'MONTHLY',
      startDate: today,
      endDate: null,
      nextBillingDate: nextBilling,
      status: 'ACTIVE',
      amountPaid: 0,
      autoRenewal: true,
      isTrial: false,
      trialEndsAt: null,
    },
  });

  await prisma.vendorSubscriptionHistory.create({
    data: {
      vendorSubscriptionId: sub.id,
      eventType: 'CREATED',
      newPlanId: starterPlan.id,
      performedByUserId: null,
    },
  });

  // 2 invoices: one PAID (last month), one PENDING (this month)
  const lastMonth = new Date(today);
  lastMonth.setMonth(lastMonth.getMonth() - 1);

  await prisma.subscriptionInvoice.createMany({
    data: [
      {
        vendorSubscriptionId: sub.id,
        vendorId,
        invoiceNumber: `INV-${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}-001`,
        amount: 0,
        tax: 0,
        totalAmount: 0,
        invoiceDate: lastMonth,
        dueDate: lastMonth,
        paymentStatus: 'PAID',
        paymentDate: lastMonth,
        paymentMethod: 'AUTO',
        paymentReference: 'seed-001',
      },
      {
        vendorSubscriptionId: sub.id,
        vendorId,
        invoiceNumber: `INV-${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-001`,
        amount: 0,
        tax: 0,
        totalAmount: 0,
        invoiceDate: today,
        dueDate: today,
        paymentStatus: 'PENDING',
      },
    ],
    skipDuplicates: true,
  });

  console.log(`✓ Dev vendor Starter subscription seeded (id=${sub.id.toString()})`);
}

/**
 * US-011: Seed VendorSettings with credit defaults + bulk op concurrency,
 * plus 3 sample BulkOperationLog rows for the dev vendor.
 */
async function seedUS011DevData(vendorId: bigint, userId: bigint): Promise<void> {
  // Upsert VendorSettings with US-011 fields
  await prisma.vendorSettings.upsert({
    where: { vendorId },
    update: {
      defaultCreditLimit: 2000,
      defaultCreditPeriodDays: 30,
      bulkOperationConcurrencyLimit: 50,
    },
    create: {
      vendorId,
      defaultCreditLimit: 2000,
      defaultCreditPeriodDays: 30,
      bulkOperationConcurrencyLimit: 50,
      autoSendBillsEnabled: false,
      autoSendBillsHour: 8,
      notificationPreferences: {},
    },
  });
  console.log('✓ Dev VendorSettings credit defaults seeded');

  // 3 sample bulk operation log rows (idempotent: skip if any already exist for this vendor)
  const existing = await prisma.bulkOperationLog.count({ where: { vendorId } });
  if (existing > 0) {
    console.log('✓ Dev BulkOperationLog rows already present — skipping');
    return;
  }

  const now = new Date();

  await prisma.bulkOperationLog.createMany({
    data: [
      {
        vendorId,
        performedByUserId: userId,
        operationType: 'MARK_LEAVE',
        targetType: 'ALL',
        targetId: null,
        status: 'COMPLETED',
        affectedCount: 12,
        metadata: { date: '2026-07-01', summary: { customersAffected: 12, skipped: 0 } },
        errorMessage: null,
        startedAt: new Date(now.getTime() - 60000),
        completedAt: now,
      },
      {
        vendorId,
        performedByUserId: userId,
        operationType: 'ADJUST_RATE',
        targetType: 'SUBSCRIPTION',
        targetId: null,
        status: 'COMPLETED',
        affectedCount: 8,
        metadata: { effectiveDate: '2026-07-01', summary: { listsAffected: 2, subscriptionsUpdated: 8 } },
        errorMessage: null,
        startedAt: new Date(now.getTime() - 120000),
        completedAt: new Date(now.getTime() - 115000),
      },
      {
        vendorId,
        performedByUserId: userId,
        operationType: 'SEND_REMINDERS',
        targetType: 'CUSTOMER',
        targetId: null,
        status: 'FAILED',
        affectedCount: 0,
        metadata: { summary: { sent: 0, failed: 3 } },
        errorMessage: 'Notification service unavailable',
        startedAt: new Date(now.getTime() - 180000),
        completedAt: new Date(now.getTime() - 178000),
      },
    ],
    skipDuplicates: true,
  });

  console.log('✓ Dev BulkOperationLog rows seeded (3 sample rows)');
}

seed()
  .catch((error) => {
    console.error('❌ Seed failed:', error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
