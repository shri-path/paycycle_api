# Skill: Validation Schemas

> **Used by**: Dev Agent
> **When**: Creating Zod validation schemas for request input validation
> **Informed by**: [domain-driven-hexagon](https://github.com/Sairyss/domain-driven-hexagon), [clean-architecture](https://github.com/panagiop/node.js-clean-architecture), [open-saas](https://github.com/wasp-lang/open-saas)

You are implementing input validation schemas using Zod for a PayCycle API module. Validation is the first line of defense — all external input is validated before reaching the service layer.

---

## Core Principles

1. **Validate at the boundary** — All HTTP input is validated via Zod middleware
2. **Strict schemas** — Use `.strict()` on create/update schemas to reject unknown fields
3. **Passthrough for queries** — Use `.passthrough()` on query schemas (QueryBuilder params)
4. **Type inference** — Export `z.infer<>` types from schemas for compile-time safety
5. **Reusable field schemas** — Extract common field validations into shared schemas
6. **SafeParse for controlled error handling** — Use `safeParse` when you need custom error formatting (from open-saas)

---

## SafeParse Pattern (from open-saas)

For cases where you need controlled validation with custom error formatting:

```typescript
// src/common/utils/validation.ts

import { z } from 'zod';
import { BadRequestError } from '@/common/errors/app-error';

/**
 * Validate args against a Zod schema, throwing a BadRequestError with
 * prettified error message on failure (from open-saas ensureArgsSchemaOrThrowHttpError)
 */
export function ensureValidOrThrow<T extends z.ZodType>(
  schema: T,
  args: unknown,
): z.infer<T> {
  const result = schema.safeParse(args);
  if (!result.success) {
    const prettyError = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new BadRequestError(prettyError);
  }
  return result.data;
}

// Usage in service or controller:
const validatedInput = ensureValidOrThrow(create[Model]Schema, rawInput);
```

---

## Standard Validator File Template

```typescript
// src/modules/[module]/[module].validator.ts

import { z } from 'zod';

// ============================================================
// Reusable Field Schemas
// ============================================================

/**
 * BigInt ID parameter validation
 * IDs come as strings in URL params, validated as numeric strings
 */
const bigIntId = z.string().regex(/^\d+$/, 'Invalid ID format');

/**
 * Trimmed non-empty string with max length
 */
const requiredString = (maxLength: number, fieldName: string) =>
  z
    .string()
    .trim()
    .min(1, `${fieldName} is required`)
    .max(maxLength, `${fieldName} must be at most ${maxLength} characters`);

const optionalString = (maxLength: number, fieldName: string) =>
  z
    .string()
    .trim()
    .max(maxLength, `${fieldName} must be at most ${maxLength} characters`)
    .optional();

/**
 * Enum validation with custom error message
 */
const enumField = <T extends string>(values: readonly T[], fieldName: string) =>
  z.enum(values as [T, ...T[]], {
    errorMap: () => ({
      message: `${fieldName} must be one of: ${values.join(', ')}`,
    }),
  });

// ============================================================
// Path Parameter Schemas
// ============================================================

/**
 * Standard ID parameter schema
 * Used with: validate([model]ParamsSchema, 'params')
 */
export const [model]ParamsSchema = z.object({
  id: bigIntId,
});

export type [Model]Params = z.infer<typeof [model]ParamsSchema>;

// ============================================================
// Create Schema
// ============================================================

/**
 * Create [model] request body validation
 * .strict() rejects any fields not defined in the schema
 */
export const create[Model]Schema = z
  .object({
    name: requiredString(100, 'Name'),
    description: optionalString(500, 'Description'),
    status: enumField(['ACTIVE', 'INACTIVE'] as const, 'Status').optional().default('ACTIVE'),
    // Date fields
    startDate: z
      .string()
      .datetime({ message: 'Start date must be a valid ISO 8601 date' })
      .optional(),
    // Numeric fields
    amount: z
      .number()
      .positive('Amount must be positive')
      .multipleOf(0.01, 'Amount must have at most 2 decimal places')
      .optional(),
    // Email field
    email: z.string().email('Invalid email format').toLowerCase().trim().optional(),
    // Phone field
    phone: z
      .string()
      .regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone number format (E.164)')
      .optional(),
  })
  .strict();

export type Create[Model]Input = z.infer<typeof create[Model]Schema>;

// ============================================================
// Update Schema
// ============================================================

/**
 * Update [model] request body validation
 * All fields optional for partial updates
 * .strict() prevents unknown fields
 */
export const update[Model]Schema = z
  .object({
    name: requiredString(100, 'Name').optional(),
    description: optionalString(500, 'Description'),
    status: enumField(['ACTIVE', 'INACTIVE'] as const, 'Status').optional(),
    startDate: z
      .string()
      .datetime({ message: 'Start date must be a valid ISO 8601 date' })
      .optional(),
    amount: z
      .number()
      .positive('Amount must be positive')
      .multipleOf(0.01, 'Amount must have at most 2 decimal places')
      .optional(),
  })
  .strict();

export type Update[Model]Input = z.infer<typeof update[Model]Schema>;

// ============================================================
// Query Schema
// ============================================================

/**
 * List query parameter validation
 * .passthrough() allows QueryBuilder params (filter, sort, search, select)
 * Only validates explicit custom params here
 */
export const [model]QuerySchema = z
  .object({
    page: z.coerce.number().int().positive().optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  })
  .passthrough();

export type [Model]QueryParams = z.infer<typeof [model]QuerySchema>;

// ============================================================
// Bulk Operation Schemas
// ============================================================

/**
 * Bulk create validation
 * Max 100 items per request to prevent abuse
 */
export const bulkCreate[Model]Schema = z
  .object({
    items: z
      .array(create[Model]Schema)
      .min(1, 'At least one item is required')
      .max(100, 'Maximum 100 items per request'),
  })
  .strict();

export type BulkCreate[Model]Input = z.infer<typeof bulkCreate[Model]Schema>;

/**
 * Bulk update validation
 */
export const bulkUpdate[Model]Schema = z
  .object({
    items: z
      .array(
        z.object({
          id: bigIntId,
          ...update[Model]Schema.shape,
        }),
      )
      .min(1, 'At least one item is required')
      .max(100, 'Maximum 100 items per request'),
  })
  .strict();

// ============================================================
// Custom Validation Schemas (Action Endpoints)
// ============================================================

/**
 * Status transition validation
 * For endpoints like POST /api/v1/[resources]/:id/transition
 */
export const transition[Model]Schema = z
  .object({
    status: enumField(
      ['ACTIVE', 'INACTIVE', 'PROCESSING', 'COMPLETED', 'CANCELLED'] as const,
      'Status',
    ),
    reason: optionalString(500, 'Reason'),
  })
  .strict();
```

---

## Advanced Zod Patterns

### z.nativeEnum for Prisma Enums (from open-saas)

```typescript
import { [Model]Status } from '@prisma/client';

// Use z.nativeEnum to validate against Prisma-generated TypeScript enums
const statusSchema = z.nativeEnum([Model]Status, {
  errorMap: () => ({ message: 'Invalid status value' }),
});
```

### Discriminated Unions (from open-saas)

For request bodies with different shapes based on a type field:

```typescript
// Payment plan effect — different validation per kind
const paymentEffectSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('subscription'),
  }),
  z.object({
    kind: z.literal('credits'),
    amount: z.number().int().positive('Credit amount must be positive'),
  }),
  z.object({
    kind: z.literal('trial'),
    durationDays: z.number().int().min(1).max(90),
  }),
]);

// Notification preference schema
const notificationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('email'), email: z.string().email() }),
  z.object({ type: z.literal('sms'), phone: z.string().regex(/^\+?[1-9]\d{1,14}$/) }),
  z.object({ type: z.literal('webhook'), url: z.string().url() }),
]);
```

### Type-Safe Config with `satisfies` (from open-saas)

```typescript
// Ensure all enum values are covered in configuration
export const paymentPlans = {
  [PaymentPlanId.Hobby]: {
    id: PaymentPlanId.Hobby,
    effect: { kind: 'subscription' as const },
  },
  [PaymentPlanId.Pro]: {
    id: PaymentPlanId.Pro,
    effect: { kind: 'subscription' as const },
  },
} as const satisfies Record<PaymentPlanId, PaymentPlan>;
```

### Exhaustive Switch with `assertUnreachable` (from open-saas)

```typescript
/**
 * Compile-time exhaustiveness check for discriminated unions.
 * If a new variant is added to the union, TypeScript will error here.
 */
function assertUnreachable(x: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(x)}`);
}

