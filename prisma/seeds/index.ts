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

  // 4. Assign read-only subset to vendor_staff
  const staffPermissionNames = [
    'delivery:read', 'delivery:write',
    'leave:read', 'leave:write',
    'customer:read',
    'billing:read',
    'payment:read',
    'extra_charge:read',
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
  }

  console.log('✅ Seeding complete!');
}

seed()
  .catch((error) => {
    console.error('❌ Seed failed:', error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
