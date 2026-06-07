# Skill: Service Implementation

> **Used by**: Dev Agent
> **When**: Implementing the application service (business logic) layer for a module
> **Informed by**: [domain-driven-hexagon](https://github.com/Sairyss/domain-driven-hexagon), [clean-architecture](https://github.com/panagiop/node.js-clean-architecture), [open-saas](https://github.com/wasp-lang/open-saas)

You are implementing the service layer for a PayCycle API module. The service layer is the heart of the application — it orchestrates domain logic, repository calls, and cross-cutting concerns.

---

## Two Types of Services

### 1. Application Service (`[module].service.ts`)
- Orchestrates use cases
- Manages transactions
- Calls repositories and domain services
- Transforms entities → DTOs
- Handles logging and audit trail
- Located at: `src/modules/[module]/[module].service.ts`

### 2. Domain Service (`domain/[name].service.ts`)
- Pure business logic that doesn't fit in a single entity
- No infrastructure dependencies
- No repository calls, no logging
- Located at: `src/modules/[module]/domain/[name].service.ts`
- See the **domain-modeling** skill for details

---

## Command/Query Separation (CQS) (from domain-driven-hexagon)

Classify every service method as a **Command** (state-changing) or **Query** (data retrieval):

| Type    | Returns           | Side Effects | Example                |
|---------|-------------------|-------------|------------------------|
| Command | ID or void        | Yes (write) | `create()`, `update()`, `delete()`, `process()` |
| Query   | Data (DTO/list)   | None        | `getById()`, `list()`, `search()` |

For complex modules, consider splitting into vertical slices with dedicated handlers:

```typescript
// src/modules/[module]/commands/create-[model]/create-[model].service.ts
export class Create[Model]Service {
  constructor(
    private readonly repository: [Entity]RepositoryPort,
    private readonly logger: Logger,
  ) {}

  async execute(command: Create[Model]Command): Promise<string> {
    // 1. Create domain entity via factory
    const entity = [Entity].create(command);

    // 2. Persist via repository port
    const created = await this.repository.insert(entity);

    // 3. Publish domain events (if aggregate root)
    await created.publishEvents(this.eventEmitter);

    return created.id.toString();
  }
}

// src/modules/[module]/queries/get-[model]/get-[model].service.ts
export class Get[Model]Service {
  constructor(private readonly repository: [Entity]RepositoryPort) {}

  async execute(query: Get[Model]Query): Promise<[Model]Dto> {
    const entity = await this.repository.findOneById(query.id);
    if (!entity) throw new NotFoundError('[Model] not found');
    return this.mapper.toResponse(entity);
  }
}
```

### When to use vertical slicing
- Complex modules with 8+ use cases
- When commands have cross-module side effects (domain events)
- When commands and queries need different dependencies

### When to keep a single service class
- Simple CRUD modules (the common case)
- When all use cases share the same dependencies

---

## Strategy Pattern for External Services (from open-saas)

When the same capability has multiple provider options (payments, email, SMS), define a **processor interface**:

```typescript
// src/modules/[module]/[module].processor.ts
export interface [Module]Processor {
  id: 'provider-a' | 'provider-b';
  executeAction: (args: ActionArgs) => Promise<ActionResult>;
  handleWebhook: (event: WebhookEvent) => Promise<void>;
}

// Select implementation at composition root (routes file)
import { stripeProcessor } from './providers/stripe.processor';
export const paymentProcessor: PaymentProcessor = stripeProcessor;

// In service — depend on the interface, not the implementation
export class [Model]Service {
  constructor(
    private readonly processor: [Module]Processor,
    private readonly repository: [Model]Repository,
    private readonly logger: Logger,
  ) {}
}
```

### Webhook Handling Pattern (from open-saas)

```typescript
async handleWebhook(rawEvent: RawWebhookEvent): Promise<void> {
  const event = this.processor.parseEvent(rawEvent);

  switch (event.type) {
    case 'invoice.paid':
      await this.handleInvoicePaid(event);
      break;
    case 'subscription.updated':
      await this.handleSubscriptionUpdated(event);
      break;
    default:
      // Never throw for unhandled events — prevents retry storms
      // Always warn regardless of env — unknown event types always warrant attention
      this.logger.warn({ eventType: event.type }, 'Unhandled webhook event');
  }
}
```

---

## Application Service Template

```typescript
import { Logger } from 'pino';
import { [Model]Repository } from './[model].repository';
// For complex modules, use repository port:
// import { [Entity]RepositoryPort } from './database/[entity].repository.port';
import {
  Create[Model]Input,
  Update[Model]Input,
  [Model]Dto,
  [Model]ListDto,
  to[Model]Dto,
  to[Model]ListDto,
} from './[model].types';
import {
  NotFoundError,
  ConflictError,
  BadRequestError,
  ForbiddenError,
} from '@/common/errors/app-error';
import { QueryBuilder } from '@/common/api-wrapper/query-builder';
import { ListQueryParams, PaginationMeta } from '@/common/api-wrapper/types';
import { calculatePaginationMeta } from '@/common/api-wrapper/response.util';
import { prisma, PrismaTransaction } from '@/infrastructure/database/prisma.client';

export class [Model]Service {
  /**
   * Fields allowed in query builder operations
   * Restricts what the client can filter/sort/search/select
   */
  private readonly allowedFields = {
    filter: ['status', 'vendorId', 'createdAt', 'updatedAt'],
    sort: ['name', 'status', 'createdAt', 'updatedAt'],
    search: ['name', 'description'],
    select: ['id', 'name', 'description', 'status', 'vendorId', 'createdAt', 'updatedAt'],
  };

  constructor(
    private readonly repository: [Model]Repository,
    // For complex modules with domain entities, use repository port:
    // private readonly repository: [Entity]RepositoryPort,
    private readonly logger: Logger,
  ) {}

  // ============================================================
  // Command: Create
  // ============================================================

  /**
   * Create a new [model]
   * @param input - Validated create input from controller
   * @param vendorId - Vendor context from JWT claims
   * @param userId - Authenticated user ID
   * @throws ConflictError if [model] with same name exists
   */
  async create(input: Create[Model]Input, vendorId: bigint, userId: bigint): Promise<[Model]Dto> {
    this.logger.info({ vendorId }, 'Creating [model]'); // service propagation

    // === Business Rule: Uniqueness Check ===
    const existing = await this.repository.exists({
      name: input.name,
      vendorId,
    });
    if (existing) {
      this.logger.warn({ name: input.name, vendorId }, '[Model] creation blocked — duplicate name');
      throw new ConflictError('[Model] with this name already exists');
    }

    // === For complex modules: Create domain entity via factory ===
    // const entity = [Entity].create({
    //   name: input.name,
    //   vendorId,
    //   createdBy: userId,
    // });
    // const created = await this.repository.insert(entity);
    // return this.mapper.toResponse(created);

    // === Simple CRUD: Direct repository call ===
    try {
      const entity = await this.repository.create({
        name: input.name,
        description: input.description,
        vendor: { connect: { id: vendorId } },
        createdBy: { connect: { id: userId } },
      });
      return to[Model]Dto(entity);
    } catch (error) {
      this.logger.error({ error, vendorId }, 'Failed to create [model]');
      throw new InternalServerError('Failed to create [model]');
    }
  }

  // ============================================================
  // Query: Get by ID
  // ============================================================

  /**
   * Get a single [model] by ID
   * @throws NotFoundError if [model] doesn't exist
   */
  async getById(id: bigint, vendorId?: bigint): Promise<[Model]Dto> {
    const entity = await this.repository.findById(id);

    if (!entity) {
      throw new NotFoundError('[Model] not found');
    }

    // === Multi-tenant isolation ===
    if (vendorId && entity.vendorId !== vendorId) {
      throw new NotFoundError('[Model] not found'); // Don't reveal existence
    }

    return to[Model]Dto(entity);
  }

  // ============================================================
  // Query: List with Query Builder
  // ============================================================

  /**
   * List [models] with pagination, filtering, sorting, search
   * @param queryParams - Raw query parameters from request
   * @param vendorId - Vendor context for multi-tenant filtering
   */
  async list(
    queryParams: ListQueryParams,
    vendorId?: bigint,
  ): Promise<{ data: [Model]Dto[]; meta: PaginationMeta }> {
    const parsedQuery = QueryBuilder.parseListQuery(queryParams, this.allowedFields);

    // === Inject tenant filter ===
    const where = {
      ...parsedQuery.where,
      ...(vendorId ? { vendorId } : {}),
    };

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

  // ============================================================
  // Command: Update
  // ============================================================

  /**
   * Update an existing [model]
   * @throws NotFoundError if [model] doesn't exist
   * @throws ConflictError if name conflicts with another [model]
   */
  async update(
    id: bigint,
    input: Update[Model]Input,
    vendorId?: bigint,
  ): Promise<[Model]Dto> {
    this.logger.info({ id: id.toString(), vendorId }, 'Updating [model]'); // service propagation

    // === Existence Check ===
    const existing = await this.repository.findById(id);
    if (!existing) {
      this.logger.warn({ id: id.toString() }, '[Model] not found for update');
      throw new NotFoundError('[Model] not found');
    }

    // === Multi-tenant isolation ===
    if (vendorId && existing.vendorId !== vendorId) {
      this.logger.warn({ id: id.toString(), vendorId }, '[Model] update blocked — tenant mismatch');
      throw new NotFoundError('[Model] not found');
    }

    // === Business Rule: State-based restrictions ===
    // if (['PROCESSING', 'COMPLETED'].includes(existing.status)) {
    //   this.logger.warn({ id: id.toString(), status: existing.status }, '[Model] update blocked — invalid state');
    //   throw new BadRequestError('Cannot update [model] in current status');
    // }

    // === Business Rule: Uniqueness on name change ===
    if (input.name && input.name !== existing.name) {
      const duplicate = await this.repository.exists({
        name: input.name,
        vendorId: existing.vendorId,
        id: { not: id },
      });
      if (duplicate) {
        this.logger.warn({ name: input.name, id: id.toString() }, '[Model] update blocked — duplicate name');
        throw new ConflictError('[Model] with this name already exists');
      }
    }

    // === Perform Update ===
    try {
      const updated = await this.repository.update(id, input);
      return to[Model]Dto(updated);
    } catch (error) {
      this.logger.error({ error, id: id.toString() }, 'Failed to update [model]');
      throw new InternalServerError('Failed to update [model]');
    }
  }

  // ============================================================
  // Command: Delete (Soft/Hard)
  // ============================================================

  /**
   * Delete a [model] (soft delete by default)
   * @param hard - If true, permanently removes the record (admin only)
   * @throws NotFoundError if [model] doesn't exist
   */
  async delete(id: bigint, hard = false, vendorId?: bigint): Promise<void> {
    this.logger.info({ id: id.toString(), hard, vendorId }, 'Deleting [model]'); // service propagation

    const existing = await this.repository.findById(id);
    if (!existing) {
      this.logger.warn({ id: id.toString() }, '[Model] not found for delete');
      throw new NotFoundError('[Model] not found');
    }

    // === Multi-tenant isolation ===
    if (vendorId && existing.vendorId !== vendorId) {
      this.logger.warn({ id: id.toString(), vendorId }, '[Model] delete blocked — tenant mismatch');
      throw new NotFoundError('[Model] not found');
    }

    // === Business Rule: Cannot delete if in PROCESSING ===
    // if (existing.status === 'PROCESSING') {
    //   this.logger.warn({ id: id.toString(), status: existing.status }, '[Model] delete blocked — invalid state');
    //   throw new BadRequestError('Cannot delete [model] while processing');
    // }

    try {
      if (hard) {
        await this.repository.hardDelete(id);
        this.logger.warn({ id: id.toString() }, '[Model] hard deleted'); // audit trail for destructive op
      } else {
        await this.repository.softDelete(id);
      }
    } catch (error) {
      this.logger.error({ error, id: id.toString(), hard }, 'Failed to delete [model]');
      throw new InternalServerError('Failed to delete [model]');
    }
  }

  // ============================================================
  // Command: Bulk Operations
  // ============================================================

  /**
   * Bulk create [models]
   * Wraps in a transaction for atomicity
   */
  async bulkCreate(
    items: Create[Model]Input[],
    vendorId: bigint,
    userId: bigint,
  ): Promise<{ created: number }> {
    this.logger.info({ count: items.length, vendorId }, 'Bulk creating [models]'); // service propagation

    try {
      const result = await prisma.$transaction(async (tx) => {
        for (const item of items) {
          const exists = await this.repository.exists(
            { name: item.name, vendorId },
            tx,
          );
          if (exists) {
            this.logger.warn({ name: item.name, vendorId }, 'Bulk create blocked — duplicate name');
            throw new ConflictError(`[Model] '${item.name}' already exists`);
          }
        }

        return this.repository.createMany(
          items.map((item) => ({
            ...item,
            vendorId,
            createdById: userId,
          })),
          tx,
        );
      });

      return { created: result.count };
    } catch (error) {
      if (error instanceof AppError) throw error; // re-throw business errors as-is
      this.logger.error({ error, count: items.length, vendorId }, 'Bulk create transaction failed');
      throw new InternalServerError('Bulk create failed, please try again');
    }
  }
}
```

---

## Domain Entity Factory and Events (from domain-driven-hexagon)

For complex modules with domain entities, the service creates entities via **factory methods** and publishes **domain events**:

```typescript
// Command service with domain entity creation
async create(command: Create[Model]Command): Promise<[Model]Dto> {
  // 1. Create domain entity via static factory (validates invariants)
  const entity = [Entity].create({
    name: command.name,
    vendorId: command.vendorId,
  });
  // Factory emits: new [Entity]CreatedDomainEvent(entity)

  // 2. Persist via repository (uses mapper.toPersistence internally)
  const created = await this.repository.insert(entity);

  // 3. Publish domain events for cross-module communication
  // e.g., UserCreated -> CreateWallet handler in wallet module
  await created.publishEvents(this.eventEmitter);

  // 4. Transform via mapper (whitelist fields for response)
  return this.mapper.toResponse(created);
}
```

### Cross-Module Event Handling (from domain-driven-hexagon)

```typescript
// src/modules/wallet/application/event-handlers/
//   create-wallet-when-user-is-created.domain-event-handler.ts

@OnEvent(UserCreatedDomainEvent.name)
export class CreateWalletWhenUserIsCreated {
  constructor(
    private readonly walletRepo: WalletRepositoryPort,
    private readonly logger: Logger,
  ) {}

  async handle(event: UserCreatedDomainEvent): Promise<void> {
    this.logger.info({ aggregateId: event.aggregateId.toString() }, 'UserCreated event received — creating wallet'); // event propagation
    try {
      const wallet = WalletEntity.create({ userId: event.aggregateId });
      await this.walletRepo.insert(wallet);
    } catch (error) {
      this.logger.error({ error, aggregateId: event.aggregateId.toString() }, 'Failed to create wallet on UserCreated event');
      throw error;
    }
  }
}
```

---

## Transaction Patterns

### Single-Repository Transaction (Simple)

```typescript
async transferStatus(id: bigint, newStatus: string): Promise<[Model]Dto> {
  const result = await prisma.$transaction(async (tx) => {
    const entity = await this.repository.findById(id, tx);
    if (!entity) throw new NotFoundError('[Model] not found');
    
    // Business validation
    this.validateTransition(entity.status, newStatus);
    
    return this.repository.update(id, { status: newStatus }, tx);
  });
  
  return to[Model]Dto(result);
}
```

### Cross-Repository Transaction (Complex)

```typescript
async processPayCycle(payCycleId: bigint): Promise<PayCycleDto> {
  const result = await prisma.$transaction(async (tx) => {
    // Lock the pay cycle row
    const payCycle = await this.payCycleRepo.findById(payCycleId, tx);
    if (!payCycle) throw new NotFoundError('Pay cycle not found');
    
    // Load employees
    const employees = await this.employeeRepo.findByPayCycleId(payCycleId, tx);
    if (employees.length === 0) {
      throw new BadRequestError('No employees in pay cycle');
    }
    
    // Calculate payroll (domain service — pure logic)
    const calculations = this.payCalcService.calculateAll(employees, payCycle);
    
    // Persist results
    await this.payrollRepo.createMany(calculations, tx);
    
    // Update pay cycle status
    return this.payCycleRepo.update(payCycleId, { status: 'COMPLETED' }, tx);
  });
  
  return toPayCycleDto(result);
}
```

---

## Constructor Injection Pattern

```typescript
// In routes file — Composition Root (from clean-architecture)
// Routes wire all dependencies — this is the only place that knows concrete implementations

// Simple module:
const repository = new [Model]Repository();
const service = new [Model]Service(repository, logger);
const controller = new [Model]Controller(service);

// Complex module with domain entities and repository ports:
const mapper = new [Entity]Mapper();
const repository = new [Model]Repository(mapper); // implements [Entity]RepositoryPort
const service = new [Model]Service(repository, mapper, logger);
const controller = new [Model]Controller(service);

// Module with external service strategy:
const paymentProcessor = stripePaymentProcessor; // satisfies PaymentProcessor interface
const repository = new OrderRepository();
const service = new OrderService(repository, paymentProcessor, logger);

// For services that depend on other repositories or domain services:
const payCycleRepo = new PayCycleRepository();
const employeeRepo = new EmployeeRepository();
const payCalcService = new PayCalculationService();
const service = new PayCycleService(payCycleRepo, employeeRepo, payCalcService, logger);
```

---

## Focused Update Methods (from open-saas)

Instead of one generic `update()` for everything, prefer small, single-purpose update methods for critical operations:

```typescript
// In service — focused methods for specific business operations
async updateSubscription(
  userId: bigint,
  data: { planId: string; status: string; datePaid?: Date },
): Promise<void> {
  await this.repository.updateSubscription(userId, data);
  this.logger.info({ userId: userId.toString(), planId: data.planId }, 'Subscription updated');
}

async addCredits(
  userId: bigint,
  numOfCredits: number,
): Promise<void> {
  // Atomic increment in repository — no race conditions
  await this.repository.updateCredits(userId, numOfCredits);
  this.logger.info({ userId: userId.toString(), credits: numOfCredits }, 'Credits added');
}
```

---

## Service Method Structure

Every service method follows this structure:

```
1.  logger.info — entry point (service propagation); include IDs and key context, not raw input
2.  Load existing entity (if update/delete)
3.  Validate existence → logger.warn then throw NotFoundError
4.  Validate tenant isolation → logger.warn then throw NotFoundError
5.  Validate business rules → logger.warn then throw (BadRequestError, ConflictError, UnprocessableError)
6.  Create/update domain entity via factory (for complex modules)
7.  Execute the operation inside try/catch (repository call, optionally in transaction)
8.  catch: logger.error with full error + context, then re-throw or wrap as InternalServerError
9.  Publish domain events (for aggregate roots) → logger.info at event propagation
10. Return transformed DTO (via toDto() or mapper.toResponse())
```

**Rule: every method that can throw must have at least one `warn` (business) or `error` (infrastructure) log call.**
**`info` appears exactly twice per method: entry and, if applicable, event propagation. Never for success confirmations.**

---

## Rules

1. **Never return Prisma entities directly** — Always transform to DTOs using `toDto()` functions or `mapper.toResponse()`
2. **Never call Prisma directly** — Always go through repositories
3. **Never import Express types** — Services are framework-agnostic (from clean-architecture)
4. **`info` at entry only (service propagation)** — Log method entry with key IDs/context; not success, not completion
5. **`warn` before every business error throw** — Log the violation reason and relevant context before throwing
6. **`error` in every catch block** — Log full error object + context before re-throwing or wrapping
7. **`info` at event propagation** — When publishing or entering a domain event handler
8. **Use named errors** — `NotFoundError`, `ConflictError`, not generic `Error`
9. **Multi-tenant isolation is mandatory** — Filter by vendorId when applicable
10. **Keep methods focused** — One use case per method
11. **Transaction scope** — Use `prisma.$transaction()` when multiple writes must be atomic
12. **Validate before mutate** — All checks before any write operation
13. **No HTTP concerns** — No `req`, `res`, status codes, or headers
14. **Classify as Command or Query** — Commands change state, queries read data (CQS from domain-driven-hexagon)
15. **Use entity factories for complex modules** — `[Entity].create()` validates invariants and emits domain events
16. **Depend on ports, not implementations** — Use `[Entity]RepositoryPort` interface for complex modules (from domain-driven-hexagon)
17. **Prefer focused update methods** — Small, single-purpose over generic `update(id, data)` for critical operations (from open-saas)
