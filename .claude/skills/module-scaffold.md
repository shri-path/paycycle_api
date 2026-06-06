# Skill: Module Scaffold

> **Used by**: Dev Agent
> **When**: Creating a new feature module from the architect's FEATURE_PLAN.md
> **Informed by**: [domain-driven-hexagon](https://github.com/Sairyss/domain-driven-hexagon), [clean-architecture](https://github.com/panagiop/node.js-clean-architecture), [open-saas](https://github.com/wasp-lang/open-saas)

You are scaffolding a new module for the PayCycle API. Follow this skill step-by-step to produce a complete, production-ready module that follows DDD principles and clean architecture.

---

## Step 0: Assess Module Complexity

Before scaffolding, determine the module's complexity tier to decide which patterns to apply:

| Tier | Criteria | Structure | Examples |
|------|----------|-----------|----------|
| **Simple** | Pure CRUD, no domain logic, no cross-module effects | Flat module (6 files) | Settings, Tags, Categories |
| **Moderate** | Some business rules, state transitions, validation beyond Zod | Flat module + domain types | Employees, Departments |
| **Complex** | Rich domain logic, aggregate roots, domain events, cross-module effects | Vertical slices + domain layer | PayCycles, Orders, Payments |

### Simple Module Structure
```
src/modules/[module]/
├── [module].types.ts
├── [module].validator.ts
├── [module].repository.ts
├── [module].service.ts
├── [module].controller.ts
├── [module].routes.ts
└── __tests__/
    └── [module].service.test.ts
```

### Complex Module Structure (from domain-driven-hexagon)
```
src/modules/[module]/
├── domain/                              # Domain layer
│   ├── [entity].entity.ts              # Entity with factory + invariants
│   ├── [entity].types.ts               # Domain types (Props, CreateProps)
│   ├── value-objects/                   # Value Objects
│   │   └── [name].value-object.ts
│   └── events/                         # Domain Events
│       └── [entity]-created.domain-event.ts
├── database/                            # Infrastructure layer
│   ├── [entity].repository.ts          # Concrete Prisma repository
│   └── [entity].repository.port.ts     # Repository interface (port)
├── commands/                            # Command handlers (vertical slices)
│   ├── create-[entity]/
│   │   ├── create-[entity].service.ts
│   │   └── create-[entity].http.controller.ts
│   └── update-[entity]/
│       └── ...
├── queries/                             # Query handlers (vertical slices)
│   └── get-[entity]/
│       └── ...
├── [module].mapper.ts                   # Mapper: domain <-> persistence <-> response
├── [module].routes.ts                   # Route definitions + dependency wiring
├── [module].validator.ts                # Zod schemas
├── [module].types.ts                    # DTOs
└── __tests__/
    ├── [module].service.test.ts
    └── domain/
        ├── [entity].entity.test.ts
        └── [value-object].vo.test.ts
```

---

## Prerequisites

Before starting, ensure you have:
1. Read `docs/features/[feature-name]/FEATURE_PLAN.md` for the full design
2. Read `docs/features/[feature-name]/FEATURE_TASKS.md` for ordered tasks
3. Read `docs/features/[feature-name]/DOMAIN_MODEL.md` for DDD model (if exists)
4. Reviewed the reference implementation: `src/modules/user/`
5. Assessed module complexity (Step 0 above)

---

## Step 1: Database Schema (Prisma)

Follow the **prisma-schema-design** skill for detailed patterns.

```bash
# 1. Add model to prisma/schema.prisma
# 2. Create and apply migration
npm run migrate:create -- --name create_[module]_table
npm run migrate:deploy
npm run db:generate
```

---

## Step 2: Types & DTOs (`src/modules/[module]/[module].types.ts`)

Define the module's type system. This is the contract between layers.

```typescript
/**
 * [Module] module type definitions
 * 
 * Follows DDD patterns:
 * - Input DTOs: What comes in from HTTP requests
 * - Output DTOs: What goes out in HTTP responses (extends ResponseBase)
 * - Domain types: Internal representations (if complex domain logic exists)
 */

import { [Model] } from '@prisma/client';

// ============================================================
// Response Base (from domain-driven-hexagon)
// ============================================================

interface ResponseBase {
  id: string;
  createdAt: string;  // ISO 8601
  updatedAt: string;  // ISO 8601
}

// ============================================================
// Input DTOs (from HTTP -> Service)
// ============================================================

export interface Create[Model]Input {
  name: string;
  description?: string;
  vendorId: bigint;
  // ... required fields from FEATURE_PLAN
}

export interface Update[Model]Input {
  name?: string;
  description?: string;
  // ... all fields optional for partial update
}

// ============================================================
// Output DTOs (from Service -> HTTP) — extends ResponseBase
// ============================================================

export interface [Model]Dto extends ResponseBase {
  name: string;
  description: string | null;
  status: string;
  vendorId: string;
  // NEVER include: deletedAt, passwordHash, internal fields
}

export interface [Model]ListDto {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  // Subset of fields for list responses
}

// ============================================================
// Transformer Functions (whitelist pattern from domain-driven-hexagon)
// ============================================================

/**
 * Transform Prisma entity to output DTO
 * Handles BigInt -> string serialization and field filtering
 * Uses WHITELIST approach — explicitly include fields, never spread raw entities
 */
export function to[Model]Dto(entity: [Model]): [Model]Dto {
  return {
    id: entity.id.toString(),
    name: entity.name,
    description: entity.description,
    status: entity.status,
    vendorId: entity.vendorId.toString(),
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

export function to[Model]ListDto(entity: [Model]): [Model]ListDto {
  return {
    id: entity.id.toString(),
    name: entity.name,
    status: entity.status,
    createdAt: entity.createdAt.toISOString(),
  };
}
```

### Type Rules
- Input types use domain-appropriate types (bigint for IDs, string for text)
- Output DTOs extend ResponseBase (id, createdAt, updatedAt) and serialize BigInt to string
- Dates serialize to ISO 8601 strings
- Never expose internal/sensitive fields in output DTOs
- Transformer functions use **whitelist** — explicitly list fields, never spread entity
- Transformer functions are pure functions, no side effects

---

## Step 3: Mapper (`src/modules/[module]/[module].mapper.ts`) — Complex Modules Only

For complex modules with domain entities, implement the three-way Mapper (from domain-driven-hexagon):

```typescript
import { [Model] as [Model]Record } from '@prisma/client';
import { [Entity] } from './domain/[entity].entity';
import { [Model]Dto } from './[module].types';

export class [Entity]Mapper {
  /**
   * Domain entity -> Prisma persistence format
   */
  toPersistence(entity: [Entity]): [Model]Record {
    const props = entity.getProps();
    return {
      id: props.id,
      name: props.name,
      status: props.status,
      vendorId: props.vendorId,
      createdAt: props.createdAt,
      updatedAt: props.updatedAt,
      deletedAt: props.deletedAt ?? null,
    };
  }

  /**
   * Prisma record -> Domain entity
   */
  toDomain(record: [Model]Record): [Entity] {
    return new [Entity]({
      id: record.id,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      props: {
        name: record.name,
        status: record.status,
        vendorId: record.vendorId,
      },
    });
  }

  /**
   * Domain entity -> HTTP response DTO (whitelist fields)
   */
  toResponse(entity: [Entity]): [Model]Dto {
    const props = entity.getProps();
    return {
      id: props.id.toString(),
      name: props.name,
      status: props.status,
      vendorId: props.vendorId.toString(),
      createdAt: props.createdAt.toISOString(),
      updatedAt: props.updatedAt.toISOString(),
    };
  }
}
```

---

## Step 4: Validators (`src/modules/[module]/[module].validator.ts`)

Follow the **validation-schemas** skill for detailed patterns.

```typescript
import { z } from 'zod';

// Reusable field schemas
const nameSchema = z.string().min(1, 'Name is required').max(100, 'Name too long').trim();
const idParamSchema = z.string().regex(/^\d+$/, 'Invalid ID format');

// === Create Schema ===
export const create[Model]Schema = z.object({
  name: nameSchema,
  description: z.string().max(500).trim().optional(),
  // ... fields from FEATURE_PLAN
}).strict();

export type Create[Model]Input = z.infer<typeof create[Model]Schema>;

// === Update Schema ===
export const update[Model]Schema = z.object({
  name: nameSchema.optional(),
  description: z.string().max(500).trim().optional(),
}).strict();

export type Update[Model]Input = z.infer<typeof update[Model]Schema>;

// === Params Schema ===
export const [model]ParamsSchema = z.object({
  id: idParamSchema,
});

// === Query Schema ===
export const [model]QuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  // Standard query builder params handled by QueryBuilder
}).passthrough(); // Allow query builder params through
```

---

## Step 5: Repository (`src/modules/[module]/[module].repository.ts`)

Follow the **repository-implementation** skill for detailed patterns.

```typescript
import { Prisma, [Model] } from '@prisma/client';
import { prisma, PrismaTransaction } from '@/infrastructure/database/prisma.client';
import { ConflictError } from '@/common/errors/app-error';

export class [Model]Repository {
  private get db() {
    return prisma.[model];
  }

  private getClient(tx?: PrismaTransaction) {
    return tx ? tx.[model] : this.db;
  }

  async findById(id: bigint, tx?: PrismaTransaction): Promise<[Model] | null> {
    return this.getClient(tx).findFirst({
      where: { id, deletedAt: null },
    });
  }

  async findMany(
    params: {
      where?: Prisma.[Model]WhereInput;
      orderBy?: Prisma.[Model]OrderByWithRelationInput | Prisma.[Model]OrderByWithRelationInput[];
      skip?: number;
      take?: number;
      select?: Prisma.[Model]Select;
    },
    tx?: PrismaTransaction,
  ): Promise<[Model][]> {
    return this.getClient(tx).findMany({
      where: { ...params.where, deletedAt: null },
      orderBy: params.orderBy ?? { createdAt: 'desc' },
      skip: params.skip,
      take: params.take,
      select: params.select as any,
    });
  }

  async count(where?: Prisma.[Model]WhereInput, tx?: PrismaTransaction): Promise<number> {
    return this.getClient(tx).count({
      where: { ...where, deletedAt: null },
    });
  }

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

  async update(id: bigint, data: Prisma.[Model]UpdateInput, tx?: PrismaTransaction): Promise<[Model]> {
    return this.getClient(tx).update({
      where: { id },
      data: { ...data, updatedAt: new Date() },
    });
  }

  async softDelete(id: bigint, tx?: PrismaTransaction): Promise<[Model]> {
    return this.getClient(tx).update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async hardDelete(id: bigint, tx?: PrismaTransaction): Promise<[Model]> {
    return this.getClient(tx).delete({
      where: { id },
    });
  }

  async exists(where: Prisma.[Model]WhereInput, tx?: PrismaTransaction): Promise<boolean> {
    const count = await this.getClient(tx).count({
      where: { ...where, deletedAt: null },
    });
    return count > 0;
  }
}
```

---

## Step 6: Service (`src/modules/[module]/[module].service.ts`)

Follow the **service-implementation** skill for detailed patterns.

```typescript
import { Logger } from 'pino';
import { [Model]Repository } from './[model].repository';
import { Create[Model]Input, Update[Model]Input, [Model]Dto, to[Model]Dto } from './[model].types';
import { NotFoundError, ConflictError } from '@/common/errors/app-error';
import { QueryBuilder } from '@/common/api-wrapper/query-builder';
import { ListQueryParams, PaginationMeta } from '@/common/api-wrapper/types';
import { calculatePaginationMeta } from '@/common/api-wrapper/response.util';
import { prisma } from '@/infrastructure/database/prisma.client';

export class [Model]Service {
  // Allowed fields for query builder
  private readonly allowedFields = {
    filter: ['status', 'vendorId', 'createdAt'],
    sort: ['name', 'createdAt', 'updatedAt'],
    search: ['name', 'description'],
    select: ['id', 'name', 'description', 'status', 'createdAt'],
  };

  constructor(
    private readonly repository: [Model]Repository,
    private readonly logger: Logger,
  ) {}

  async create(input: Create[Model]Input, vendorId: bigint, userId: bigint): Promise<[Model]Dto> {
    this.logger.info({ input }, 'Creating [model]');

    // Business rule checks (e.g., uniqueness)
    const exists = await this.repository.exists({ name: input.name, vendorId });
    if (exists) {
      throw new ConflictError('[Model] with this name already exists');
    }

    const entity = await this.repository.create({
      name: input.name,
      description: input.description,
      vendor: { connect: { id: vendorId } },
      createdBy: { connect: { id: userId } },
    });

    this.logger.info({ id: entity.id.toString() }, '[Model] created');
    return to[Model]Dto(entity);
  }

  async getById(id: bigint, vendorId?: bigint): Promise<[Model]Dto> {
    const entity = await this.repository.findById(id);
    if (!entity) {
      throw new NotFoundError('[Model] not found');
    }
    // Multi-tenant isolation
    if (vendorId && entity.vendorId !== vendorId) {
      throw new NotFoundError('[Model] not found');
    }
    return to[Model]Dto(entity);
  }

  async list(
    queryParams: ListQueryParams,
    vendorId?: bigint,
  ): Promise<{ data: [Model]Dto[]; meta: PaginationMeta }> {
    const parsedQuery = QueryBuilder.parseListQuery(queryParams, this.allowedFields);
    const where = { ...parsedQuery.where, ...(vendorId ? { vendorId } : {}) };

    const [items, total] = await Promise.all([
      this.repository.findMany({
        where,
        orderBy: parsedQuery.orderBy,
        skip: parsedQuery.skip,
        take: parsedQuery.take,
      }),
      this.repository.count(where),
    ]);

    return {
      data: items.map(to[Model]Dto),
      meta: calculatePaginationMeta(total, parsedQuery.page, parsedQuery.limit),
    };
  }

  async update(id: bigint, input: Update[Model]Input, vendorId?: bigint): Promise<[Model]Dto> {
    const existing = await this.repository.findById(id);
    if (!existing) throw new NotFoundError('[Model] not found');
    if (vendorId && existing.vendorId !== vendorId) throw new NotFoundError('[Model] not found');

    const updated = await this.repository.update(id, input);
    this.logger.info({ id: id.toString() }, '[Model] updated');
    return to[Model]Dto(updated);
  }

  async delete(id: bigint, hard = false, vendorId?: bigint): Promise<void> {
    const existing = await this.repository.findById(id);
    if (!existing) throw new NotFoundError('[Model] not found');
    if (vendorId && existing.vendorId !== vendorId) throw new NotFoundError('[Model] not found');

    if (hard) {
      await this.repository.hardDelete(id);
      this.logger.warn({ id: id.toString() }, '[Model] hard deleted');
    } else {
      await this.repository.softDelete(id);
      this.logger.info({ id: id.toString() }, '[Model] soft deleted');
    }
  }
}
```

---

## Step 7: Controller (`src/modules/[module]/[module].controller.ts`)

```typescript
import { Request, Response, NextFunction } from 'express';
import { [Model]Service } from './[model].service';
import { sendSuccess, sendCreated, sendListResponse, sendNoContent } from '@/common/api-wrapper/response.util';

export class [Model]Controller {
  constructor(private readonly service: [Model]Service) {}

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.create(
        req.body,
        BigInt(req.user!.vendorId),
        BigInt(req.user!.id),
      );
      sendCreated(res, result);
    } catch (error) {
      next(error);
    }
  };

  getById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.getById(
        BigInt(req.params.id),
        BigInt(req.user!.vendorId),
      );
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { data, meta } = await this.service.list(
        req.query as any,
        BigInt(req.user!.vendorId),
      );
      sendListResponse(res, data, meta);
    } catch (error) {
      next(error);
    }
  };

  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.update(
        BigInt(req.params.id),
        req.body,
        BigInt(req.user!.vendorId),
      );
      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  };

  delete = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const hard = req.query.hard === 'true';
      await this.service.delete(
        BigInt(req.params.id),
        hard,
        BigInt(req.user!.vendorId),
      );
      sendNoContent(res);
    } catch (error) {
      next(error);
    }
  };
}
```

### Controller Rules
- **Arrow functions** for methods (proper `this` binding)
- **Extract -> Delegate -> Respond** pattern (3 lines per method ideally)
- **Always wrap in try/catch**, pass errors to `next(error)`
- **No business logic** — only extract request data, call service, format response
- **No direct imports** of repository or database
- **Always pass vendorId** from JWT claims for multi-tenant isolation

---

## Step 8: Routes (`src/modules/[module]/[module].routes.ts`)

Routes act as the **Composition Root** (from clean-architecture) — wire all dependencies here:

```typescript
import { Router } from 'express';
import { [Model]Controller } from './[model].controller';
import { [Model]Service } from './[model].service';
import { [Model]Repository } from './[model].repository';
import { authenticate } from '@/infrastructure/middlewares/authenticate';
import { authorize } from '@/infrastructure/middlewares/authorize';
import { validate } from '@/infrastructure/middlewares/validate';
import { create[Model]Schema, update[Model]Schema, [model]ParamsSchema, [model]QuerySchema } from './[model].validator';
import { logger } from '@/infrastructure/logger/logger';

const router = Router();

// === Composition Root: Wire all dependencies (from clean-architecture) ===
const repository = new [Model]Repository();
const service = new [Model]Service(repository, logger);
const controller = new [Model]Controller(service);

// === Middleware chain order: authenticate -> authorize -> validate -> controller ===

// List
router.get(
  '/',
  authenticate,
  authorize(['[model]:read']),
  validate([model]QuerySchema, 'query'),
  controller.list,
);

// Get by ID
router.get(
  '/:id',
  authenticate,
  authorize(['[model]:read']),
  validate([model]ParamsSchema, 'params'),
  controller.getById,
);

// Create
router.post(
  '/',
  authenticate,
  authorize(['[model]:create']),
  validate(create[Model]Schema, 'body'),
  controller.create,
);

// Update
router.patch(
  '/:id',
  authenticate,
  authorize(['[model]:update']),
  validate([model]ParamsSchema, 'params'),
  validate(update[Model]Schema, 'body'),
  controller.update,
);

// Delete (soft by default, hard with ?hard=true)
router.delete(
  '/:id',
  authenticate,
  authorize(['[model]:delete']),
  validate([model]ParamsSchema, 'params'),
  controller.delete,
);

export default router;
```

---

## Step 9: Register Routes (`src/app.ts`)

Add the new module's routes to the Express app:

```typescript
import [model]Routes from '@/modules/[model]/[model].routes';

// In the route registration section:
app.use(`${apiPrefix}/[models]`, [model]Routes);
```

---

## Step 10: Seed Permissions (`prisma/seeds/index.ts`)

```typescript
// [Model] permissions
const [model]Permissions = [
  { name: '[model]:create', description: 'Create [model]' },
  { name: '[model]:read', description: 'Read [model]' },
  { name: '[model]:update', description: 'Update [model]' },
  { name: '[model]:delete', description: 'Delete [model]' },
];

for (const perm of [model]Permissions) {
  await prisma.permission.upsert({
    where: { name: perm.name },
    update: {},
    create: perm,
  });
}
```

---

## Step 11: Verification

After scaffolding, verify:

```bash
# 1. TypeScript compiles
npm run build

# 2. Linting passes
npm run lint

# 3. Server starts
npm run dev

# 4. Swagger docs render
# Visit http://localhost:3000/api-docs

# 5. Tests pass (if written)
npm test
```

---

## File Checklist

### Simple Module
```
src/modules/[module]/
├── [module].types.ts        -- DTOs + transformer functions (whitelist)
├── [module].validator.ts    -- Zod schemas for all inputs
├── [module].repository.ts   -- Data access layer (with P2002 handling)
├── [module].service.ts      -- Business logic (CQS classified)
├── [module].controller.ts   -- HTTP handlers (extract-delegate-respond)
├── [module].routes.ts       -- Route definitions + composition root
└── __tests__/
    └── [module].service.test.ts  -- Unit tests
```

### Complex Module (additional files)
```
src/modules/[module]/
├── domain/
│   ├── [entity].entity.ts          -- Entity with factory + invariants
│   ├── [entity].types.ts           -- Domain types
│   ├── value-objects/               -- Value Objects with Guard validation
│   └── events/                     -- Domain Events with metadata
├── database/
│   ├── [entity].repository.ts      -- Concrete repository
│   └── [entity].repository.port.ts -- Repository interface (port)
├── commands/                        -- Command handlers (vertical slices)
├── queries/                         -- Query handlers (vertical slices)
├── [module].mapper.ts              -- Three-way mapper (domain/persistence/response)
└── __tests__/domain/               -- Domain entity + VO tests
```

Registration:
- [ ] Routes registered in `src/app.ts`
- [ ] Permissions seeded in `prisma/seeds/index.ts`
- [ ] Migration created and applied
- [ ] Prisma client regenerated
- [ ] Middleware chain order: authenticate -> authorize -> validate -> controller
- [ ] Composition root wires all dependencies in routes file
- [ ] Multi-tenant isolation (vendorId) passed from controller to service
- [ ] Response DTOs use whitelist (no entity spreading)
- [ ] Repository catches P2002 unique constraint violations
