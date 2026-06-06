# Skill: Repository Implementation

> **Used by**: Dev Agent
> **When**: Implementing the data access layer for a module
> **Informed by**: [domain-driven-hexagon](https://github.com/Sairyss/domain-driven-hexagon), [clean-architecture](https://github.com/panagiop/node.js-clean-architecture), [open-saas](https://github.com/wasp-lang/open-saas)

You are implementing the repository layer for a PayCycle API module. Repositories abstract database operations behind a clean interface, following the DDD Repository pattern with Prisma as the underlying ORM. The repository implements a **port** (interface) defined in the application/domain layer, acting as an **adapter** in the hexagonal architecture.

---

## Core Principles

1. **Repositories return entities, not DTOs** — Transformation happens in the service/mapper layer
2. **Every method accepts optional `tx?: PrismaTransaction`** — For transaction support
3. **Soft delete is always enforced** — Every query filters `deletedAt: null` by default
4. **No business logic** — Only data access operations
5. **One repository per Aggregate Root** — Child entities are accessed through the root's repository
6. **Use Mapper for domain entity conversion** — When domain entities exist, use `mapper.toPersistence()` and `mapper.toDomain()` (from domain-driven-hexagon)
7. **Handle unique constraint violations** — Catch Prisma P2002 errors, throw ConflictError
8. **Focused update methods** — Prefer small, single-purpose update methods over generic ones (from open-saas)

---

## Repository Port Pattern (from domain-driven-hexagon)

For complex modules with domain entities, define a port (interface) in the domain/database layer:

```typescript
// src/modules/[module]/database/[entity].repository.port.ts

import { PrismaTransaction } from '@/infrastructure/database/prisma.client';

/**
 * Repository port — defines the contract that the infrastructure adapter must fulfill.
 * Services depend on this interface, not the concrete Prisma implementation.
 * This enables: dependency inversion, easy mocking in tests, swappable persistence.
 */
export interface [Entity]RepositoryPort {
  insert(entity: [Model], tx?: PrismaTransaction): Promise<[Model]>;
  findOneById(id: bigint, tx?: PrismaTransaction): Promise<[Model] | null>;
  findAll(params: FindAllParams, tx?: PrismaTransaction): Promise<[Model][]>;
  count(where?: WhereInput, tx?: PrismaTransaction): Promise<number>;
  update(id: bigint, data: UpdateInput, tx?: PrismaTransaction): Promise<[Model]>;
  softDelete(id: bigint, tx?: PrismaTransaction): Promise<[Model]>;
  exists(where: WhereInput, tx?: PrismaTransaction): Promise<boolean>;
}
```

### When to use a repository port
- Complex modules with domain entities (full DDD)
- When you need to mock the repository in unit tests
- When multiple implementations might exist (e.g., in-memory for testing)

### When to skip the port
- Simple CRUD modules — use the concrete repository class directly
- When the module has no domain logic worth isolating

---

## Mapper Integration (from domain-driven-hexagon)

For modules with domain entities, the repository uses a Mapper to translate between persistence and domain:

```typescript
// In repository with domain entities:
import { [Entity]Mapper } from '../[module].mapper';

export class [Model]Repository implements [Entity]RepositoryPort {
  constructor(private readonly mapper: [Entity]Mapper) {}

  async insert(entity: [Entity], tx?: PrismaTransaction): Promise<[Entity]> {
    const record = this.mapper.toPersistence(entity);
    const created = await this.getClient(tx).create({ data: record });
    return this.mapper.toDomain(created);
  }

  async findOneById(id: bigint, tx?: PrismaTransaction): Promise<[Entity] | null> {
    const record = await this.getClient(tx).findFirst({
      where: { id, deletedAt: null },
    });
    return record ? this.mapper.toDomain(record) : null;
  }
}
```

---

## Standard Repository Template

```typescript
import { Prisma, [Model] } from '@prisma/client';
import { prisma, PrismaTransaction } from '@/infrastructure/database/prisma.client';

export class [Model]Repository {
  /**
   * Get the Prisma delegate, using transaction client if provided
   */
  private getClient(tx?: PrismaTransaction) {
    return tx ? tx.[model] : prisma.[model];
  }

  // ============================================================
  // Single Record Operations
  // ============================================================

  /**
   * Find by ID, excluding soft-deleted records
   */
  async findById(id: bigint, tx?: PrismaTransaction): Promise<[Model] | null> {
    return this.getClient(tx).findFirst({
      where: { id, deletedAt: null },
    });
  }

  /**
   * Find by ID with related entities eagerly loaded
   * Use when the service needs related data
   */
  async findByIdWithRelations(
    id: bigint,
    include: Prisma.[Model]Include,
    tx?: PrismaTransaction,
  ): Promise<[Model] | null> {
    return this.getClient(tx).findFirst({
      where: { id, deletedAt: null },
      include,
    });
  }

  /**
   * Find a single record by unique field(s)
   */
  async findByField(
    field: string,
    value: unknown,
    tx?: PrismaTransaction,
  ): Promise<[Model] | null> {
    return this.getClient(tx).findFirst({
      where: { [field]: value, deletedAt: null },
    });
  }

  // ============================================================
  // List Operations
  // ============================================================

  /**
   * Find many with pagination, filtering, sorting
   * Called by service with parsed QueryBuilder output
   */
  async findMany(
    params: {
      where?: Prisma.[Model]WhereInput;
      orderBy?: Prisma.[Model]OrderByWithRelationInput | Prisma.[Model]OrderByWithRelationInput[];
      skip?: number;
      take?: number;
      select?: Prisma.[Model]Select;
      include?: Prisma.[Model]Include;
    },
    tx?: PrismaTransaction,
  ): Promise<[Model][]> {
    const { where, orderBy, skip, take, select, include } = params;
    return this.getClient(tx).findMany({
      where: { ...where, deletedAt: null },
      orderBy: orderBy ?? { createdAt: 'desc' },
      skip,
      take,
      ...(select ? { select } : {}),
      ...(include ? { include } : {}),
    }) as Promise<[Model][]>;
  }

  /**
   * Count records matching filter (for pagination meta)
   */
  async count(where?: Prisma.[Model]WhereInput, tx?: PrismaTransaction): Promise<number> {
    return this.getClient(tx).count({
      where: { ...where, deletedAt: null },
    });
  }

  // ============================================================
  // Write Operations
  // ============================================================

  /**
   * Find by ID, throwing if not found (from open-saas findUniqueOrThrow pattern)
   * Use for required lookups where null is not acceptable
   */
  async findByIdOrThrow(id: bigint, tx?: PrismaTransaction): Promise<[Model]> {
    return this.getClient(tx).findUniqueOrThrow({
      where: { id },
    });
  }

  /**
   * Create a single record
   * Catches unique constraint violations (P2002) and throws ConflictError
   */
  async create(data: Prisma.[Model]CreateInput, tx?: PrismaTransaction): Promise<[Model]> {
    try {
      return await this.getClient(tx).create({ data });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('Record already exists');
      }
      throw error;
    }
  }

  /**
   * Create multiple records (bulk insert)
   */
  async createMany(
    data: Prisma.[Model]CreateManyInput[],
    tx?: PrismaTransaction,
  ): Promise<{ count: number }> {
    return this.getClient(tx).createMany({
      data,
      skipDuplicates: true,
    });
  }

  /**
   * Update a single record by ID
   */
  async update(
    id: bigint,
    data: Prisma.[Model]UpdateInput,
    tx?: PrismaTransaction,
  ): Promise<[Model]> {
    return this.getClient(tx).update({
      where: { id },
      data: { ...data, updatedAt: new Date() },
    });
  }

  /**
   * Update multiple records matching a filter
   */
  async updateMany(
    where: Prisma.[Model]WhereInput,
    data: Prisma.[Model]UpdateManyMutationInput,
    tx?: PrismaTransaction,
  ): Promise<{ count: number }> {
    return this.getClient(tx).updateMany({
      where,
      data: { ...data, updatedAt: new Date() },
    });
  }

  // ============================================================
  // Delete Operations
  // ============================================================

  /**
   * Soft delete: set deletedAt timestamp
   */
  async softDelete(id: bigint, tx?: PrismaTransaction): Promise<[Model]> {
    return this.getClient(tx).update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * Soft delete multiple records
   */
  async softDeleteMany(
    where: Prisma.[Model]WhereInput,
    tx?: PrismaTransaction,
  ): Promise<{ count: number }> {
    return this.getClient(tx).updateMany({
      where,
      data: { deletedAt: new Date() },
    });
  }

  /**
   * Hard delete: permanent removal (use sparingly, admin-only)
   */
  async hardDelete(id: bigint, tx?: PrismaTransaction): Promise<[Model]> {
    return this.getClient(tx).delete({ where: { id } });
  }

  /**
   * Restore a soft-deleted record
   */
  async restore(id: bigint, tx?: PrismaTransaction): Promise<[Model]> {
    return this.getClient(tx).update({
      where: { id },
      data: { deletedAt: null },
    });
  }

  // ============================================================
  // Existence Checks
  // ============================================================

  /**
   * Check if a record exists (for uniqueness validation)
   */
  async exists(where: Prisma.[Model]WhereInput, tx?: PrismaTransaction): Promise<boolean> {
    const count = await this.getClient(tx).count({
      where: { ...where, deletedAt: null },
    });
    return count > 0;
  }
}
```

---

## Pattern: Aggregate Root Repository

When a module has child entities (e.g., PayCycle has PayCycleEmployees), the root repository handles child access:

```typescript
export class PayCycleRepository {
  // ... standard methods ...

  /**
   * Load aggregate root with all children
   */
  async findByIdWithEmployees(
    id: bigint,
    tx?: PrismaTransaction,
  ): Promise<PayCycleWithEmployees | null> {
    return this.getClient(tx).findFirst({
      where: { id, deletedAt: null },
      include: {
        employees: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
  }

  /**
   * Add employees to a pay cycle (child entity management)
   */
  async addEmployees(
    payCycleId: bigint,
    employeeIds: bigint[],
    tx?: PrismaTransaction,
  ): Promise<{ count: number }> {
    const data = employeeIds.map((employeeId) => ({
      payCycleId,
      employeeId,
    }));
    return (tx ?? prisma).payCycleEmployee.createMany({
      data,
      skipDuplicates: true,
    });
  }

  /**
   * Remove employee from pay cycle
   */
  async removeEmployee(
    payCycleId: bigint,
    employeeId: bigint,
    tx?: PrismaTransaction,
  ): Promise<void> {
    await (tx ?? prisma).payCycleEmployee.updateMany({
      where: { payCycleId, employeeId },
      data: { deletedAt: new Date() },
    });
  }
}
```

---

## Pattern: Multi-Tenant Filtering

For vendor-scoped resources, always filter by vendorId:

```typescript
async findManyForVendor(
  vendorId: bigint,
  params: {
    where?: Prisma.[Model]WhereInput;
    orderBy?: Prisma.[Model]OrderByWithRelationInput[];
    skip?: number;
    take?: number;
  },
  tx?: PrismaTransaction,
): Promise<[Model][]> {
  return this.getClient(tx).findMany({
    where: {
      ...params.where,
      vendorId,          // CRITICAL: tenant isolation
      deletedAt: null,
    },
    orderBy: params.orderBy ?? [{ createdAt: 'desc' }],
    skip: params.skip,
    take: params.take,
  });
}
```

---

## Pattern: Optimistic Concurrency

For entities where concurrent updates are possible:

```typescript
async updateWithVersion(
  id: bigint,
  data: Prisma.[Model]UpdateInput,
  expectedVersion: number,
  tx?: PrismaTransaction,
): Promise<[Model]> {
  const result = await this.getClient(tx).updateMany({
    where: { id, version: expectedVersion },
    data: { ...data, version: { increment: 1 } },
  });

  if (result.count === 0) {
    throw new ConflictError('Record was modified by another process');
  }

  return this.getClient(tx).findUniqueOrThrow({ where: { id } });
}
```

---

## Pattern: Focused Update Methods (from open-saas)

Instead of one generic `update()` for everything, prefer small, single-purpose update methods:

```typescript
// Good: focused, self-documenting methods
async updateSubscription(
  paymentProcessorUserId: string,
  data: { subscriptionStatus: string; paymentPlanId?: string; datePaid?: Date },
  tx?: PrismaTransaction,
): Promise<[Model]> {
  return this.getClient(tx).update({
    where: { paymentProcessorUserId },
    data: {
      subscriptionPlan: data.paymentPlanId,
      subscriptionStatus: data.subscriptionStatus,
      datePaid: data.datePaid,
    },
  });
}

async updateCredits(
  paymentProcessorUserId: string,
  numOfCredits: number,
  tx?: PrismaTransaction,
): Promise<[Model]> {
  return this.getClient(tx).update({
    where: { paymentProcessorUserId },
    data: {
      credits: { increment: numOfCredits },  // Atomic increment
      datePaid: new Date(),
    },
  });
}
```

---

## Rules

1. **Always filter `deletedAt: null`** — In every read query
2. **Always accept `tx?: PrismaTransaction`** — On every method
3. **Never transform data in simple repos** — Return raw Prisma entities (or use Mapper for domain entities)
4. **Never throw business errors** — Only throw ConflictError (unique violations) or data-access errors
5. **Use `findFirst` over `findUnique`** — When combining with `deletedAt` filter
6. **Default sort** — `createdAt: 'desc'` when no orderBy specified
7. **One repository per Aggregate Root** — Child entities accessed through root repository
8. **Keep methods focused** — Each method does one query, no multi-step logic
9. **Catch P2002 unique constraint violations** — Throw ConflictError with meaningful message
10. **Use Mapper for domain entities** — `toPersistence()` before save, `toDomain()` after read
11. **Use `findUniqueOrThrow`** — For required lookups where null is unacceptable
12. **Prefer focused update methods** — Small, single-purpose over generic `update(id, data)` (from open-saas)
