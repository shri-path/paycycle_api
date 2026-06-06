# PayCycle API - Infrastructure Reference

> ℹ️ **INFRASTRUCTURE REFERENCE ONLY — NOT A DESIGN AUTHORITY**
>
> This document covers the project's **infrastructural and operational** concerns:
> the common API wrapper contract, database strategy, security, logging,
> configuration management, API versioning, and the scalability path.
>
> It does **not** govern system design, module structure, or coding style. The
> old "layered architecture" design content has been **removed** from this file to
> avoid conflicting with the current approach. The authoritative sources for
> design and implementation are:
> - **[AGENTS.md](AGENTS.md)** — agent workflow and pipeline
> - **[.claude/memory/MEMORY.md](.claude/memory/MEMORY.md)** — standing decisions & conventions (read first)
> - **[.claude/skills/](.claude/skills/)** — design & implementation patterns (DDD / Hexagonal)
> - **[.claude/agents/](.claude/agents/)** — agent roles and review standards

---

## 1. Common API Wrapper Design

The **Common API Wrapper** is a shared infrastructural utility, providing:

### 1.1 Dynamic List Query Builder

**Features**:
- Pagination (page, limit)
- Multi-column sorting
- Column selection
- Advanced filtering (=, !=, <, >, <=, >=, LIKE, IN, NOT IN)
- Logical operators (AND/OR grouping)
- Full-text search

**Query Format** (Client sends):
```json
{
  "page": 1,
  "limit": 20,
  "sort": ["-createdAt", "name"],
  "select": ["id", "name", "email"],
  "filter": {
    "AND": [
      { "status": { "eq": "active" } },
      { "role": { "in": ["admin", "manager"] } },
      {
        "OR": [
          { "email": { "like": "%@company.com" } },
          { "department": { "eq": "engineering" } }
        ]
      }
    ]
  },
  "search": {
    "query": "john",
    "fields": ["name", "email"]
  }
}
```

**Implementation**:
- Safe query building (prevents SQL injection)
- Type-safe with Prisma's type system
- Reusable across all modules

### 1.2 CRUD Operations

All standard operations via wrapper:
- `GET /resource` - List with dynamic queries
- `GET /resource/:id` - Get single item
- `POST /resource` - Create (strict validation)
- `PATCH /resource/:id` - Partial update
- `POST /resource/bulk` - Bulk create
- `PATCH /resource/bulk` - Bulk update
- `DELETE /resource/:id` - Soft delete
- `DELETE /resource/:id?hard=true` - Hard delete

### 1.3 Response Format

**Success Response**:
```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

**Error Response**:
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input data",
    "details": [...]
  }
}
```

---

## 2. Database Strategy

### Why Prisma?

**Chosen over TypeORM and Knex because**:

✅ **Type Safety**: Auto-generated types from schema
✅ **Developer Experience**: Best-in-class auto-completion
✅ **Migration System**: Built-in, declarative migrations
✅ **Query Performance**: Optimized query generation
✅ **Active Development**: Modern, well-maintained
✅ **Relation Handling**: Intuitive nested queries

**vs TypeORM**:
- Better TypeScript support
- More predictable queries
- No decorators (simpler)

**vs Knex**:
- Type-safe queries
- Auto-generated types
- Built-in migrations

### Migration Strategy

```bash
# Create migration
npm run migrate:create

# Run migrations
npm run migrate:deploy

# Reset database
npm run migrate:reset

# Seed database
npm run db:seed
```

**Folder Structure**:
```
prisma/
  ├── schema.prisma          # Database schema
  ├── migrations/            # Version-controlled migrations
  └── seeds/                 # Seed data scripts
```

---

## 3. Security Architecture

### 3.1 Authentication (JWT)

**Flow**:
```
1. User logs in → Validate credentials
2. Generate JWT (access + refresh tokens)
3. Return tokens to client
4. Client sends token in Authorization header
5. Middleware validates token
6. Attach user to request
```

**Token Structure**:
```typescript
{
  userId: string;
  email: string;
  role: string;
  permissions: string[];
  iat: number;
  exp: number;
}
```

### 3.2 RBAC (Role-Based Access Control)

**Permission Model**:
```typescript
resource:action

Examples:
- users:read
- users:write
- users:delete
- invoices:approve
```

### 3.3 Security Layers

1. **Helmet**: Secure HTTP headers
2. **Rate Limiting**: Prevent abuse
3. **CORS**: Controlled cross-origin access
4. **Input Sanitization**: XSS prevention
5. **SQL Injection Prevention**: Parameterized queries (Prisma)
6. **Validation**: Strict schema validation (Zod)

---

## 4. Logging Strategy

**Logger**: **Pino** (chosen over Winston)

**Why Pino?**
- 5x faster than Winston
- JSON structured logging
- Low overhead
- Great for production

**Log Levels**:
- `trace`: Very detailed debugging
- `debug`: Debugging information
- `info`: General information
- `warn`: Warning messages
- `error`: Error messages
- `fatal`: Fatal errors

**Context Enrichment**:
- Request ID (for tracing)
- User ID
- Timestamp
- Environment

---

## 5. Configuration Management

### Environment-Based Config

```
config/
  ├── index.ts           # Config loader
  ├── schema.ts          # Config validation (Zod)
  └── environments/      # Per-environment settings
```

**Validation**:
- All env vars validated on startup
- Fail fast if misconfigured
- Type-safe config access

---

## 6. API Versioning

**Strategy**: URL-based versioning

```
/api/v1/users
/api/v2/users
```

**Deprecation Policy**:
- Support N-1 versions
- Clear deprecation warnings
- Sunset dates in responses

---

## 7. Scalability Path

### Microservices Evolution

**Current**: Modular Monolith
**Future**: Microservices

**Steps to Extract**:
1. Module is already isolated
2. Extract module to separate repo
3. Add message queue (RabbitMQ/Kafka)
4. Deploy as separate service
5. Update API gateway

**Preparation**:
- Each module is self-contained
- No cross-module imports (except common)
- Clear interfaces between modules
