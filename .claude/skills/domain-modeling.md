# Skill: Domain Modeling

> **Used by**: Architect Agent (design), Dev Agent (implementation)
> **When**: Defining entities, value objects, aggregates, and domain logic in TypeScript
> **Informed by**: [domain-driven-hexagon](https://github.com/Sairyss/domain-driven-hexagon), [clean-architecture](https://github.com/panagiop/node.js-clean-architecture)

You are implementing DDD tactical patterns in TypeScript for the PayCycle API. This skill bridges the architect's domain model design into concrete TypeScript implementations, following the patterns from domain-driven-hexagon for rich domain models and clean-architecture for layer separation.

---

## When to Use Domain Objects vs Plain DTOs

**Use domain objects when**:
- Complex business rules exist (state machines, invariants, calculations)
- Multiple services need the same validation logic
- Entity behavior goes beyond simple CRUD
- Cross-module events need to be emitted on state changes
- You need to "make illegal states unrepresentable" (e.g., balance can't go negative)

**Use plain DTOs when**:
- The module is pure CRUD with no business rules
- Validation is fully handled by Zod schemas at the boundary
- No state transitions or domain invariants exist

Most PayCycle modules start as CRUD and evolve. Start with DTOs, extract domain objects when complexity demands it.

> **Key principle** (from domain-driven-hexagon): "Domain layer shouldn't depend on frameworks or access external resources directly. Any external calls should be done through ports (interfaces)."

---

## Pattern 1: Entities with Behavior (Aggregate Root)

When a model has business rules beyond CRUD, create a domain entity class following the domain-driven-hexagon pattern:

```typescript
// src/modules/[module]/domain/[entity].entity.ts

/**
 * Domain entity — NO framework imports (no Prisma, Express, Pino).
 * Only import from domain layer and common errors.
 */

import { BadRequestError } from '@/common/errors/app-error';

// === Domain Types (separate file: [entity].types.ts) ===

export interface [Entity]Props {
  name: string;
  status: [Entity]Status;
  vendorId: bigint;
  // Note: id, createdAt, updatedAt are base entity concerns
}

export interface Create[Entity]Props {
  name: string;
  vendorId: bigint;
  // Only properties needed for creation — not id, status, timestamps
}

export enum [Entity]Status {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

// State machine: valid transitions
const VALID_TRANSITIONS: Record<[Entity]Status, [Entity]Status[]> = {
  [[Entity]Status.DRAFT]:      [[Entity]Status.ACTIVE, [Entity]Status.CANCELLED],
  [[Entity]Status.ACTIVE]:     [[Entity]Status.PROCESSING, [Entity]Status.CANCELLED],
  [[Entity]Status.PROCESSING]: [[Entity]Status.COMPLETED, [Entity]Status.CANCELLED],
  [[Entity]Status.COMPLETED]:  [],  // Terminal state
  [[Entity]Status.CANCELLED]:  [],  // Terminal state
};

// === Base Entity Properties ===

export interface BaseEntityProps {
  id: bigint;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateEntityProps<T> {
  id: bigint;
  props: T;
  createdAt?: Date;
  updatedAt?: Date;
}

// === Entity Implementation ===

export class [Entity] {
  // Props are protected — external code uses getters, not direct access
  protected readonly props: [Entity]Props;
  private readonly _id: bigint;
  private readonly _createdAt: Date;
  private _updatedAt: Date;

  // Private constructor — use factory methods
  private constructor({ id, props, createdAt, updatedAt }: CreateEntityProps<[Entity]Props>) {
    this._id = id;
    this.props = props;
    this._createdAt = createdAt || new Date();
    this._updatedAt = updatedAt || new Date();
    this.validate(); // Enforce invariants on construction
  }

  // === Factory Method for NEW entities ===
  static create(create: Create[Entity]Props): [Entity] {
    const props: [Entity]Props = {
      ...create,
      status: [Entity]Status.DRAFT, // Default role/status set here, not accepted from outside
    };
    return new [Entity]({
      id: BigInt(0), // Assigned by DB
      props,
    });
  }

  // === Reconstitution from DB (via Mapper) ===
  static fromPersistence(entityProps: CreateEntityProps<[Entity]Props>): [Entity] {
    return new [Entity](entityProps);
  }

  // === Getters (read-only access — encapsulation) ===
  // Create getters ONLY for properties you need to access externally.
  // Leave the rest private to keep entity encapsulated.
  get id(): bigint { return this._id; }
  get name(): string { return this.props.name; }
  get status(): [Entity]Status { return this.props.status; }
  get vendorId(): bigint { return this.props.vendorId; }
  get createdAt(): Date { return this._createdAt; }
  get updatedAt(): Date { return this._updatedAt; }

  get isTerminal(): boolean {
    return VALID_TRANSITIONS[this.props.status].length === 0;
  }

  // === Get all props (for saving to DB or mapping a response) ===
  getProps(): [Entity]Props & BaseEntityProps {
    const propsCopy = {
      id: this._id,
      createdAt: this._createdAt,
      updatedAt: this._updatedAt,
      ...this.props,
    };
    return Object.freeze(propsCopy);
  }

  // === Equality by ID ===
  equals(other?: [Entity]): boolean {
    if (!other) return false;
    return this._id === other._id;
  }

  // === Domain Behavior ===

  /**
   * Transition to a new status with invariant enforcement
   */
  transitionTo(newStatus: [Entity]Status): void {
    const allowed = VALID_TRANSITIONS[this.props.status];
    if (!allowed.includes(newStatus)) {
      throw new BadRequestError(
        `Cannot transition from '${this.props.status}' to '${newStatus}'. ` +
        `Allowed: ${allowed.join(', ') || 'none (terminal state)'}`
      );
    }
    this.props.status = newStatus;
    this._updatedAt = new Date();
  }

  activate(): void {
    this.transitionTo([Entity]Status.ACTIVE);
  }

  cancel(): void {
    this.transitionTo([Entity]Status.CANCELLED);
  }

  /**
   * Update name with business rule: cannot change name after PROCESSING.
   * This prevents illegal actions like setting name from outside.
   */
  updateName(name: string): void {
    if (this.props.status === [Entity]Status.PROCESSING || this.isTerminal) {
      throw new BadRequestError('Cannot update name in current status');
    }
    this.props.name = name;
    this._updatedAt = new Date();
  }

  // === Invariant Validation ===
  // Called on construction and before persistence.
  // "There are certain rules that always have to be true (invariants)
  // for each entity." — domain-driven-hexagon
  validate(): void {
    if (!this.props.name || this.props.name.trim().length === 0) {
      throw new BadRequestError('Entity name cannot be empty');
    }
    // Add more invariants as needed
  }
}
```

### When to Use Entity Classes
- The entity has state machine behavior (status transitions)
- Business rules restrict when fields can be modified
- Complex calculations depend on entity state
- Multiple services need to enforce the same invariants
- You want to emit domain events on state changes
- Invariants must be validated before persistence (via `validate()`)

---

## Pattern 2: Value Objects

Value Objects are immutable, compared by structural equality, and self-validate in the constructor.

**Domain-driven-hexagon pattern**: Value Objects have a `validate()` method called in constructor, `equals()` for structural comparison, and `unpack()` to extract raw values for persistence.

**Key principle**: "Replacing primitives with Value Objects" makes illegal states unrepresentable at the type level.

```typescript
// src/modules/[module]/domain/value-objects/[value-object].value-object.ts

import { BadRequestError } from '@/common/errors/app-error';

/**
 * Guard utility for Value Object validation
 * (Inspired by domain-driven-hexagon Guard class)
 */
class Guard {
  static isEmpty(value: unknown): boolean {
    if (typeof value === 'number' || typeof value === 'boolean') return false;
    if (value === undefined || value === null) return true;
    if (value instanceof Date) return false;
    if (value instanceof Object && !Object.keys(value).length) return true;
    if (value === '') return true;
    return false;
  }

  static lengthIsBetween(value: string | unknown[], min: number, max: number): boolean {
    if (Guard.isEmpty(value)) return false;
    return value.length >= min && value.length <= max;
  }
}

// === Address Value Object (from domain-driven-hexagon) ===

export interface AddressProps {
  country: string;
  postalCode: string;
  street: string;
}

export class Address {
  // Props are protected — use getters
  protected readonly props: AddressProps;

  constructor(props: AddressProps) {
    this.validate(props);
    this.props = Object.freeze(props); // Immutable
  }

  get country(): string { return this.props.country; }
  get postalCode(): string { return this.props.postalCode; }
  get street(): string { return this.props.street; }

  // Structural equality
  equals(other?: Address): boolean {
    if (!other) return false;
    return JSON.stringify(this.props) === JSON.stringify(other.props);
  }

  // Unpack for persistence
  unpack(): AddressProps {
    return { ...this.props };
  }

  // Self-validation — called in constructor
  protected validate(props: AddressProps): void {
    if (!Guard.lengthIsBetween(props.country, 2, 50)) {
      throw new BadRequestError('Country must be 2-50 characters');
    }
    if (!Guard.lengthIsBetween(props.street, 2, 100)) {
      throw new BadRequestError('Street must be 2-100 characters');
    }
    if (!Guard.lengthIsBetween(props.postalCode, 2, 10)) {
      throw new BadRequestError('Postal code must be 2-10 characters');
    }
  }
}
```

```typescript
// === Money Value Object ===

export class Money {
  private constructor(
    public readonly amount: number,
    public readonly currency: string,
  ) {}

  static create(amount: number, currency: string = 'USD'): Money {
    if (amount < 0) {
      throw new BadRequestError('Amount cannot be negative');
    }
    if (!['USD', 'EUR', 'GBP', 'INR'].includes(currency)) {
      throw new BadRequestError(`Unsupported currency: ${currency}`);
    }
    return new Money(Math.round(amount * 100) / 100, currency);
  }

  add(other: Money): Money {
    this.ensureSameCurrency(other);
    return Money.create(this.amount + other.amount, this.currency);
  }

  subtract(other: Money): Money {
    this.ensureSameCurrency(other);
    return Money.create(this.amount - other.amount, this.currency);
  }

  multiply(factor: number): Money {
    return Money.create(this.amount * factor, this.currency);
  }

  equals(other: Money): boolean {
    return this.amount === other.amount && this.currency === other.currency;
  }

  isZero(): boolean { return this.amount === 0; }

  unpack(): { amount: number; currency: string } {
    return { amount: this.amount, currency: this.currency };
  }

  toString(): string {
    return `${this.currency} ${this.amount.toFixed(2)}`;
  }

  private ensureSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new BadRequestError('Cannot operate on different currencies');
    }
  }
}
```

```typescript
// === DateRange Value Object ===

export class DateRange {
  private constructor(
    public readonly startDate: Date,
    public readonly endDate: Date,
  ) {}

  static create(startDate: Date, endDate: Date): DateRange {
    if (endDate <= startDate) {
      throw new BadRequestError('End date must be after start date');
    }
    return new DateRange(startDate, endDate);
  }

  get durationInDays(): number {
    const diff = this.endDate.getTime() - this.startDate.getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }

  contains(date: Date): boolean {
    return date >= this.startDate && date <= this.endDate;
  }

  overlaps(other: DateRange): boolean {
    return this.startDate < other.endDate && this.endDate > other.startDate;
  }

  equals(other: DateRange): boolean {
    return (
      this.startDate.getTime() === other.startDate.getTime() &&
      this.endDate.getTime() === other.endDate.getTime()
    );
  }

  unpack(): { startDate: Date; endDate: Date } {
    return { startDate: this.startDate, endDate: this.endDate };
  }
}
```

### Common Value Objects in PayCycle
- **Money** — amount + currency for salary/payment calculations
- **DateRange** — pay period start/end dates
- **Address** — street, city, state, zip, country (from domain-driven-hexagon)
- **PhoneNumber** — with country code and E.164 validation
- **Email** — normalized, validated email address
- **Percentage** — 0-100 with precision rules

---

## Pattern 3: Domain Services

For business logic that doesn't belong to a single entity:

```typescript
// src/modules/[module]/domain/[domain-service].service.ts

import { [Entity] } from './[entity].entity';
import { Money } from './money.vo';

/**
 * Domain service for calculations that span multiple entities
 * No infrastructure dependencies — pure business logic
 */
export class PayCalculationService {
  /**
   * Calculate gross pay for an employee in a pay cycle
   */
  calculateGrossPay(
    baseSalary: Money,
    hoursWorked: number,
    overtimeHours: number,
    overtimeMultiplier: number = 1.5,
  ): Money {
    const regularPay = baseSalary;
    const hourlyRate = baseSalary.amount / 160; // Assuming 160 hours/month
    const overtimePay = Money.create(
      hourlyRate * overtimeMultiplier * overtimeHours,
      baseSalary.currency,
    );
    return regularPay.add(overtimePay);
  }

  /**
   * Validate a pay cycle can be processed
   */
  canProcess(payCycle: PayCycle, employeeCount: number): boolean {
    return (
      payCycle.status === PayCycleStatus.ACTIVE &&
      employeeCount > 0 &&
      !payCycle.isTerminal
    );
  }
}
```

### Domain Service vs Application Service

| Aspect              | Domain Service                              | Application Service                    |
|--------------------|--------------------------------------------|---------------------------------------|
| **Contains**       | Pure business logic, calculations          | Orchestration, transactions, events   |
| **Dependencies**   | Other domain objects only                  | Repositories, domain services, logger |
| **Infrastructure** | None (no DB, no HTTP, no logging)          | Yes (repository, events, transactions)|
| **Location**       | `src/modules/[m]/domain/`                  | `src/modules/[m]/[m].service.ts`      |
| **Example**        | `calculateGrossPay()`, `canProcess()`      | `createPayCycle()`, `processPayroll()`|

---

## Pattern 4: Domain Events (from domain-driven-hexagon)

Events represent something meaningful that happened in the domain. They carry metadata for tracing and correlation.

```typescript
// src/modules/[module]/domain/events/[event-name].domain-event.ts

import { randomUUID } from 'crypto';

/**
 * Domain Event metadata for tracing and correlation.
 * correlationId ties related operations together across modules.
 */
type DomainEventMetadata = {
  readonly timestamp: number;
  readonly correlationId: string;  // For log correlation across modules
  readonly causationId?: string;   // Reconstruct execution order
  readonly userId?: string;        // Who triggered this
};

export type DomainEventProps<T> = Omit<T, 'id' | 'metadata'> & {
  aggregateId: string;
  metadata?: Partial<DomainEventMetadata>;
};

export abstract class DomainEvent {
  public readonly id: string;
  public readonly aggregateId: string;
  public readonly metadata: DomainEventMetadata;

  constructor(props: DomainEventProps<unknown>) {
    this.id = randomUUID();
    this.aggregateId = props.aggregateId;
    this.metadata = {
      correlationId: props.metadata?.correlationId || randomUUID(),
      causationId: props.metadata?.causationId,
      timestamp: props.metadata?.timestamp || Date.now(),
      userId: props.metadata?.userId,
    };
  }
}

// === Concrete Domain Event ===

export class PayCycleCreatedEvent extends DomainEvent {
  readonly vendorId: string;
  readonly periodStart: string;
  readonly periodEnd: string;

  constructor(props: DomainEventProps<PayCycleCreatedEvent>) {
    super(props);
    this.vendorId = props.vendorId;
    this.periodStart = props.periodStart;
    this.periodEnd = props.periodEnd;
  }
}

export class PayCycleProcessedEvent extends DomainEvent {
  readonly employeeCount: number;
  readonly totalAmount: number;

  constructor(props: DomainEventProps<PayCycleProcessedEvent>) {
    super(props);
    this.employeeCount = props.employeeCount;
    this.totalAmount = props.totalAmount;
  }
}
```

### Event Handling — Cross-Module Communication (from domain-driven-hexagon)

The key pattern: Aggregate Root collects events → Repository publishes after persistence.

```typescript
// 1. Entity adds event during domain operation:
static create(create: Create[Entity]Props): [Entity] {
  const entity = new [Entity]({ id, props });
  entity.addEvent(new [Entity]CreatedEvent({
    aggregateId: id.toString(),
    ...create,
  }));
  return entity;
}

// 2. Application service persists and handles events:
async create(input: CreateInput): Promise<string> {
  const entity = [Entity].create(input);

  await prisma.$transaction(async (tx) => {
    await this.repository.insert(entity, tx);

    // Persist domain events to audit trail
    for (const event of entity.domainEvents) {
      await this.auditRepository.create({
        action: event.constructor.name,
        entityType: '[Entity]',
        entityId: entity.id,
        payload: event,
        userId: event.metadata.userId,
      }, tx);
    }
  });

  return entity.id.toString();
}

// 3. Cross-module event handler (in ANOTHER module):
// Example from domain-driven-hexagon: UserCreated → CreateWallet
class CreateWalletWhenUserIsCreated {
  constructor(private readonly walletRepo: WalletRepositoryPort) {}

  async handle(event: UserCreatedDomainEvent): Promise<void> {
    const wallet = WalletEntity.create({ userId: event.aggregateId });
    await this.walletRepo.insert(wallet);
  }
}
```

### Event Flow Rule
```
Command → Aggregate emits Event → Event Handler triggers next Command
NEVER: Command → Command (creates tight coupling between modules)
```

## Pattern 5: Mapper (from domain-driven-hexagon)

Every domain-rich module needs a three-way mapper to translate between layers:

```typescript
// src/modules/[module]/[module].mapper.ts

import { [Model] } from '@prisma/client';
import { [Entity] } from './domain/[entity].entity';
import { [Entity]Dto } from './[module].types';
import { Address } from './domain/value-objects/address.value-object';

/**
 * Mapper constructs objects used in different layers:
 * - DbRecord: stored in database (Prisma model)
 * - Entity: used in domain layer (with behavior)
 * - ResponseDTO: returned to user (whitelisted fields!)
 *
 * IMPORTANT: Response uses WHITELIST approach — explicitly select
 * which fields to expose. This prevents leaking new fields
 * (passwords, credit cards) when they're added to the entity.
 */
export class [Entity]Mapper {
  // Domain → Database
  toPersistence(entity: [Entity]): Omit<[Model], 'id'> {
    const props = entity.getProps();
    return {
      name: props.name,
      status: props.status,
      vendorId: props.vendorId,
      // Flatten Value Objects for DB storage
      street: props.address.street,
      city: props.address.city,
      country: props.address.country,
      createdAt: props.createdAt,
      updatedAt: props.updatedAt,
      deletedAt: null,
    };
  }

  // Database → Domain (reconstitute entity with Value Objects)
  toDomain(record: [Model]): [Entity] {
    return [Entity].fromPersistence({
      id: record.id,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      props: {
        name: record.name,
        status: record.status as [Entity]Status,
        vendorId: record.vendorId,
        // Reconstitute Value Objects from flat DB fields
        address: new Address({
          street: record.street,
          city: record.city,
          country: record.country,
        }),
      },
    });
  }

  // Domain → API Response (WHITELIST — only expose safe fields)
  toResponse(entity: [Entity]): [Entity]Dto {
    const props = entity.getProps();
    return {
      id: props.id.toString(),
      name: props.name,
      status: props.status,
      vendorId: props.vendorId.toString(),
      country: props.address.country,
      createdAt: props.createdAt.toISOString(),
      updatedAt: props.updatedAt.toISOString(),
      // ^ Explicitly listed — new sensitive fields won't leak
    };
  }
}
```

---

## Folder Structure for Domain-Rich Modules

When a module has complex domain logic, organize using **vertical slicing** (from domain-driven-hexagon):

```
src/modules/[module]/
├── domain/                              # Domain layer (NO framework imports)
│   ├── [entity].entity.ts              # Aggregate root with behavior
│   ├── [entity].types.ts               # Domain props, enums, interfaces
│   ├── [entity].errors.ts              # Domain-specific errors
│   ├── value-objects/                   # Self-validating value objects
│   │   ├── address.value-object.ts
│   │   └── money.value-object.ts
│   └── events/                          # Domain events with metadata
│       ├── [entity]-created.domain-event.ts
│       └── [entity]-status-changed.domain-event.ts
├── database/                            # Repository port + adapter
│   ├── [entity].repository.port.ts     # Interface (port)
│   └── [entity].repository.ts          # Prisma implementation (adapter)
├── commands/                            # Write operations (vertical slices)
│   ├── create-[entity]/
│   │   ├── create-[entity].service.ts
│   │   └── create-[entity].request.dto.ts
│   └── update-[entity]/
│       └── ...
├── queries/                             # Read operations (vertical slices)
│   └── find-[entities]/
│       ├── find-[entities].query-handler.ts
│       └── find-[entities].request.dto.ts
├── [module].mapper.ts                   # toPersistence / toDomain / toResponse
├── [module].types.ts                    # Shared DTOs (input/output)
├── [module].validator.ts                # Zod schemas
├── [module].controller.ts               # HTTP handlers
├── [module].routes.ts                   # Route definitions (composition root)
└── __tests__/
    ├── [module].service.test.ts
    └── domain/
        ├── [entity].entity.test.ts
        └── [value-object].value-object.test.ts
```

### Simple CRUD Module (no domain layer needed)
```
src/modules/[module]/
├── [module].types.ts            # DTOs + transformer functions
├── [module].validator.ts        # Zod schemas
├── [module].repository.ts       # Direct Prisma data access
├── [module].service.ts          # Application service
├── [module].controller.ts       # HTTP handlers
├── [module].routes.ts           # Route definitions
└── __tests__/
```

---

## Rules

1. **Domain objects have NO infrastructure imports** — No Prisma, no Express, no Pino. Domain is the innermost ring
2. **Value Objects are always immutable** — Return new instances, never mutate. Self-validate in constructor
3. **Entities enforce their own invariants** — `validate()` called on construction and before persistence
4. **Domain services are stateless** — No instance state, pure functions with domain logic
5. **Use factories for creation** — `Entity.create()` for new, `Entity.fromPersistence()` for reconstruction
6. **Only add domain objects when justified** — Simple CRUD doesn't need domain entities. Scale architecture to complexity
7. **Test domain objects in isolation** — No mocks needed, they're pure logic
8. **Mapper uses whitelist for responses** — Never blacklist (which leaks new fields by default)
9. **Dependencies point inward** — Domain knows nothing about application/infrastructure
10. **Repository behind port (interface)** — Service depends on port, infrastructure provides adapter
11. **Events carry metadata** — correlationId, causationId, timestamp for tracing
12. **Replace primitives with Value Objects** — "Make illegal states unrepresentable" at the type level
13. **One module = one bounded context** — Keep modules independent, communicate via events
