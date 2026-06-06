# Skill: API Contract Design

> **Used by**: Architect Agent
> **When**: Designing REST API endpoints for a new feature or module
> **Informed by**: [domain-driven-hexagon](https://github.com/Sairyss/domain-driven-hexagon), [clean-architecture](https://github.com/panagiop/node.js-clean-architecture), [open-saas](https://github.com/wasp-lang/open-saas)

You are designing REST API contracts for the PayCycle API. Every endpoint must be production-grade, consistent with existing patterns, and follow REST best practices.

---

## Step 1: Resource Identification

Identify the REST resources from the domain model:

```markdown
## Resources

| Resource     | Base Path             | Aggregate Root | Module         |
|-------------|----------------------|----------------|----------------|
| [Name]      | /api/v1/[plural]     | [Entity]       | [module-name]  |
```

### Naming Rules
- Resource paths are **plural nouns** in **kebab-case**: `/api/v1/pay-cycles`, `/api/v1/vendor-users`
- Nested resources for owned relationships: `/api/v1/vendors/:vendorId/users`
- Actions that don't map to CRUD use **verb sub-resources**: `POST /api/v1/orders/:id/cancel`
- Query-heavy reads use `GET` with query params, NOT `POST` with body filters

### CQS Classification (from domain-driven-hexagon)

Classify every endpoint as a **Command** (state-changing) or **Query** (data retrieval):

| HTTP Method | CQS Type | Returns | Side Effects |
|------------|----------|---------|-------------|
| GET        | Query    | Data    | None        |
| POST       | Command  | ID/void | Yes (create)|
| PATCH      | Command  | ID/void | Yes (update)|
| DELETE     | Command  | void    | Yes (delete)|

### Controller Organization (from clean-architecture)

For **complex modules**, consider controller-per-use-case (vertical slicing):
```typescript
// Routes file acts as the Composition Root — wire all dependencies here
const repository = new [Model]Repository();
const service = new [Model]Service(repository, logger);
const controller = new [Model]Controller(service);
```

---

## Step 2: Define Endpoints

For each resource, define the standard CRUD operations plus any custom actions:

### Standard CRUD Template

```markdown
### [Resource Name] Endpoints

#### GET /api/v1/[resources]
- **Description**: List [resources] with pagination, filtering, sorting
- **Auth**: Required
- **Permission**: `[resource]:read`
- **Query Params**: Standard query builder (page, limit, sort, filter, search, select)
- **Allowed Filter Fields**: [field1, field2, ...]
- **Allowed Sort Fields**: [field1, field2, ...]
- **Allowed Select Fields**: [field1, field2, ...]
- **Searchable Fields**: [field1, field2, ...]
- **Response**: 200
  ```json
  {
    "success": true,
    "data": [{ ... }],
    "meta": { "page": 1, "limit": 20, "total": 100, "totalPages": 5 }
  }
  ```

#### GET /api/v1/[resources]/:id
- **Description**: Get single [resource] by ID
- **Auth**: Required
- **Permission**: `[resource]:read`
- **Path Params**: `id` (BigInt)
- **Response**: 200
  ```json
  {
    "success": true,
    "data": { ... }
  }
  ```
- **Errors**: 404 NotFoundError

#### POST /api/v1/[resources]
- **Description**: Create new [resource]
- **Auth**: Required
- **Permission**: `[resource]:create`
- **Request Body**:
  ```json
  {
    "field1": "value",
    "field2": "value"
  }
  ```
- **Validation**: [List Zod rules — required, min, max, format, etc.]
- **Response**: 201
- **Errors**: 400 ValidationError, 409 ConflictError

#### PATCH /api/v1/[resources]/:id
- **Description**: Partially update [resource]
- **Auth**: Required
- **Permission**: `[resource]:update`
- **Request Body**: Same as create but all fields optional
- **Response**: 200
- **Errors**: 404 NotFoundError, 409 ConflictError

#### DELETE /api/v1/[resources]/:id
- **Description**: Soft delete [resource]
- **Auth**: Required
- **Permission**: `[resource]:delete`
- **Query Params**: `hard=true` for permanent delete (admin only)
- **Response**: 204 No Content
- **Errors**: 404 NotFoundError
```

### Bulk Operations Template

```markdown
#### POST /api/v1/[resources]/bulk
- **Description**: Bulk create [resources]
- **Auth**: Required
- **Permission**: `[resource]:create`
- **Request Body**:
  ```json
  {
    "items": [{ ... }, { ... }]
  }
  ```
- **Validation**: Max 100 items per request
- **Response**: 201
  ```json
  {
    "success": true,
    "data": {
      "created": 10,
      "items": [{ ... }]
    }
  }
  ```

#### PATCH /api/v1/[resources]/bulk
- **Description**: Bulk update [resources]
- **Auth**: Required
- **Permission**: `[resource]:update`
- **Request Body**:
  ```json
  {
    "items": [{ "id": "1", "field": "value" }, ...]
  }
  ```
- **Response**: 200
```

---

### Webhook Endpoint Template (from open-saas)

```markdown
#### POST /api/v1/webhooks/[provider]
- **Description**: Handle [provider] webhook events
- **Auth**: Signature verification (NOT JWT — use provider's signing secret)
- **Middleware**: Raw body parser (not JSON), custom signature verification
- **Request**: Raw body + signature header
- **Event Handling**:
  ```typescript
  switch (event.type) {
    case 'invoice.paid': await handleInvoicePaid(event); break;
    case 'subscription.updated': await handleSubscriptionUpdated(event); break;
    default: throw new UnhandledWebhookEventError(event.type);
  }
  ```
- **Response**: 204 No Content (always return 2XX to prevent retries)
- **Unhandled events**: Log and return 204 (NOT an error — prevents retry storms)
- **Idempotency**: Use event ID from provider to deduplicate
- **Environment handling**: `development` → console.info, `production` → console.error for unhandled events
```

---

## Step 3: Request/Response DTO Design

### Input DTO Rules
1. **Create DTOs** — Include all required fields, optional fields with defaults
2. **Update DTOs** — Same as Create but ALL fields optional (partial update)
3. **Query DTOs** — Standard query builder params
4. **Params DTOs** — Path params (id validation)

### Output DTO Rules
1. **Never expose internal fields** — No `deletedAt`, no `passwordHash`, no internal IDs unless needed
2. **Always transform** — Use `toDto()` functions, never return raw Prisma entities
3. **Consistent date format** — ISO 8601 strings
4. **BigInt IDs as strings** — Serialize BigInt to string in JSON responses
5. **Nested objects** — Include related data only when explicitly requested or necessary

### Response Base Pattern (from domain-driven-hexagon)

All response DTOs extend a common base with standard fields:

```typescript
interface ResponseBase {
  id: string;
  createdAt: string;  // ISO 8601
  updatedAt: string;  // ISO 8601
}
```

### Error Response with Correlation ID (from domain-driven-hexagon)

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "User not found",
    "correlationId": "req-abc123",
    "details": null,
    "subErrors": []
  }
}
```

### DTO Naming Convention
```
Create[Resource]Input   — POST body
Update[Resource]Input   — PATCH body
[Resource]Dto          — Response output (extends ResponseBase)
[Resource]ListDto      — List response item (may have fewer fields)
[Resource]QueryParams  — GET query parameters
[Resource]Params       — Path parameters
```

---

## Step 4: Error Contract

Every endpoint must document its error responses:

```markdown
### Error Responses

