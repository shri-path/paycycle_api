# Skill: Error Handling

> **Used by**: Dev Agent
> **When**: Implementing error handling across all layers of a module
> **Informed by**: [domain-driven-hexagon](https://github.com/Sairyss/domain-driven-hexagon), [clean-architecture](https://github.com/panagiop/node.js-clean-architecture), [open-saas](https://github.com/wasp-lang/open-saas)

You are implementing error handling for a PayCycle API module. The project uses a centralized error handling strategy with custom error classes, ensuring consistent error responses across all endpoints.

---

## Error Architecture

```
┌──────────────────────────────────────────────┐
│  Controller: try/catch -> next(error)         │
├──────────────────────────────────────────────┤
│  Error Handler Middleware (centralized)       │
│  - Detects error type                        │
│  - Formats response with correlationId       │
│  - Logs with context                         │
│  - Hides internals in production             │
├──────────────────────────────────────────────┤
│  Client receives:                            │
│  { success: false, error: {                  │
│    code, message, correlationId, details     │
│  }}                                          │
└──────────────────────────────────────────────┘
```

---

## Error Class Hierarchy (from domain-driven-hexagon)

All custom errors extend `ExceptionBase` which provides structured error data:

```typescript
// src/common/errors/exception.base.ts (from domain-driven-hexagon ExceptionBase)

export abstract class ExceptionBase extends Error {
  abstract code: string;
  abstract httpStatus: number;

  /**
   * Correlation ID for request tracing across services
   */
  readonly correlationId: string;

  constructor(
    readonly message: string,
    readonly cause?: Error,
    readonly metadata?: Record<string, unknown>,
  ) {
    super(message);
    this.correlationId = ''; // Set by error handler middleware from request context
  }

  /**
   * Structured JSON serialization for logging and API responses
   */
  toJSON() {
    return {
      code: this.code,
      message: this.message,
      correlationId: this.correlationId,
      cause: this.cause?.message,
      metadata: this.metadata,
      stack: this.stack,
    };
  }
}
```

### Concrete Error Classes

```typescript
import {
  AppError,
  BadRequestError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  UnprocessableError,
  TooManyRequestsError,
  InternalServerError,
  ServiceUnavailableError,
} from '@/common/errors/app-error';
```

| Error Class              | HTTP Status | Code                 | When to Use                                         |
|-------------------------|-------------|----------------------|-----------------------------------------------------|
| `BadRequestError`       | 400         | BAD_REQUEST          | Malformed request, invalid format                    |
| `ValidationError`       | 400         | VALIDATION_ERROR     | Zod schema validation failure                        |
| `UnauthorizedError`     | 401         | UNAUTHORIZED         | Missing/invalid/expired JWT token                    |
| `ForbiddenError`        | 403         | FORBIDDEN            | Valid token but insufficient permissions             |
| `NotFoundError`         | 404         | NOT_FOUND            | Resource doesn't exist or is soft-deleted            |
| `ConflictError`         | 409         | CONFLICT             | Duplicate resource, optimistic concurrency failure   |
| `UnprocessableError`    | 422         | UNPROCESSABLE_ENTITY | Valid input but violates business rule                |
| `TooManyRequestsError`  | 429         | TOO_MANY_REQUESTS    | Rate limit exceeded                                  |
| `InternalServerError`   | 500         | INTERNAL_ERROR       | Unexpected server error                              |
| `ServiceUnavailableError`| 503        | SERVICE_UNAVAILABLE  | External service down, DB unavailable                |

### Domain-Specific Errors (from domain-driven-hexagon)

For domain-level errors that don't map to HTTP:

```typescript
// src/common/errors/domain-exceptions.ts

import { ExceptionBase } from './exception.base';

/**
 * Argument is structurally valid but semantically invalid
 */
export class ArgumentInvalidException extends ExceptionBase {
  readonly code = 'ARGUMENT_INVALID';
  readonly httpStatus = 400;
}

/**
 * A required argument was not provided
 */
export class ArgumentNotProvidedException extends ExceptionBase {
  readonly code = 'ARGUMENT_NOT_PROVIDED';
  readonly httpStatus = 400;
}

/**
 * Domain object state is out of range (e.g., negative balance)
 */
export class ArgumentOutOfRangeException extends ExceptionBase {
  readonly code = 'ARGUMENT_OUT_OF_RANGE';
  readonly httpStatus = 400;
}
```

---

## Unhandled Webhook Event Error (from open-saas)

For webhook handlers that receive unknown event types:

```typescript
// src/common/errors/webhook-errors.ts

export class UnhandledWebhookEventError extends Error {
  constructor(public readonly eventType: string) {
    super(`Unhandled webhook event type: ${eventType}`);
  }
}

// Usage in webhook handler:
default:
  if (process.env.NODE_ENV === 'production') {
    logger.error({ eventType: event.type }, 'Unhandled webhook event');
  } else {
    logger.info({ eventType: event.type }, 'Unhandled webhook event (dev)');
  }
  // ALWAYS return 2XX — never throw, prevents retry storms
```

---

## Usage by Layer

### Controller Layer (from clean-architecture)

Every controller method wraps in try/catch and delegates to `next(error)`:

```typescript
class [Model]Controller {
  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await this.service.create(req.body);
      sendCreated(res, result);
    } catch (error) {
      next(error); // Always pass to centralized error handler
    }
  };
}
```

**Rules for controllers:**
- Never catch and handle errors yourself (except to add context)
- Never send error responses directly
- Always call `next(error)`

### Service Layer

Throw specific error classes based on the business rule violated:

```typescript
class [Model]Service {
  async getById(id: bigint): Promise<[Model]Dto> {
    const entity = await this.repository.findById(id);
    
    // 404: Resource not found
    if (!entity) {
      throw new NotFoundError('[Model] not found');
    }
    
    return to[Model]Dto(entity);
  }

  async create(input: Create[Model]Input): Promise<[Model]Dto> {
    // 409: Duplicate resource
    const exists = await this.repository.exists({ name: input.name });
    if (exists) {
      throw new ConflictError('[Model] with this name already exists');
    }
    
    // 422: Business rule violation
    if (input.startDate && new Date(input.startDate) < new Date()) {
      throw new UnprocessableError('Start date cannot be in the past');
    }
    
    // 400: Invalid state
    if (!this.isValidTransition(currentStatus, input.status)) {
      throw new BadRequestError(
        `Cannot transition from ${currentStatus} to ${input.status}`
      );
    }

    return to[Model]Dto(await this.repository.create(data));
  }
}
```

### Repository Layer

Repositories should NOT throw business errors. Catch Prisma-specific errors and translate to domain errors:

```typescript
class [Model]Repository {
  async findById(id: bigint): Promise<[Model] | null> {
    // Return null, let service decide if this is an error
    return this.getClient().findFirst({
      where: { id, deletedAt: null },
    });
  }
  
  async create(data: Prisma.[Model]CreateInput): Promise<[Model]> {
    try {
      return await this.getClient().create({ data });
    } catch (error: unknown) {
      // Translate Prisma P2002 unique constraint violation to ConflictError
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('Record already exists');
      }
      throw error; // Let other errors bubble up
    }
  }
}
```

### Domain Entity Layer (from domain-driven-hexagon)

Domain entities throw domain-specific exceptions for invariant violations:

```typescript
class WalletEntity extends AggregateRoot {
  withdraw(amount: number): void {
    if (this.props.balance - amount < 0) {
      throw new ArgumentOutOfRangeException(
        'Cannot withdraw: insufficient balance',
      );
    }
    this.props.balance -= amount;
  }
}
```

---

## Error Response Format

All errors return this consistent format with correlationId (from domain-driven-hexagon):

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "User not found",
    "correlationId": "req-abc123-def456",
    "details": null,
    "subErrors": []
  }
}
```

For validation errors, `details` includes per-field errors:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input data",
    "correlationId": "req-abc123-def456",
    "details": [
      {
        "field": "email",
        "message": "Invalid email format"
      },
      {
        "field": "name",
        "message": "Name is required"
      }
    ]
  }
}
```

