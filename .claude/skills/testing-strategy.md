# Skill: Testing Strategy

> **Used by**: Dev Agent
> **When**: Writing unit tests, integration tests, or test utilities for a module
> **Informed by**: [domain-driven-hexagon](https://github.com/Sairyss/domain-driven-hexagon), [clean-architecture](https://github.com/panagiop/node.js-clean-architecture), [open-saas](https://github.com/wasp-lang/open-saas)

You are writing tests for a PayCycle API module. Follow this skill to produce comprehensive, maintainable tests that validate business logic, API contracts, and edge cases.

---

## Test Pyramid

```
         ┌────────┐
         │  E2E   │  <- Few (critical user flows only)
         ├────────┤
         │ Integ. │  <- Some (API endpoint + middleware chain)
         ├────────┤
         │  Unit  │  <- Many (services, domain objects, utils)
         └────────┘
```

---

## File Structure

```
src/modules/[module]/
└── __tests__/
    ├── [module].service.test.ts      # Unit tests for service layer
    ├── [module].controller.test.ts   # Unit tests for controller (optional)
    └── domain/
        ├── [entity].entity.test.ts   # Domain entity tests (DDD)
        └── [value-object].vo.test.ts # Value object tests (DDD)

tests/integration/
└── [module].test.ts                  # Integration tests (API level)

tests/helpers/
├── factories.ts                      # Test data factories
└── setup.ts                          # Test configuration
```

---

## Unit Tests: Service Layer

### Template: `[module].service.test.ts`

```typescript
import { [Model]Service } from '../[model].service';
import { [Model]Repository } from '../[model].repository';
import { to[Model]Dto } from '../[model].types';
import { NotFoundError, ConflictError, BadRequestError } from '@/common/errors/app-error';
import { Logger } from 'pino';

// ============================================================
// Mocks
// ============================================================

// Mock the repository
jest.mock('../[model].repository');

// Create typed mock
const createMockRepository = (): jest.Mocked<[Model]Repository> => {
  return {
    findById: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
    hardDelete: jest.fn(),
    exists: jest.fn(),
    createMany: jest.fn(),
  } as unknown as jest.Mocked<[Model]Repository>;
};

// Mock logger (silent in tests)
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  child: jest.fn().mockReturnThis(),
} as unknown as Logger;

// ============================================================
// Test Data Factories
// ============================================================

const createMock[Model] = (overrides = {}) => ({
  id: BigInt(1),
  name: 'Test [Model]',
  description: 'Test description',
  status: 'ACTIVE',
  vendorId: BigInt(1),
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  deletedAt: null,
  ...overrides,
});

const createMockInput = (overrides = {}) => ({
  name: 'Test [Model]',
  description: 'Test description',
  ...overrides,
});

// ============================================================
// Test Suite
// ============================================================

describe('[Model]Service', () => {
  let service: [Model]Service;
  let mockRepo: jest.Mocked<[Model]Repository>;

  beforeEach(() => {
    // Fresh mocks for each test
    mockRepo = createMockRepository();
    service = new [Model]Service(mockRepo, mockLogger);
    jest.clearAllMocks();
  });

  // ----------------------------------------------------------
  // getById (Query)
  // ----------------------------------------------------------
  describe('getById', () => {
    it('should return DTO when entity exists', async () => {
      const entity = createMock[Model]();
      mockRepo.findById.mockResolvedValue(entity);

      const result = await service.getById(BigInt(1));

      expect(result).toEqual(to[Model]Dto(entity));
      expect(mockRepo.findById).toHaveBeenCalledWith(BigInt(1));
    });

    it('should throw NotFoundError when entity does not exist', async () => {
      mockRepo.findById.mockResolvedValue(null);

      await expect(service.getById(BigInt(999)))
        .rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError for wrong vendor (tenant isolation)', async () => {
      const entity = createMock[Model]({ vendorId: BigInt(2) });
      mockRepo.findById.mockResolvedValue(entity);

      await expect(service.getById(BigInt(1), BigInt(1)))
        .rejects.toThrow(NotFoundError);
    });
  });

  // ----------------------------------------------------------
  // create (Command)
  // ----------------------------------------------------------
  describe('create', () => {
    it('should create and return DTO', async () => {
      const input = createMockInput();
      const entity = createMock[Model]();

      mockRepo.exists.mockResolvedValue(false);
      mockRepo.create.mockResolvedValue(entity);

      const result = await service.create(input, BigInt(1), BigInt(1));

      expect(result).toEqual(to[Model]Dto(entity));
      expect(mockRepo.exists).toHaveBeenCalled();
      expect(mockRepo.create).toHaveBeenCalled();
    });

    it('should throw ConflictError on duplicate name', async () => {
      const input = createMockInput();
      mockRepo.exists.mockResolvedValue(true);

      await expect(service.create(input, BigInt(1), BigInt(1)))
        .rejects.toThrow(ConflictError);

      expect(mockRepo.create).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------
  // update (Command)
  // ----------------------------------------------------------
  describe('update', () => {
    it('should update and return DTO', async () => {
      const existing = createMock[Model]();
      const updated = createMock[Model]({ name: 'Updated Name' });

      mockRepo.findById.mockResolvedValue(existing);
      mockRepo.exists.mockResolvedValue(false);
      mockRepo.update.mockResolvedValue(updated);

      const result = await service.update(BigInt(1), { name: 'Updated Name' });

      expect(result.name).toBe('Updated Name');
    });

    it('should throw NotFoundError when entity does not exist', async () => {
      mockRepo.findById.mockResolvedValue(null);

      await expect(service.update(BigInt(999), { name: 'New' }))
        .rejects.toThrow(NotFoundError);
    });

    it('should throw ConflictError on name collision with another entity', async () => {
      const existing = createMock[Model]();
      mockRepo.findById.mockResolvedValue(existing);
      mockRepo.exists.mockResolvedValue(true); // Another entity has this name

      await expect(service.update(BigInt(1), { name: 'Taken Name' }))
        .rejects.toThrow(ConflictError);
    });
  });

  // ----------------------------------------------------------
  // delete (Command)
  // ----------------------------------------------------------
  describe('delete', () => {
    it('should soft delete by default', async () => {
      const entity = createMock[Model]();
      mockRepo.findById.mockResolvedValue(entity);
      mockRepo.softDelete.mockResolvedValue(entity);

      await service.delete(BigInt(1));

      expect(mockRepo.softDelete).toHaveBeenCalledWith(BigInt(1));
      expect(mockRepo.hardDelete).not.toHaveBeenCalled();
    });

    it('should hard delete when hard=true', async () => {
      const entity = createMock[Model]();
      mockRepo.findById.mockResolvedValue(entity);
      mockRepo.hardDelete.mockResolvedValue(entity);

      await service.delete(BigInt(1), true);

      expect(mockRepo.hardDelete).toHaveBeenCalledWith(BigInt(1));
    });

    it('should throw NotFoundError for non-existent entity', async () => {
      mockRepo.findById.mockResolvedValue(null);

      await expect(service.delete(BigInt(999)))
        .rejects.toThrow(NotFoundError);
    });
  });

  // ----------------------------------------------------------
  // list (Query)
  // ----------------------------------------------------------
  describe('list', () => {
    it('should return paginated list with meta', async () => {
      const entities = [createMock[Model](), createMock[Model]({ id: BigInt(2) })];
      mockRepo.findMany.mockResolvedValue(entities);
      mockRepo.count.mockResolvedValue(2);

      const result = await service.list({ page: '1', limit: '20' });

      expect(result.data).toHaveLength(2);
      expect(result.meta).toEqual(
        expect.objectContaining({
          page: 1,
          limit: 20,
          total: 2,
          totalPages: 1,
        }),
      );
    });

    it('should return empty list when no results', async () => {
      mockRepo.findMany.mockResolvedValue([]);
      mockRepo.count.mockResolvedValue(0);

      const result = await service.list({ page: '1', limit: '20' });

      expect(result.data).toHaveLength(0);
      expect(result.meta.total).toBe(0);
    });
  });
});
```

---

## Unit Tests: Domain Objects (from domain-driven-hexagon)

### Entity Tests

```typescript
describe('[Entity]', () => {
  describe('create (factory method)', () => {
    it('should create entity with valid props', () => {
      const entity = [Entity].create({
        name: 'Test',
        vendorId: BigInt(1),
      });

      expect(entity.getProps().name).toBe('Test');
      expect(entity.getProps().status).toBe([Entity]Status.DRAFT);
    });

    it('should emit domain event on creation', () => {
      const entity = [Entity].create({
        name: 'Test',
        vendorId: BigInt(1),
      });

      const events = entity.domainEvents;
      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf([Entity]CreatedDomainEvent);
    });

    it('should validate invariants on creation', () => {
      expect(() => [Entity].create({
        name: '',  // Empty name violates invariant
        vendorId: BigInt(1),
      })).toThrow('Name is required');
    });
  });

  describe('transitionTo', () => {
    it('should allow valid transitions', () => {
      const entity = [Entity].create({ name: 'Test', vendorId: BigInt(1) });
      entity.transitionTo([Entity]Status.ACTIVE);
      expect(entity.getProps().status).toBe([Entity]Status.ACTIVE);
    });

    it('should reject invalid transitions', () => {
      const entity = [Entity].create({ name: 'Test', vendorId: BigInt(1) });
      expect(() => entity.transitionTo([Entity]Status.COMPLETED))
        .toThrow('Cannot transition from DRAFT to COMPLETED');
    });
  });

  describe('equals', () => {
    it('should be equal when IDs match', () => {
      const entity1 = new [Entity]({ id: BigInt(1), props: { name: 'A' } });
      const entity2 = new [Entity]({ id: BigInt(1), props: { name: 'B' } });
      expect(entity1.equals(entity2)).toBe(true);
    });

    it('should not be equal when IDs differ', () => {
      const entity1 = new [Entity]({ id: BigInt(1), props: { name: 'A' } });
      const entity2 = new [Entity]({ id: BigInt(2), props: { name: 'A' } });
      expect(entity1.equals(entity2)).toBe(false);
    });
  });
});
```

### Value Object Tests (from domain-driven-hexagon)

```typescript
describe('Money', () => {
  it('should create with valid amount', () => {
    const money = Money.create(100.50, 'USD');
    expect(money.unpack().amount).toBe(100.50);
    expect(money.unpack().currency).toBe('USD');
  });

  it('should reject negative amounts', () => {
    expect(() => Money.create(-10, 'USD'))
      .toThrow('Amount cannot be negative');
  });

  it('should add same currency', () => {
    const a = Money.create(100, 'USD');
    const b = Money.create(50, 'USD');
    const result = a.add(b);
    expect(result.unpack().amount).toBe(150);
  });

  it('should reject adding different currencies', () => {
    const a = Money.create(100, 'USD');
    const b = Money.create(50, 'EUR');
    expect(() => a.add(b)).toThrow('Cannot add different currencies');
  });

  it('should compare by value equality (structural)', () => {
    const a = Money.create(100, 'USD');
    const b = Money.create(100, 'USD');
    expect(a.equals(b)).toBe(true);
  });

  it('should detect inequality by value', () => {
    const a = Money.create(100, 'USD');
    const b = Money.create(200, 'USD');
    expect(a.equals(b)).toBe(false);
  });
});

describe('Address', () => {
  it('should create with valid props', () => {
    const address = new Address({
      street: '123 Main St',
      city: 'Springfield',
      country: 'US',
      postalCode: '62701',
    });
    expect(address.unpack().city).toBe('Springfield');
  });

  it('should validate with Guard utility', () => {
    expect(() => new Address({
      street: '',  // Guard.isEmpty check fails
      city: 'Springfield',
      country: 'US',
      postalCode: '62701',
    })).toThrow('Street is required');
  });
});
```

### Mapper Tests (from domain-driven-hexagon)

```typescript
describe('[Entity]Mapper', () => {
  const mapper = new [Entity]Mapper();

  describe('toDomain', () => {
    it('should convert Prisma record to domain entity', () => {
      const record = createMock[Model]();
      const entity = mapper.toDomain(record);
      expect(entity).toBeInstanceOf([Entity]);
      expect(entity.getProps().name).toBe(record.name);
    });
  });

  describe('toPersistence', () => {
    it('should convert domain entity to Prisma record', () => {
      const entity = [Entity].create({ name: 'Test', vendorId: BigInt(1) });
      const record = mapper.toPersistence(entity);
      expect(record.name).toBe('Test');
    });
  });

  describe('toResponse', () => {
    it('should whitelist fields and serialize BigInt', () => {
      const entity = [Entity].create({ name: 'Test', vendorId: BigInt(1) });
      const dto = mapper.toResponse(entity);
      expect(typeof dto.id).toBe('string');
      expect(typeof dto.vendorId).toBe('string');
      expect(dto).not.toHaveProperty('deletedAt');
      expect(dto).not.toHaveProperty('passwordHash');
    });
  });
});
```

---

## Integration Tests: API Level

### Template: `tests/integration/[module].test.ts`

```typescript
import request from 'supertest';
import app from '../../src/app';

// Test auth tokens (from seed data or test setup)
let authToken: string;

beforeAll(async () => {
  // Login to get auth token
  const loginResponse = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'admin@paycycle.com', password: 'Admin@123' });
  
  authToken = loginResponse.body.data.tokens.accessToken;
});

describe('[Model] API', () => {
  let created[Model]Id: string;

  // ----------------------------------------------------------
  // POST /api/v1/[models]
  // ----------------------------------------------------------
  describe('POST /api/v1/[models]', () => {
    it('should create with valid input (201)', async () => {
      const response = await request(app)
        .post('/api/v1/[models]')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Integration Test [Model]',
          description: 'Created by integration test',
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.name).toBe('Integration Test [Model]');
      
      created[Model]Id = response.body.data.id;
    });

    it('should reject missing required fields (400)', async () => {
      const response = await request(app)
        .post('/api/v1/[models]')
        .set('Authorization', `Bearer ${authToken}`)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject without auth token (401)', async () => {
      const response = await request(app)
        .post('/api/v1/[models]')
        .send({ name: 'Test' });

      expect(response.status).toBe(401);
    });

    it('should reject duplicate name (409)', async () => {
      const response = await request(app)
        .post('/api/v1/[models]')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Integration Test [Model]', // Same name as above
        });

      expect(response.status).toBe(409);
    });

    it('should include correlationId in error response', async () => {
      const response = await request(app)
        .post('/api/v1/[models]')
        .set('Authorization', `Bearer ${authToken}`)
        .send({});

      expect(response.body.error.correlationId).toBeDefined();
    });
  });

  // ----------------------------------------------------------
  // GET /api/v1/[models]
  // ----------------------------------------------------------
  describe('GET /api/v1/[models]', () => {
    it('should return paginated list (200)', async () => {
      const response = await request(app)
        .get('/api/v1/[models]')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.meta).toEqual(
        expect.objectContaining({
          page: expect.any(Number),
          limit: expect.any(Number),
          total: expect.any(Number),
          totalPages: expect.any(Number),
        }),
      );
    });

    it('should support filtering', async () => {
      const response = await request(app)
        .get('/api/v1/[models]?filter[status][eq]=ACTIVE')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      response.body.data.forEach((item: any) => {
        expect(item.status).toBe('ACTIVE');
      });
    });

    it('should support pagination', async () => {
      const response = await request(app)
        .get('/api/v1/[models]?page=1&limit=5')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.length).toBeLessThanOrEqual(5);
    });
  });

  // ----------------------------------------------------------
  // GET /api/v1/[models]/:id
  // ----------------------------------------------------------
  describe('GET /api/v1/[models]/:id', () => {
    it('should return single item (200)', async () => {
      const response = await request(app)
        .get(`/api/v1/[models]/${created[Model]Id}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.id).toBe(created[Model]Id);
    });

    it('should return 404 for non-existent ID', async () => {
      const response = await request(app)
        .get('/api/v1/[models]/999999')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(404);
    });

    it('should not expose internal fields', async () => {
      const response = await request(app)
        .get(`/api/v1/[models]/${created[Model]Id}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.body.data).not.toHaveProperty('deletedAt');
      expect(response.body.data).not.toHaveProperty('passwordHash');
    });
  });

  // ----------------------------------------------------------
  // PATCH /api/v1/[models]/:id
  // ----------------------------------------------------------
  describe('PATCH /api/v1/[models]/:id', () => {
    it('should update with valid input (200)', async () => {
      const response = await request(app)
        .patch(`/api/v1/[models]/${created[Model]Id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ name: 'Updated Name' });

      expect(response.status).toBe(200);
      expect(response.body.data.name).toBe('Updated Name');
    });
  });

  // ----------------------------------------------------------
  // DELETE /api/v1/[models]/:id
  // ----------------------------------------------------------
  describe('DELETE /api/v1/[models]/:id', () => {
    it('should soft delete (204)', async () => {
      const response = await request(app)
        .delete(`/api/v1/[models]/${created[Model]Id}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(204);
    });

    it('should return 404 after soft delete', async () => {
      const response = await request(app)
        .get(`/api/v1/[models]/${created[Model]Id}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(404);
    });
  });
});
```

---

## Test Data Factories

### Basic Factory (from open-saas seed patterns)

```typescript
// tests/helpers/factories.ts