| Status | Error Code         | When                              | Example Message                    |
|--------|-------------------|-----------------------------------|------------------------------------|
| 400    | BAD_REQUEST       | Invalid input format              | "Invalid date format"              |
| 400    | VALIDATION_ERROR  | Schema validation fails           | "Field 'email' is required"        |
| 401    | UNAUTHORIZED      | Missing/invalid token             | "Authentication required"          |
| 403    | FORBIDDEN         | Insufficient permissions          | "Permission denied: resource:read" |
| 404    | NOT_FOUND         | Resource doesn't exist            | "[Resource] not found"             |
| 409    | CONFLICT          | Duplicate or state conflict       | "[Resource] already exists"        |
| 422    | UNPROCESSABLE     | Valid input but business rule fail | "Cannot archive active [resource]" |
| 429    | TOO_MANY_REQUESTS | Rate limit exceeded               | "Too many requests"                |
```

---

## Step 5: Pagination & Filtering Contract

All list endpoints MUST support the standard query builder:

```markdown
### Query Builder Support

| Feature    | Parameter              | Example                                  |
|-----------|------------------------|------------------------------------------|
| Pagination | page, limit           | ?page=2&limit=20                         |
| Sorting    | sort[]                | ?sort[]=-createdAt&sort[]=name           |
| Selection  | select[]              | ?select[]=id&select[]=name               |
| Filter EQ  | filter[field][eq]     | ?filter[status][eq]=ACTIVE               |
| Filter NE  | filter[field][ne]     | ?filter[status][ne]=DELETED              |
| Filter GT  | filter[field][gt]     | ?filter[amount][gt]=100                  |
| Filter LT  | filter[field][lt]     | ?filter[amount][lt]=1000                 |
| Filter IN  | filter[field][in]     | ?filter[role][in]=admin,manager          |
| Filter LIKE| filter[field][like]   | ?filter[name][like]=john                 |
| Search     | search[query/fields]  | ?search[query]=john&search[fields][]=name|
| Logical    | filter[AND/OR/NOT]    | Complex logical grouping                 |
```

---

## Step 6: Idempotency & Safety

Classify each endpoint:

| Method | Safe | Idempotent | Notes                                              |
|--------|------|------------|----------------------------------------------------|
| GET    | Yes  | Yes        | No side effects                                    |
| POST   | No   | No         | Use idempotency keys for payment/critical mutations |
| PATCH  | No   | Yes        | Same update applied twice = same result             |
| DELETE | No   | Yes        | Deleting already-deleted resource = 204             |

For non-idempotent mutations on critical paths, require an `Idempotency-Key` header:

```markdown
### Idempotency
- **Header**: `X-Idempotency-Key: <uuid>`
- **Storage**: Cache response for 24h keyed by (userId, idempotencyKey, endpoint)
- **Behavior**: If duplicate key detected, return cached response
- **Required for**: Payment processing, order creation, bulk operations
```

---

## Step 7: Versioning & Deprecation

```markdown
### API Version: v1
- Base path: /api/v1/
- When introducing breaking changes, create v2 endpoints
- Maintain v1 for minimum 6 months after v2 release
- Add `Sunset` and `Deprecation` headers to deprecated endpoints
```

---

## Step 8: Security Considerations

For each endpoint, document:

```markdown
### Security Matrix