// Usage:
function handleEffect(effect: PaymentPlanEffect): void {
  switch (effect.kind) {
    case 'subscription': return handleSubscription();
    case 'credits': return handleCredits(effect.amount);
    case 'trial': return handleTrial(effect.durationDays);
    default: assertUnreachable(effect); // Compile-time error if new kind added
  }
}
```

---

## Common Field Validation Patterns

### String Fields

```typescript
// Required, trimmed, with length bounds
name: z.string().trim().min(1).max(100)

// Optional string
description: z.string().trim().max(500).optional()

// Optional nullable (explicitly set to null)
notes: z.string().trim().max(1000).nullable().optional()
```

### Numeric Fields

```typescript
// Positive integer
quantity: z.number().int().positive()

// Decimal with precision
amount: z.number().positive().multipleOf(0.01)

// Range
percentage: z.number().min(0).max(100)

// Coerced from string (query params)
page: z.coerce.number().int().positive()
```

### Date Fields

```typescript
// ISO 8601 datetime string
startDate: z.string().datetime()

// Date only (no time)
birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format')

// Date object (from JSON)
processedAt: z.coerce.date()
```

### Enum Fields

```typescript
// String enum
status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED'])

// Prisma native enum (from open-saas)
status: z.nativeEnum(PayCycleStatus)