export const factory = {
  [model]: (overrides = {}) => ({
    id: BigInt(1),
    name: 'Test [Model]',
    description: 'Test description',
    status: 'ACTIVE',
    vendorId: BigInt(1),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  }),

  create[Model]Input: (overrides = {}) => ({
    name: 'Test [Model]',
    description: 'Test description',
    ...overrides,
  }),
};
```

### Factory with Faker (from open-saas dbSeeds pattern)

For integration tests that need realistic, unique test data:

```typescript
// tests/helpers/factories.ts

import { faker } from '@faker-js/faker';

export const fakerFactory = {
  [model]: (overrides = {}) => ({
    id: BigInt(faker.number.int({ min: 1, max: 999999 })),
    name: faker.company.name(),
    description: faker.lorem.sentence(),
    status: faker.helpers.arrayElement(['ACTIVE', 'INACTIVE']),
    vendorId: BigInt(1),
    email: faker.internet.email(),
    createdAt: faker.date.past(),
    updatedAt: faker.date.recent(),
    deletedAt: null,
    ...overrides,
  }),

  /**
   * Generate N unique test records
   */
  [model]List: (count: number, overrides = {}) =>
    Array.from({ length: count }, (_, i) => ({
      ...fakerFactory.[model]({ id: BigInt(i + 1) }),
      ...overrides,
    })),
};
```

---

## Logging Verification Tests

Every error/warning path must assert that the correct log level was called. This ensures no silent failures slip through.

```typescript
describe('create', () => {
  it('should warn and throw ConflictError on duplicate name', async () => {
    mockRepo.exists.mockResolvedValue(true);

    await expect(service.create(createMockInput(), BigInt(1), BigInt(1)))
      .rejects.toThrow(ConflictError);

    // warn must have been called before the throw
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ name: expect.any(String) }),
      expect.stringContaining('duplicate'),
    );
  });

  it('should error-log and throw InternalServerError on repository failure', async () => {
    mockRepo.exists.mockResolvedValue(false);
    mockRepo.create.mockRejectedValue(new Error('DB connection lost'));

    await expect(service.create(createMockInput(), BigInt(1), BigInt(1)))
      .rejects.toThrow(InternalServerError);

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.any(Error) }),
      expect.stringContaining('Failed to create'),
    );
  });

  it('should info-log only at entry, not on success', async () => {
    mockRepo.exists.mockResolvedValue(false);
    mockRepo.create.mockResolvedValue(createMock[Model]());

    await service.create(createMockInput(), BigInt(1), BigInt(1));

    // info called exactly once (entry / service propagation)
    expect(mockLogger.info).toHaveBeenCalledTimes(1);
    // no warn or error on happy path
    expect(mockLogger.warn).not.toHaveBeenCalled();
    expect(mockLogger.error).not.toHaveBeenCalled();
  });
});
```

---

## Cross-Module Event Testing (from domain-driven-hexagon)

Test that domain events trigger correct cross-module side effects:

```typescript
describe('Cross-module: UserCreated -> CreateWallet', () => {
  it('should create wallet when user is created', async () => {
    const userEntity = UserEntity.create({
      email: 'test@example.com',
      name: 'Test User',
    });

    // Simulate publishing domain events
    const handler = new CreateWalletWhenUserIsCreated(mockWalletRepo);
    const event = userEntity.domainEvents[0] as UserCreatedDomainEvent;

    await handler.handle(event);

    expect(mockWalletRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: userEntity.id,
      }),
    );
  });
});
```

---

## What to Test (Checklist per Module)

### Unit Tests (Service)
- [ ] **Happy path** for each CRUD operation (Commands and Queries)
- [ ] **NotFoundError** when entity doesn't exist
- [ ] **ConflictError** on duplicate creation
- [ ] **Multi-tenant isolation** — wrong vendorId = NotFoundError
- [ ] **State transition validation** — invalid transitions rejected
- [ ] **Business rules** — each rule tested individually
- [ ] **Pagination meta** — correct total, totalPages
- [ ] **Empty results** — list returns empty array, not error
- [ ] **`warn` logged before every business error** — verify `mockLogger.warn` was called with relevant context before each throw
- [ ] **`error` logged in every catch path** — verify `mockLogger.error` was called in infrastructure failure scenarios
- [ ] **`info` used only at entry / event propagation** — verify no `mockLogger.info` calls on success paths or completions

### Unit Tests (Domain Objects — from domain-driven-hexagon)
- [ ] **Entity creation** via factory method (`[Entity].create()`)
- [ ] **Domain event emission** on entity creation
- [ ] **Entity invariant validation** — invalid props rejected
- [ ] **Valid state transitions** accepted
- [ ] **Invalid state transitions** rejected
- [ ] **Entity equality** compared by ID
- [ ] **Value Object creation** with valid input
- [ ] **Value Object validation** with Guard utility
- [ ] **Value Object equality** compared by value (structural)
- [ ] **Value Object immutability** — operations return new instances
- [ ] **Mapper toDomain** — Prisma record to domain entity
- [ ] **Mapper toPersistence** — domain entity to Prisma record
- [ ] **Mapper toResponse** — whitelist, no internal fields leaked

### Integration Tests (API)
- [ ] **201** for successful create
- [ ] **200** for successful get, list, update
- [ ] **204** for successful delete
- [ ] **400** for validation errors
- [ ] **401** for missing auth
- [ ] **403** for insufficient permissions
- [ ] **404** for non-existent resources
- [ ] **409** for duplicates
- [ ] **Filtering** works correctly
- [ ] **Pagination** meta is accurate
- [ ] **Sorting** returns correct order
- [ ] **correlationId** present in error responses
- [ ] **No internal fields** exposed in responses (whitelist check)
- [ ] **Middleware chain** executes in order (authenticate -> authorize -> validate)
- [ ] **Error log written on 4xx/5xx** — verify log file entry exists with correlationId (where file logging is active)

---

## Rules

1. **Test behavior, not implementation** — Test what the service does, not how
2. **One assertion per test ideally** — Keep tests focused
3. **Descriptive test names** — `should throw NotFoundError when entity does not exist`
4. **Fresh mocks per test** — `jest.clearAllMocks()` in `beforeEach`
5. **Factory functions for test data** — Consistent, overridable
6. **No testing of private methods** — Test through public API
7. **Mock at the boundary** — Mock repositories in service tests, not internal functions
8. **Domain objects need no mocks** — They're pure logic, test directly
9. **Integration tests use real middleware chain** — Auth, validation, error handling
10. **Clean up after integration tests** — Delete created test data
11. **Test domain events** — Verify event emission and cross-module handler behavior (from domain-driven-hexagon)
12. **Test mapper whitelist** — Verify no internal fields leak in toResponse (from domain-driven-hexagon)
13. **Use faker for integration test data** — Unique, realistic data prevents test collisions (from open-saas)
14. **Classify tests as Command or Query** — Mirror CQS classification in test suite organization
15. **Assert `warn` before every business error throw** — Each test that expects a thrown error must also assert `mockLogger.warn` was called with matching context
16. **Assert `error` in every catch path test** — Tests for infrastructure failures must assert `mockLogger.error` was called
17. **Assert `info` called exactly at entry (and event propagation)** — Verify no extraneous `info` calls on success or completion paths
