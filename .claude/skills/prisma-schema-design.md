# Skill: Prisma Schema Design

> **Used by**: Architect Agent (design), Dev Agent (implementation)
> **When**: Creating or modifying database models for a new feature
> **Informed by**: [domain-driven-hexagon](https://github.com/Sairyss/domain-driven-hexagon), [clean-architecture](https://github.com/panagiop/node.js-clean-architecture), [open-saas](https://github.com/wasp-lang/open-saas)

You are designing/implementing Prisma database schemas for the PayCycle API. Follow these patterns to ensure consistency, performance, and DDD alignment.

---

## Step 1: Model Design from Domain Entities

Map each DDD Entity to a Prisma model. Map Value Objects to either embedded fields or separate tables. Respect **Aggregate Root boundaries** — cross-aggregate references use ID only, never object relations.

### Model Template

```prisma
model [EntityName] {
  // === Identity ===
  id        BigInt   @id @default(autoincrement())

  // === Core Fields ===
  name      String   @db.VarChar(100)
  status    [EntityName]Status @default(ACTIVE)
  
  // === Foreign Keys (references to other Aggregate Roots by ID) ===
  vendorId  BigInt   @map("vendor_id")
  createdBy BigInt   @map("created_by")

  // === Timestamps ===
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")
  deletedAt DateTime? @map("deleted_at")

  // === Relations ===
  vendor    Vendor   @relation(fields: [vendorId], references: [id], onDelete: Cascade)
  creator   User     @relation("CreatedBy", fields: [createdBy], references: [id], onDelete: SetNull)

  // === Indexes ===
  @@index([vendorId])
  @@index([status])
  @@index([createdAt])
  @@index([deletedAt])

  // === Table Mapping ===
  @@map("entity_names")
}
```

### Aggregate Root Boundary Rules (from domain-driven-hexagon)

```
CORRECT:
  PayCycle -> payCycleId references Employee aggregate by ID only
  PayCycle owns PayCycleEmployee (child entity within aggregate)

INCORRECT:
  PayCycle -> employee: Employee @relation(...)  // Cross-aggregate object reference
```

- **Within an aggregate**: Use Prisma relations (parent owns children)
- **Between aggregates**: Use only ID references (BigInt FK), no Prisma `@relation`
- **Exception**: Read-only relations for query convenience are acceptable if clearly documented

### Naming Conventions (CRITICAL)

| Concern            | Convention                    | Example                        |
|-------------------|-------------------------------|--------------------------------|
| Model name        | PascalCase, singular          | `PayCycle`, `VendorUser`       |
| Field name (TS)   | camelCase                     | `vendorId`, `createdAt`        |
| Column name (DB)  | snake_case via `@map()`       | `vendor_id`, `created_at`      |
| Table name (DB)   | snake_case plural via `@@map` | `pay_cycles`, `vendor_users`   |
| Enum name         | PascalCase                    | `PayCycleStatus`               |
| Enum values       | UPPER_SNAKE_CASE              | `ACTIVE`, `IN_PROGRESS`        |
| FK field          | camelCase + `Id` suffix       | `vendorId`, `userId`           |
| Relation name     | PascalCase descriptive        | `@relation("CreatedBy")`       |

---

## Step 2: Enum Design

```prisma
enum [EntityName]Status {
  ACTIVE
  INACTIVE
  ARCHIVED
  
  @@map("entity_name_status")
}
```

Rules:
- One enum per concept (don't reuse enums across unrelated models)
- Use `@@map()` for DB-level enum names
- Always provide a default value in the model
- Keep enum values to UPPER_SNAKE_CASE
- Use `z.nativeEnum()` in Zod validators for type-safe validation against Prisma enums (from open-saas)

---

## Step 3: Relationship Patterns

### One-to-Many (Most Common)

```prisma
// Parent (One side)
model Vendor {
  id    BigInt @id @default(autoincrement())
  users User[]
  @@map("vendors")
}

// Child (Many side)
model User {
  id       BigInt @id @default(autoincrement())
  vendorId BigInt @map("vendor_id")
  vendor   Vendor @relation(fields: [vendorId], references: [id], onDelete: Cascade)
  
  @@index([vendorId])
  @@map("users")
}
```

### Many-to-Many (Explicit Join Table)

```prisma
// Explicit join table (preferred over implicit)
model RolePermission {
  id           BigInt     @id @default(autoincrement())
  roleId       BigInt     @map("role_id")
  permissionId BigInt     @map("permission_id")
  
  role         Role       @relation(fields: [roleId], references: [id], onDelete: Cascade)
  permission   Permission @relation(fields: [permissionId], references: [id], onDelete: Cascade)
  
  @@unique([roleId, permissionId])
  @@index([roleId])
  @@index([permissionId])
  @@map("role_permissions")
}
```

### Self-Referencing

```prisma
model Category {
  id       BigInt     @id @default(autoincrement())
  parentId BigInt?    @map("parent_id")
  parent   Category?  @relation("CategoryHierarchy", fields: [parentId], references: [id])
  children Category[] @relation("CategoryHierarchy")
  
  @@index([parentId])
  @@map("categories")
}
```

---

## Step 4: Value Object Patterns

### Embedded Value Object (Flattened Fields)

For simple Value Objects, flatten into the parent model:

```prisma
model Employee {
  id              BigInt  @id @default(autoincrement())
  // Address Value Object (embedded)
  addressStreet   String? @map("address_street") @db.VarChar(200)
  addressCity     String? @map("address_city") @db.VarChar(100)
  addressState    String? @map("address_state") @db.VarChar(50)
  addressZipCode  String? @map("address_zip_code") @db.VarChar(20)
  addressCountry  String? @map("address_country") @db.VarChar(50)
  
  // Money Value Object (embedded)
  salaryAmount    Decimal? @map("salary_amount") @db.Decimal(12, 2)
  salaryCurrency  String?  @map("salary_currency") @db.VarChar(3) @default("USD")
  
  @@map("employees")
}
```

### Separate Table Value Object

For complex or reusable Value Objects:

```prisma
model Address {
  id       BigInt  @id @default(autoincrement())
  street   String  @db.VarChar(200)
  city     String  @db.VarChar(100)
  state    String  @db.VarChar(50)
  zipCode  String  @map("zip_code") @db.VarChar(20)
  country  String  @db.VarChar(50) @default("US")
  
  @@map("addresses")
}
```

---

## Step 5: Domain Event Table (from domain-driven-hexagon)

For modules using domain events, consider persisting events for audit/replay:

```prisma
model DomainEvent {
  id            BigInt   @id @default(autoincrement())
  aggregateId   BigInt   @map("aggregate_id")
  aggregateType String   @map("aggregate_type") @db.VarChar(100)
  eventType     String   @map("event_type") @db.VarChar(100)
  payload       Json
  metadata      Json     // { correlationId, causationId, userId, timestamp }
  createdAt     DateTime @default(now()) @map("created_at")

  @@index([aggregateId, aggregateType])
  @@index([eventType])
  @@index([createdAt])
  @@map("domain_events")
}
```

---

## Step 6: Index Strategy

### Index Decision Matrix

| Query Pattern                     | Index Type        | Prisma Syntax                          |
|----------------------------------|-------------------|----------------------------------------|
| Filter by single field           | Single column     | `@@index([field])`                     |
| Filter by FK (always)           | Single column     | `@@index([foreignKeyId])`              |
| Filter by two fields together   | Composite         | `@@index([field1, field2])`            |
| Unique constraint                | Unique            | `@@unique([field1, field2])`           |
| Soft delete filter (always)     | Single column     | `@@index([deletedAt])`                 |
| Sort by timestamp                | Single column     | `@@index([createdAt])`                 |
| Search by text                   | GIN (manual SQL)  | Raw migration with `CREATE INDEX ... USING gin` |
| Multi-tenant + filter           | Composite         | `@@index([vendorId, status])`          |

### Mandatory Indexes

Every model MUST have:
1. `@@index([deletedAt])` — For soft delete filtering
2. `@@index([createdAt])` — For sorting
3. `@@index([foreignKeyId])` — For every foreign key
4. `@@index([vendorId])` — For multi-tenant filtering (if applicable)

### Composite Index for Common Queries

```prisma
// If the app frequently queries "active users for a vendor"
@@index([vendorId, status, deletedAt])
```

---

## Step 7: Migration Workflow

### Creating a Migration

```bash
# 1. Edit prisma/schema.prisma
# 2. Create migration (generates SQL)
npm run migrate:create -- --name [descriptive_name]

# 3. Review generated SQL in prisma/migrations/[timestamp]_[name]/migration.sql
# 4. Apply migration
npm run migrate:deploy

# 5. Regenerate Prisma client
npm run db:generate
```

### Migration Naming Convention

```
[timestamp]_[action]_[entity]_[detail]

Examples:
20260601120000_create_pay_cycle_table
20260601130000_add_status_to_pay_cycle
20260601140000_create_pay_cycle_employee_junction
20260601150000_add_index_vendor_status_to_pay_cycle
20260601160000_create_domain_events_table
```

### Safe Migration Rules

1. **Never drop columns in production** — Mark as deprecated, remove in next major version
2. **Add columns as nullable first** — Then backfill, then add NOT NULL constraint
3. **Never rename columns directly** — Create new, migrate data, drop old
4. **Always review generated SQL** — Prisma may generate unexpected operations
5. **Test migrations on a copy of production data** — Before deploying

---

## Step 8: Seed Data

### Permission Seeds

Add required seed data for new models in `prisma/seeds/index.ts`:

```typescript
// Add permissions for new resource
const permissions = [
  { name: 'resource:create', description: 'Create [resource]' },
  { name: 'resource:read', description: 'Read [resource]' },
  { name: 'resource:update', description: 'Update [resource]' },
  { name: 'resource:delete', description: 'Delete [resource]' },
];

// Assign to admin role
for (const perm of permissions) {
  await prisma.permission.upsert({
    where: { name: perm.name },
    update: {},
    create: perm,
  });
}
```

### Development Seeds with Faker (from open-saas)

For development/testing environments, generate realistic seed data:

```typescript
import { faker } from '@faker-js/faker';

// Generate development seed data
async function seedDevelopmentData() {
  const vendorId = BigInt(1);

  // Create N realistic records
  for (let i = 0; i < 50; i++) {
    await prisma.[model].create({
      data: {
        name: faker.company.name(),
        description: faker.lorem.sentence(),
        status: faker.helpers.arrayElement(['ACTIVE', 'INACTIVE']),
        vendorId,
        createdById: BigInt(1),
        email: faker.internet.email(),
        phone: faker.phone.number('+1##########'),
        // Embedded value objects
        addressStreet: faker.location.streetAddress(),
        addressCity: faker.location.city(),
        addressState: faker.location.state({ abbreviated: true }),
        addressZipCode: faker.location.zipCode(),
        addressCountry: 'US',
        // Money value objects
        salaryAmount: faker.number.float({ min: 30000, max: 150000, fractionDigits: 2 }),
        salaryCurrency: 'USD',
      },
    });
  }
}

// Only run in development
if (process.env.NODE_ENV !== 'production') {
  await seedDevelopmentData();
}
```

---

## Step 9: Type-Safe Prisma Patterns (from open-saas)

### Prisma Delegate Pattern

For focused repository methods that operate on a specific model:

```typescript
// Type-safe delegate reference
type PrismaUserDelegate = PrismaClient['user'];

// Use in repository for focused update methods
async updateSubscription(
  paymentProcessorUserId: string,
  data: SubscriptionUpdate,
): Promise<User> {
  return prisma.user.update({
    where: { paymentProcessorUserId },
    data: {
      subscriptionPlan: data.planId,
      subscriptionStatus: data.status,
      datePaid: data.datePaid,
    },
  });
}
```

### Atomic Operations

```typescript
// Atomic increment — no race conditions
await prisma.user.update({
  where: { id: userId },
  data: {
    credits: { increment: numOfCredits },
    datePaid: new Date(),
  },
});
```

---

## Design Checklist

- [ ] All models have BigInt autoincrement ID
- [ ] All fields use camelCase in TypeScript, snake_case in DB via `@map()`
- [ ] All tables use snake_case plural via `@@map()`
- [ ] All models have `createdAt`, `updatedAt`, `deletedAt` timestamps
- [ ] All foreign keys have `@@index()`
- [ ] All enums have `@@map()` with snake_case name
- [ ] Soft delete (`deletedAt`) is present on all deletable models
- [ ] `onDelete` policy is set for all relations (Cascade or SetNull)
- [ ] Composite indexes exist for common multi-field queries
- [ ] Value Objects are properly embedded or separated
- [ ] Migration is reviewed for safety
- [ ] Seed data includes permissions for new resources
- [ ] No cross-aggregate object references (only ID references) (from domain-driven-hexagon)
- [ ] Aggregate root boundaries respected — children owned, peers referenced by ID
- [ ] Domain event table exists if module uses domain events (from domain-driven-hexagon)
- [ ] Development seeds use faker for realistic data (from open-saas)
- [ ] Prisma enums have corresponding `z.nativeEnum()` validators (from open-saas)
- [ ] Atomic operations used for counters/credits (no race conditions)