| Endpoint                    | Auth | Permission          | Rate Limit | Notes                        |
|----------------------------|------|---------------------|------------|------------------------------|
| GET /api/v1/resources      | Yes  | resource:read       | 100/15min  | Filtered by vendor context   |
| POST /api/v1/resources     | Yes  | resource:create     | 50/15min   | Validate ownership           |
| PATCH /api/v1/resources/:id| Yes  | resource:update     | 50/15min   | Owner or admin only          |
| DELETE /api/v1/resources/:id| Yes | resource:delete     | 20/15min   | Admin only for hard delete   |
```

### Data Access Rules
1. **Multi-tenant isolation** — Users can only access resources within their vendor context
2. **Row-level security** — Filter queries by `vendorId` from JWT claims
3. **Field-level security** — Sensitive fields (salary, SSN) require elevated permissions
4. **Audit trail** — All mutations logged to AuditLog with userId, action, before/after

---

## Step 9: Type-Safe Patterns for External Integrations (from open-saas)

### Strategy Pattern for External Services

When the same capability has multiple provider options (payments, email, SMS):

```typescript
// Define a processor interface — your domain's contract
export interface PaymentProcessor {
  id: 'stripe' | 'razorpay' | 'lemonsqueezy';
  createCheckoutSession: (args: CheckoutArgs) => Promise<{ session: Session }>;
  fetchCustomerPortalUrl: (args: PortalArgs) => Promise<string | null>;
  webhook: WebhookHandler;
  fetchTotalRevenue: () => Promise<number>;
}

// Select implementation at composition root
export const paymentProcessor: PaymentProcessor = stripePaymentProcessor;
```

### Type-Safe Enum Configuration with `satisfies`

```typescript
export const paymentPlans = {
  [PaymentPlanId.Hobby]: { id: PaymentPlanId.Hobby, effect: { kind: 'subscription' } },
  [PaymentPlanId.Pro]:   { id: PaymentPlanId.Pro, effect: { kind: 'subscription' } },
} as const satisfies Record<PaymentPlanId, PaymentPlan>;
```

### Discriminated Unions for Domain Effects

```typescript
export type PaymentPlanEffect =
  | { kind: 'subscription' }
  | { kind: 'credits'; amount: number }
  | { kind: 'trial'; durationDays: number };
```

### Exhaustive Switch with `assertUnreachable`

```typescript
function handleEffect(effect: PaymentPlanEffect): void {
  switch (effect.kind) {
    case 'subscription': return handleSubscription();
    case 'credits': return handleCredits(effect.amount);
    case 'trial': return handleTrial(effect.durationDays);
    default: assertUnreachable(effect); // Compile-time error if new kind added
  }
}

function assertUnreachable(x: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(x)}`);
}
```

---

## Output Checklist

Before finalizing the API contract:

- [ ] All endpoints follow RESTful conventions (plural nouns, proper HTTP methods)
- [ ] Response format is consistent: `{ success, data, meta?, error? }`
- [ ] Every endpoint has Auth, Permission, Rate Limit defined
- [ ] Input validation rules are exhaustive (type, min, max, format, enum)
- [ ] Error responses cover all failure scenarios
- [ ] Pagination is defined for all list endpoints
- [ ] DTOs are defined for all inputs and outputs
- [ ] No internal fields leak in responses (whitelist, not blacklist)
- [ ] BigInt IDs serialize as strings
- [ ] Soft delete is default, hard delete requires admin permission
- [ ] Multi-tenant data isolation is enforced
- [ ] Swagger/OpenAPI annotations are specified for dev to implement
- [ ] Endpoints classified as Commands or Queries (CQS)
- [ ] Error responses include correlationId for tracing
- [ ] Response DTOs extend ResponseBase (id, createdAt, updatedAt)
- [ ] Strategy interfaces defined for external integrations
- [ ] Webhook endpoints return 204 for unhandled events (no retry storms)
- [ ] Middleware chain order documented: authenticate → authorize → validate → controller
- [ ] Exhaustive type checking (assertUnreachable) for discriminated unions