---

## Centralized Error Handler Middleware (from clean-architecture)

```typescript
// src/infrastructure/middlewares/error-handler.ts

import { Request, Response, NextFunction } from 'express';
import { AppError } from '@/common/errors/app-error';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';

export function errorHandler(
  error: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const correlationId = req.headers['x-correlation-id'] as string || req.id;

  // Known application errors
  if (error instanceof AppError) {
    res.status(error.httpStatus).json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        correlationId,
        details: error.metadata ?? null,
      },
    });
    return;
  }

  // Zod validation errors
  if (error instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid input data',
        correlationId,
        details: error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
    return;
  }

  // Prisma errors
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // Handle at repository level preferably, but catch stragglers here
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: process.env.NODE_ENV === 'production'
          ? 'An unexpected error occurred'
          : error.message,
        correlationId,
        details: null,
      },
    });
    return;
  }

  // Unknown errors — hide details in production
  logger.error({ error, correlationId }, 'Unhandled error');
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: process.env.NODE_ENV === 'production'
        ? 'An unexpected error occurred'
        : error.message,
      correlationId,
      details: null,
    },
  });
}
```

---

## Common Error Patterns

### Pattern 1: Existence Check + Not Found

```typescript
const entity = await this.repository.findById(id);
if (!entity) {
  throw new NotFoundError('[Model] not found');
}
```

### Pattern 2: Multi-Tenant Isolation (Mask as NotFound)

```typescript
const entity = await this.repository.findById(id);
if (!entity || entity.vendorId !== vendorId) {
  // Don't reveal existence to other tenants
  throw new NotFoundError('[Model] not found');
}
```

