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
];

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

    const testVendor = await prisma.vendor.create({
      data: { name: 'Test Vendor' },
    });

    await prisma.vendorUser.upsert({
      where: { vendorId_userId: { vendorId: testVendor.id, userId: testUser.id } },
      update: {},
      create: {
        vendorId: testVendor.id,
        userId: testUser.id,
        roleId: vendorOwnerRole.id,
        status: 'ACTIVE',
        joinedAt: new Date(),
      },
    });

    console.log('✓ Dev test user seeded: +919000000001 / Test@123');
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
