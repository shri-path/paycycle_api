# Skill: DDD Module Design

> **Used by**: Architect Agent
> **When**: Designing a new bounded context, module, or feature area
> **Informed by**: [domain-driven-hexagon](https://github.com/Sairyss/domain-driven-hexagon), [clean-architecture](https://github.com/panagiop/node.js-clean-architecture), [open-saas](https://github.com/wasp-lang/open-saas)

You are designing a module using **Domain-Driven Design** combined with **Hexagonal Architecture** principles for the PayCycle API. The design should enforce the **Dependency Rule** (dependencies always point inward: Infrastructure → Application → Domain), keep the domain layer framework-agnostic, and produce world-class, scalable module designs.

---

## Architectural Foundation

```
┌─────────────────────────────────────────────┐
│  Infrastructure (Frameworks & Drivers)       │
│  Express routes, Prisma repos, middleware     │
│  ┌─────────────────────────────────────────┐ │
│  │  Interface Adapters                      │ │
│  │  Controllers, DTOs, Mappers              │ │
│  │  ┌─────────────────────────────────────┐ │ │
│  │  │  Application Layer                  │ │ │
│  │  │  Services (Use Cases), Commands     │ │ │
│  │  │  ┌─────────────────────────────────┐│ │ │
│  │  │  │  Domain Layer                   ││ │ │
│  │  │  │  Entities, VOs, Domain Events   ││ │ │
│  │  │  │  Domain Services, Invariants    ││ │ │
│  │  │  └─────────────────────────────────┘│ │ │
│  │  └─────────────────────────────────────┘ │ │
│  └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘

Arrow of dependency: ALWAYS points inward
```

### Key Principles (from domain-driven-hexagon)
- **Ports & Adapters**: Domain defines ports (interfaces); infrastructure provides adapters
- **Dependency Inversion**: Services depend on repository ports, not concrete Prisma implementations
- **Module encapsulation**: Treat each module as a mini-application with private internals
- **Cross-module communication via events**: Modules cooperate through domain events, not direct imports
- **Vertical Slicing**: Each use case gets its own directory with handler, DTO, and command/query

### Complexity Assessment

Before choosing architecture depth, assess the module:

| Complexity Level | Characteristics | Architecture Approach |
|-----------------|----------------|-----------------------|
| **Simple CRUD** | No business rules, basic CRUD | Plain DTOs + Service + Repository (no domain objects) |
| **Moderate** | Some business rules, state transitions | Domain Entity with behavior + Application Service |
| **Complex** | Multiple aggregates, cross-module events, invariants | Full DDD: Aggregates, VOs, Domain Events, Domain Services |

> **Guideline** (from domain-driven-hexagon README): "Implementing a complete architecture like this is generally ill-suited to simple CRUD applications. Use as many layers/building blocks as needed for the project and skip ones that may over-complicate things."

---

## Step 1: Identify the Bounded Context

Before writing any specification, answer these questions:

1. **What is the Ubiquitous Language?** — List the key domain terms this module owns. These terms must be used consistently in code, docs, and conversations.
2. **What are the boundaries?** — What concepts does this module own exclusively? What does it NOT own?
3. **How does it relate to other contexts?** — Define the Context Map:
   - **Upstream/Downstream** — Which modules depend on this one? Which does it depend on?
   - **Integration pattern** — Shared Kernel, Anti-Corruption Layer, Conformist, or Open Host?

### Context Map Template

```markdown
## Context Map: [Module Name]

### Owned Concepts
- [Concept 1]: [Definition in ubiquitous language]
- [Concept 2]: [Definition]

### Boundaries
- This module OWNS: [list]
- This module DOES NOT OWN: [list]
- Module internals are PRIVATE — no direct imports from other modules

### Relationships
| Related Context | Relationship | Integration Pattern | Communication          | Shared Data |
|----------------|-------------|-------------------|------------------------|-------------|
| Auth           | Upstream    | Conformist        | Direct (JWT claims)    | userId      |
| [Other]        | [Dir]       | [Pattern]         | Domain Events / Direct | [Data]      |

### Cross-Module Communication Strategy
- **Synchronous**: Direct service calls (only for simple lookups within same bounded context)
- **Asynchronous (preferred)**: Domain events emitted by aggregate root, consumed by event handlers
  - Example: UserCreated event → CreateWallet event handler (from domain-driven-hexagon)
- **Anti-Corruption Layer**: When integrating with external services (e.g., Stripe, payment processors)
```

---

## Step 2: Tactical DDD — Define the Domain Model

### 2.1 Identify Aggregates

An **Aggregate** is a cluster of domain objects treated as a single unit for data changes. The Aggregate Root is the only entry point.

**Rules** (from domain-driven-hexagon):
- Each Aggregate has exactly ONE **Aggregate Root** (extends `AggregateRoot` base)
- External references point ONLY to the Aggregate Root (by ID, never by nested entity)
- All invariants within the Aggregate are enforced by the Root via `validate()` method
- Transactions should not span multiple Aggregates — use eventual consistency via domain events
- The Aggregate Root owns and publishes domain events
- Aggregate Root must call `validate()` before persistence to enforce invariants

```markdown
## Aggregates

### [AggregateName] Aggregate
- **Root Entity**: [EntityName] (extends AggregateRoot)
- **Nested Entities**: [List or "None"]
- **Value Objects**: [List]
- **Invariants** (enforced in `validate()`):
  1. [Business rule that must always be true]
  2. [Another invariant — e.g., "balance cannot be negative"]
- **Lifecycle**: [Created → Active → Suspended → Archived]
- **Domain Events Emitted**:
  - [EntityCreated] — on creation
  - [EntityStatusChanged] — on state transition
- **Commands**: [CreateEntity, UpdateEntity, DeleteEntity]
- **Queries**: [FindEntities, GetEntityById]
```

### 2.2 Define Entities

Entities have identity and lifecycle. They encapsulate behavior and enforce invariants.

**Entity Design Pattern** (from domain-driven-hexagon):
```typescript
// Base entity structure:
// - Protected props (not publicly mutable)
// - Static factory method `create()` for new instances
// - Constructor for reconstitution from persistence
// - `validate()` method for invariant enforcement
// - `getProps()` returns frozen copy (read-only)
// - `equals()` compares by ID
```

```markdown
### Entity: [Name]
- **Identity**: BigInt (autoincrement) — serialized as string in responses
- **Base Properties**: id, createdAt, updatedAt (from EntityBase)
- **Fields**:
  | Field        | Type        | Required | Default   | Constraint        |
  |-------------|-------------|----------|-----------|-------------------|
  | id          | BigInt      | Yes      | auto      | PK, autoincrement |
  | name        | String      | Yes      | -         | max 100 chars     |
  | status      | Enum        | Yes      | ACTIVE    | [ACTIVE, INACTIVE]|
  | createdAt   | DateTime    | Yes      | now()     | -                 |
  | updatedAt   | DateTime    | Yes      | auto      | -                 |
  | deletedAt   | DateTime    | No       | null      | Soft delete       |
- **Behavior** (domain methods, not just CRUD):
  - `activate()`: Transition from INACTIVE → ACTIVE, emits StatusChanged event
  - `deactivate()`: Transition from ACTIVE → INACTIVE, emits StatusChanged event
- **Invariants** (checked in `validate()`):
  - [e.g., "name cannot be empty", "status must be a valid enum value"]
```

### 2.3 Define Value Objects

Value Objects have no identity — they are defined entirely by their attributes. They self-validate in constructor.

**Value Object Design Pattern** (from domain-driven-hexagon):
```typescript
// Value Objects:
// - Immutable (constructor sets props, no setters)
// - Self-validating (validate() called in constructor)
// - Structural equality (equals() compares all props)
// - unpack() to extract raw value for persistence
// - Can contain other Value Objects
```

**Replace primitives with Value Objects** to make illegal states unrepresentable:

| Instead of primitive... | Use Value Object | Why |
|------------------------|------------------|-----|
| `amount: number` | `Money(amount, currency)` | Prevents currency mismatch, negative values |
| `street + city + zip` | `Address(props)` | Validates together, immutable unit |
| `startDate + endDate` | `DateRange(start, end)` | Ensures end > start |
| `email: string` | `Email(value)` | Format validation baked in |
| `phone: string` | `PhoneNumber(value)` | E.164 format validation |

```markdown
### Value Object: [Name]
- **Properties**: [field: type, ...]
- **Validation Rules** (enforced in constructor): [list]
- **Equality**: Structural (compared by all properties via `equals()`)
- **Immutable**: Yes (create new instance to change)
- **Guard clauses**: Uses Guard utility for isEmpty, lengthIsBetween checks
```

### 2.4 Define Domain Events

Events represent something meaningful that happened in the domain. They are past-tense named.

**Domain Event Design** (from domain-driven-hexagon):
```typescript
// Every domain event has:
// - id: UUID (auto-generated)
// - aggregateId: string (which aggregate emitted it)
// - metadata: { correlationId, causationId, timestamp, userId }
// Events are added to aggregate via addEvent(), published after persistence
```

```markdown
### Domain Events
| Event                    | Triggered When                    | Payload                              | Consumers                    |
|-------------------------|----------------------------------|--------------------------------------|------------------------------|
| [Entity]Created         | New entity is created            | { aggregateId, ...creationProps }    | Audit, Related modules       |
| [Entity]StatusChanged   | Status transitions               | { aggregateId, oldStatus, newStatus }| Notification, Workflow       |
| [Entity]Deleted         | Entity is soft-deleted           | { aggregateId }                      | Cleanup, Audit               |

### Cross-Module Event Flow
- Example: `UserCreated` → `CreateWalletWhenUserIsCreated` handler (in Wallet module)
- Events flow: Command → Aggregate emits Event → Event Handler triggers next Command
- NEVER: Command → Command (creates tight coupling)
```

---

## Step 3: Define Application Services (Use Cases)

Following **Command-Query Separation (CQS)** (from domain-driven-hexagon):
- **Commands** = state-changing operations (Create, Update, Delete) → return ID or void
- **Queries** = data retrieval operations (Find, List) → can bypass domain layer and query directly

Each use case maps to ONE application service method. Application services:
- Orchestrate domain objects and repositories through **ports** (interfaces)
- Handle transactions — wrap aggregate operations atomically
- Trigger domain event publication after successful persistence
- Do NOT contain business logic (that belongs in entities/domain services)
- Transform scalar/primitive inputs into domain types (Value Objects, Entities)
- Dependencies injected via constructor (repository port, logger)

```markdown
## Use Cases

### Commands (State-Changing)

#### UC-1: Create [Resource]
- **Type**: Command
- **Input**: CreateDTO (mapped to Command object with metadata: correlationId, timestamp)
- **Steps**:
  1. Validate input (Zod schema — handled by middleware at boundary)
  2. Map DTO to domain types (create Value Objects from primitives)
  3. Call Entity.create() factory method (entity adds domain event internally)
  4. Wrap in transaction: repository.insert(entity)
  5. Domain events published automatically after successful commit
  6. Return aggregate ID
- **Errors**: ConflictError (duplicate — caught from repository unique constraint)
- **Auth**: Required, Permission: `resource:create`
- **Transaction**: Required (ensures events and persistence are atomic)

#### UC-2: Update [Resource]
- **Type**: Command
- **Input**: UpdateDTO + resourceId
- **Steps**:
  1. Fetch entity from repository (NotFoundError if missing)
  2. Call entity domain methods (e.g., entity.updateAddress(), entity.changeStatus())
  3. Entity enforces invariants and adds domain events
  4. Persist via repository (entity.validate() called before save)
  5. Return updated aggregate ID
- **Errors**: NotFoundError, BadRequestError (invalid state transition)
- **Auth**: Required, Permission: `resource:update`
- **Transaction**: Required if multi-step

### Queries (Data Retrieval)

#### UC-3: Find [Resources]
- **Type**: Query
- **Input**: QueryParams (pagination, filters, sort)
- **Steps**:
  1. Parse query params via QueryBuilder
  2. Query repository directly (can skip domain layer for reads)
  3. Map results through Mapper.toResponse()
  4. Return paginated response
- **Auth**: Required, Permission: `resource:read`
- **Note**: Queries don't modify state, so no transactions or events needed
```

---

## Step 4: Define the Anti-Corruption Layer (ACL) & Strategy Interfaces

When integrating with external modules or services, define an ACL to protect your domain model.

### Strategy Pattern for External Services (from open-saas)

For external integrations with multiple possible providers, use the **Strategy Pattern**:

```typescript
// Define a processor interface (port) — your domain's contract
export interface PaymentProcessor {
  id: 'stripe' | 'lemonsqueezy' | 'polar';
  createCheckoutSession: (args: CreateCheckoutSessionArgs) => Promise<{ session: Session }>;
  fetchCustomerPortalUrl: (args: FetchPortalArgs) => Promise<string | null>;
  webhook: WebhookHandler;
  fetchTotalRevenue: () => Promise<number>;
}

// Concrete adapter (infrastructure layer)
export const stripePaymentProcessor: PaymentProcessor = {
  id: 'stripe',
  createCheckoutSession: async (args) => { /* Stripe-specific logic */ },
  // ...
};

// Selection at composition root (not in domain/application)
export const paymentProcessor: PaymentProcessor = stripePaymentProcessor;
```

### Type-Safe Configuration with `satisfies` (from open-saas)

```typescript
// Use enums + satisfies for compile-time safety on configuration objects
export const paymentPlans = {
  [PaymentPlanId.Hobby]: { id: PaymentPlanId.Hobby, effect: { kind: 'subscription' } },
  [PaymentPlanId.Pro]:   { id: PaymentPlanId.Pro,   effect: { kind: 'subscription' } },
} as const satisfies Record<PaymentPlanId, PaymentPlan>;
```

### ACL Design Template

```markdown
## Anti-Corruption Layer

### External Integration: [Service/Module Name]
- **Their model**: [How the external system represents data]
- **Our model**: [How our domain represents the same concept]
- **Port (interface)**: Defined in application layer — `src/modules/[module]/ports/[service].port.ts`
- **Adapter (implementation)**: Infrastructure layer — `src/modules/[module]/adapters/[external].adapter.ts`
- **Translation / Mapper**: Bidirectional mapping between external and domain models
- **Error translation**: External errors → Domain errors (never leak external error types)
- **Strategy pattern**: Used when multiple providers exist for same capability
```

### Mapper Interface (from domain-driven-hexagon)

Every module with domain objects should define a three-way mapper:

```typescript
export interface Mapper<DomainEntity, DbRecord, Response> {
  toPersistence(entity: DomainEntity): DbRecord;   // Domain → DB
  toDomain(record: DbRecord): DomainEntity;         // DB → Domain
  toResponse(entity: DomainEntity): Response;        // Domain → API Response (whitelist fields!)
}
```

**Why whitelisting in toResponse matters**: "Data returned to the user is whitelisted to avoid leaks. If a new property is added, like password or credit card number, it won't be returned unless you specifically allow this." — domain-driven-hexagon

---

## Step 5: Define Module Structure

Design the module's folder structure based on complexity (from domain-driven-hexagon vertical slicing):

### Simple CRUD Module
```
src/modules/[module]/
├── [module].types.ts            # DTOs + transformer functions
├── [module].validator.ts        # Zod schemas
├── [module].repository.ts       # Data access
├── [module].service.ts          # Application service
├── [module].controller.ts       # HTTP handlers
├── [module].routes.ts           # Route definitions
└── __tests__/
```

### Complex Domain Module (Vertical Slicing)
```
src/modules/[module]/
├── domain/                          # Domain layer (NO framework imports)
│   ├── [entity].entity.ts          # Aggregate root with behavior
│   ├── [entity].types.ts           # Domain props, enums
│   ├── [entity].errors.ts          # Domain-specific error types
│   ├── value-objects/
│   │   └── [vo].value-object.ts    # Self-validating value objects
│   └── events/
│       ├── [entity]-created.domain-event.ts
│       └── [entity]-status-changed.domain-event.ts
├── commands/                        # Write operations (vertical slices)
│   ├── create-[entity]/
│   │   ├── create-[entity].service.ts      # Command handler
│   │   ├── create-[entity].request.dto.ts  # Input validation
│   │   └── create-[entity].http.controller.ts
│   └── update-[entity]/
│       └── ...
├── queries/                         # Read operations (vertical slices)
│   └── find-[entities]/
│       ├── find-[entities].query-handler.ts
│       ├── find-[entities].request.dto.ts
│       └── find-[entities].http.controller.ts
├── database/
│   ├── [entity].repository.port.ts  # Repository interface (port)
│   └── [entity].repository.ts       # Prisma implementation (adapter)
├── adapters/                        # External service adapters (if needed)
├── [module].mapper.ts               # toPersistence / toDomain / toResponse
├── [module].types.ts                # Shared DTOs
├── [module].validator.ts            # Zod schemas
├── [module].routes.ts               # Route definitions (composition root)
└── __tests__/
```

---

## Step 6: Output the Design Document

Produce the design in the following structure within `docs/features/[feature-name]/`:

```
docs/features/[feature-name]/
├── FEATURE_PLAN.md        # Full design (API contracts, data models, flows)
├── FEATURE_TASKS.md       # Ordered implementation tasks
├── FEATURE_BUGS.md        # Bug tracking (initialized empty)
└── DOMAIN_MODEL.md        # DDD model (aggregates, entities, VOs, events)
```

### DOMAIN_MODEL.md Template

```markdown
# Domain Model: [Feature Name]

## Complexity Assessment
- **Level**: [Simple CRUD / Moderate / Complex]
- **Justification**: [Why this level was chosen]
- **Architecture depth**: [Plain DTOs / Domain Entity / Full DDD]

## Ubiquitous Language
| Term | Definition |
|------|-----------|
| ...  | ...       |

## Context Map
[From Step 1 — including module boundaries, relationships, communication strategy]

## Aggregates
[From Step 2.1 — including domain events emitted, commands, invariants]

## Entities
[From Step 2.2 — including behavior methods and validate() rules]

## Value Objects
[From Step 2.3 — including guard clauses and equality definition]

## Domain Events
[From Step 2.4 — including cross-module event flows]

## Use Cases (CQS)
[From Step 3 — separated into Commands and Queries]

## Mapper Design
- toPersistence: [Entity fields → DB columns mapping]
- toDomain: [DB record → Entity reconstitution, including Value Object creation]
- toResponse: [Entity → whitelisted API response DTO]

## Anti-Corruption Layer
[From Step 4 — including strategy interfaces and port/adapter locations]

## Module Structure
[From Step 5 — chosen folder layout based on complexity]
```

---

## Design Checklist

Before finalizing the design, verify:

- [ ] Complexity assessment is documented with justification
- [ ] Every Aggregate has a single root with clear invariants and `validate()` method
- [ ] No cross-aggregate references (only IDs)
- [ ] Value Objects replace primitives for composite values (not primitive obsession)
- [ ] Domain events are defined for all state transitions with metadata (correlationId)
- [ ] Cross-module events identified (e.g., EntityCreated → handler in another module)
- [ ] Use cases are separated into Commands (writes) and Queries (reads) — CQS
- [ ] Mapper design specified: toPersistence, toDomain, toResponse (whitelist!)
- [ ] Repository port (interface) defined for dependency inversion
- [ ] Ubiquitous language is consistent across all documents
- [ ] Boundaries are clear — no concept is owned by two modules
- [ ] Module internals are private — no direct imports between modules
- [ ] Database indexes are defined for all query patterns
- [ ] Permissions follow `resource:action` format
- [ ] Soft delete is the default unless explicitly overridden
- [ ] Strategy interfaces defined for external integrations (if applicable)
- [ ] Guard clauses specified for Value Object validation
- [ ] Module folder structure chosen (simple vs complex) based on assessment

---

## Rules

1. **Never split an Aggregate across modules** — If two entities must change together, they belong in the same Aggregate
2. **Prefer small Aggregates** — Large Aggregates create contention. Only group entities that share invariants. "You should be able to rewrite a module in a matter of days." — domain-driven-hexagon
3. **Reference other Aggregates by ID** — Never hold object references across Aggregate boundaries
4. **Domain Events over direct calls** — When modules need to react to changes in another module, use events: Command → Event → Command. Never Command → Command
5. **One transaction per Aggregate** — If a use case must modify multiple Aggregates, use eventual consistency via domain events
6. **Keep the domain model pure** — No framework imports, no HTTP, no database, no Prisma in domain entities. Domain layer is the innermost ring
7. **Dependencies point inward** — Infrastructure depends on Application depends on Domain. Never the reverse. Use ports (interfaces) at boundaries
8. **Modules are encapsulated** — Treat each module as a mini-application. Avoid importing from `../OtherModule`. Use events or a public facade
9. **Whitelist response data** — Use Mapper.toResponse() to explicitly select returned fields. Never blacklist (which leaks new fields by default)
10. **Validate at boundaries AND in domain** — Zod validates HTTP input format; Entity.validate() enforces business invariants. Both are needed
11. **Use exhaustive type checking** — For discriminated unions and enums, use `assertUnreachable()` or `satisfies Record<>` to catch unhandled cases at compile time
12. **Scale architecture to complexity** — Don't over-engineer CRUD modules with full DDD. Add domain objects only when business rules justify it