### Pattern 3: Uniqueness Check

```typescript
const exists = await this.repository.exists({
  name: input.name,
  vendorId,
  id: { not: currentId }, // Exclude self on update
});
if (exists) {
  throw new ConflictError('[Model] with this name already exists');
}
```

### Pattern 4: State Transition Validation

```typescript
const VALID_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['COMPLETED', 'FAILED'],
};

const allowed = VALID_TRANSITIONS[entity.status] || [];
if (!allowed.includes(newStatus)) {
  throw new BadRequestError(
    `Cannot transition from '${entity.status}' to '${newStatus}'. ` +
    `Allowed transitions: ${allowed.join(', ') || 'none (terminal state)'}`
  );
}
```

### Pattern 5: Transaction Error Handling

```typescript
try {
  await prisma.$transaction(async (tx) => {
    // Multiple operations...
    // If any throw, entire transaction rolls back
  });
} catch (error) {
  if (error instanceof AppError) throw error; // Re-throw business errors
  this.logger.error({ error }, 'Transaction failed');
  throw new InternalServerError('Operation failed, please try again');
}
```

### Pattern 6: External Service Error

```typescript
try {
  const result = await externalService.call(data);
  return result;
} catch (error) {
  this.logger.error({ error }, 'External service call failed');
  throw new ServiceUnavailableError('Payment service is temporarily unavailable');
}
```

### Pattern 7: Guard Utility (from domain-driven-hexagon)

For domain-level argument validation in entities and value objects:

```typescript
// src/common/utils/guard.ts
export class Guard {
  static isEmpty(value: unknown): boolean {
    if (typeof value === 'number' || typeof value === 'boolean') return false;
    if (typeof value === 'undefined' || value === null) return true;
    if (value instanceof Date) return false;
    if (typeof value === 'string' && value.trim() === '') return true;
    if (Array.isArray(value) && value.length === 0) return true;
    if (typeof value === 'object' && Object.keys(value).length === 0) return true;
    return false;
  }

  static lengthIsBetween(value: string | unknown[], min: number, max: number): boolean {
    return value.length >= min && value.length <= max;
  }
}

// Usage in Value Object:
if (Guard.isEmpty(props.street)) {
  throw new ArgumentNotProvidedException('Street is required');
}
if (!Guard.lengthIsBetween(props.country, 2, 50)) {
  throw new ArgumentOutOfRangeException('Country must be between 2 and 50 chars');
}
```

---

## Error Logging

### What to Log

```typescript
// Service layer: log business-context errors as warnings
this.logger.warn({ id, status: entity.status, attemptedStatus: newStatus }, 
  'Invalid state transition attempted');

// Service layer: log unexpected errors as errors
this.logger.error({ error, id }, 'Failed to process [model]');

// Never log: passwords, tokens, full request bodies with sensitive data
```

### Log Levels for Errors

| Error Type           | Log Level | Rationale                              |
|---------------------|-----------|----------------------------------------|
| ValidationError     | debug     | Expected, client's problem             |
| NotFoundError       | debug     | Expected, normal flow                  |
| UnauthorizedError   | warn      | Could indicate attack                  |
| ForbiddenError      | warn      | Could indicate privilege escalation    |
| ConflictError       | info      | Business conflict, normal flow         |
| BadRequestError     | debug     | Expected, client's problem             |
| InternalServerError | error     | Unexpected, needs investigation        |
| ServiceUnavailable  | error     | External dependency failure            |

---

## Rules

1. **Never swallow errors** — Every catch block must re-throw or call `next(error)`
2. **Never send raw error messages in production** — Use generic messages for 500s
3. **Use specific error classes** — Not generic `Error` or `AppError`
4. **Error messages are user-facing** — Clear, actionable, no stack traces
5. **Log with context** — Include entity ID, operation, relevant fields
6. **Multi-tenant: mask as NotFound** — Never reveal data existence to wrong tenant
7. **Transaction errors: re-throw AppError** — Don't wrap business errors in generic errors
8. **Validation errors at boundary only** — Don't re-validate in services what Zod already checked
9. **Don't catch errors you can't handle** — Let them bubble to the centralized handler
10. **Consistent error codes** — Use the codes from the error hierarchy, don't invent new ones
11. **Include correlationId in all error responses** — For request tracing across services (from domain-driven-hexagon)
12. **Use ExceptionBase.toJSON() for structured logging** — Consistent error serialization (from domain-driven-hexagon)
13. **Use Guard utility in domain entities** — For argument validation in entities/VOs (from domain-driven-hexagon)
14. **Catch P2002 at repository level** — Translate Prisma unique constraint violations to ConflictError
15. **Never throw in webhook handlers** — Return 2XX for unhandled events to prevent retry storms (from open-saas)