// With custom error
role: z.enum(['admin', 'manager', 'user'], {
  errorMap: () => ({ message: 'Role must be admin, manager, or user' }),
})
```

### Boolean Fields

```typescript
// Boolean
isActive: z.boolean()

// Coerced from string (query params)
includeDeleted: z.coerce.boolean().optional().default(false)
```

### Array Fields

```typescript
// Array of strings
tags: z.array(z.string().trim().min(1)).min(1).max(20)

// Array of IDs
employeeIds: z.array(z.string().regex(/^\d+$/)).min(1).max(100)
```

### Conditional Validation

```typescript
// Refine: Cross-field validation
const dateRangeSchema = z
  .object({
    startDate: z.string().datetime(),
    endDate: z.string().datetime(),
  })
  .refine((data) => new Date(data.endDate) > new Date(data.startDate), {
    message: 'End date must be after start date',
    path: ['endDate'],
  });

// Discriminated union: Different shapes based on a field
const notificationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('email'), email: z.string().email() }),
  z.object({ type: z.literal('sms'), phone: z.string() }),
]);
```

---

## Middleware Usage

Validators are applied in the route middleware chain:

```typescript
import { validate } from '@/infrastructure/middlewares/validate';

// Body validation
router.post('/', validate(createSchema, 'body'), controller.create);

// Params validation
router.get('/:id', validate(paramsSchema, 'params'), controller.getById);

// Query validation
router.get('/', validate(querySchema, 'query'), controller.list);

// Multiple validations on same route
router.patch(
  '/:id',
  validate(paramsSchema, 'params'),
  validate(updateSchema, 'body'),
  controller.update,
);
```

---

## Rules

1. **Every input field has a maximum length** — Prevent abuse
2. **Use `.strict()`** on create/update schemas — Reject unknown fields
3. **Use `.passthrough()`** on query schemas — Allow QueryBuilder params
4. **Strings are always `.trim()`med** — Remove whitespace
5. **Export inferred types** — `type X = z.infer<typeof xSchema>`
6. **Custom error messages** — On every field, clear and actionable
7. **Coerce query params** — Query params arrive as strings, use `z.coerce`
8. **Bulk operations** — Max 100 items per request
9. **Don't validate auth context** — vendorId, userId come from JWT, not request body
10. **Reuse field schemas** — Extract common patterns into helper functions
11. **Use `z.nativeEnum()` for Prisma enums** — Type-safe against generated types (from open-saas)
12. **Use discriminated unions for polymorphic inputs** — `z.discriminatedUnion('type', [...])` (from open-saas)
13. **Use `assertUnreachable()` for exhaustive switches** — Compile-time safety for discriminated unions (from open-saas)
14. **Use `safeParse` for controlled error formatting** — When you need custom error messages beyond Zod defaults (from open-saas)
