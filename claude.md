# PayCycle API

**Enterprise-grade REST API** built with Node.js, Express, TypeScript, and PostgreSQL featuring JWT authentication, RBAC, dynamic query building, and comprehensive testing.

> 🤖 **Working as part of the agent team?** Read `.claude/memory/MEMORY.md` first for standing decisions and context, then see [AGENTS.md](AGENTS.md) for the Architect → Dev → Review → QA pipeline, handoff artifacts, and the skills catalog.

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Update DATABASE_URL and other variables in .env

# Generate Prisma Client
npm run db:generate

# Run migrations
npm run migrate:deploy

# Seed database with initial data
npm run db:seed

# Start development server
npm run dev
```

The server will start at `http://localhost:3000`

## Default Credentials

After seeding the database:

```
Email: admin@paycycle.com
Password: Admin@123
```

**⚠️ Change the default password immediately!**

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Architecture](#architecture)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Database](#database)
- [API Documentation](#api-documentation)
- [Authentication](#authentication)
- [Common API Wrapper](#common-api-wrapper)
- [Testing](#testing)
- [Deployment](#deployment)
- [Best Practices](#best-practices)

---

## 📊 Development Progress Tracker

**IMPORTANT**: Track all development progress using the **User Stories Progress Tracker**:
- **Location**: `../project_documents/vendor_app/PROGRESS_TRACKER.md`
- **Purpose**: Central hub for tracking US (User Story) development status across:
  - 🔴 Not Started
  - 🟡 In Progress
  - 🟢 Completed
- **When to Update**: 
  - Before starting a new user story → Move to "In Progress"
  - When completing a user story → Move to "Completed"
  - Include branch names, PR links, and notes
- **Dependency Reference**: Check the tracker for feature dependencies and implementation order
- **Backend Responsibility**: Implement API endpoints matching the requirements in each user story
  - Reference `../project_documents/vendor_app/user_stories/` for feature specifications
  - Follow the design & implementation patterns in [AGENTS.md](AGENTS.md) and [.claude/skills/](.claude/skills/) (ARCHITECTURE.md is legacy infra reference only, not a design authority)
  - Ensure all endpoints are documented in Swagger/OpenAPI

---

## Features

### Core Features

- ✅ **TypeScript** - Strict mode, full type safety
- ✅ **Express.js** - Fast, minimalist web framework
- ✅ **PostgreSQL + Prisma** - Type-safe database access with migrations
- ✅ **JWT Authentication** - Secure token-based auth with refresh tokens
- ✅ **RBAC** - Role-based access control with granular permissions
- ✅ **Request Validation** - Zod schemas with automatic type inference
- ✅ **OpenAPI/Swagger** - Auto-generated API documentation
- ✅ **Logging** - Pino logger with request tracing
- ✅ **Error Handling** - Centralized error handling with custom error classes
- ✅ **Testing** - Jest with unit and integration tests

### Advanced Features

- 🚀 **Dynamic Query Builder** - Filter, sort, paginate, search on any endpoint
- 🚀 **CRUD Wrapper** - Reusable CRUD operations for all entities
- 🚀 **Soft Delete** - Automatic soft delete with recovery
- 🚀 **Bulk Operations** - Bulk create and update support
- 🚀 **Rate Limiting** - Prevent API abuse
- 🚀 **Compression** - Gzip response compression
- 🚀 **Security** - Helmet, CORS, input sanitization

---

## Tech Stack

| Category         | Technology       | Why?                                    |
| ---------------- | ---------------- | --------------------------------------- |
| Runtime          | Node.js 18+      | Modern, async-first runtime             |
| Framework        | Express.js       | Battle-tested, flexible                 |
| Language         | TypeScript       | Type safety, better DX                  |
| Database         | PostgreSQL       | Relational, ACID compliant, extensible  |
| ORM              | Prisma           | Type-safe queries, great migrations     |
| Validation       | Zod              | Schema validation + type inference      |
| Authentication   | JWT              | Stateless, scalable                     |
| Logger           | Pino             | Fast, structured logging                |
| Testing          | Jest + Supertest | Comprehensive testing framework         |
| Documentation    | Swagger/OpenAPI  | Industry standard API docs              |

---

## Project Structure

```
paycycle_api/
├── src/
│   ├── modules/                      # Feature modules
│   │   ├── user/                    # User module (reference implementation)
│   │   │   ├── user.controller.ts   # HTTP handlers
│   │   │   ├── user.service.ts      # Business logic
│   │   │   ├── user.repository.ts   # Data access
│   │   │   ├── user.validator.ts    # Zod schemas
│   │   │   ├── user.routes.ts       # Route definitions
│   │   │   ├── user.types.ts        # Types/DTOs
│   │   │   └── __tests__/           # Module tests
│   │   └── auth/                    # Authentication module
│   │
│   ├── common/                       # Shared code
│   │   ├── api-wrapper/             # Common API wrapper
│   │   │   ├── query-builder.ts     # Dynamic query builder
│   │   │   ├── base-crud.service.ts # Base CRUD service
│   │   │   ├── response.util.ts     # Response formatting
│   │   │   └── types.ts             # Common types
│   │   ├── errors/                  # Custom error classes
│   │   └── utils/                   # Utility functions
│   │
│   ├── infrastructure/              # Technical infrastructure
│   │   ├── config/                  # Configuration
│   │   ├── database/                # Database client
│   │   ├── logger/                  # Logger setup
│   │   ├── middlewares/             # Express middlewares
│   │   └── swagger/                 # OpenAPI setup
│   │
│   ├── app.ts                       # Express app setup
│   └── server.ts                    # Server entry point
│
├── prisma/
│   ├── schema.prisma                # Database schema
│   ├── migrations/                  # Version-controlled migrations
│   └── seeds/                       # Seed data
│
├── tests/                           # Integration tests
│   ├── setup.ts                     # Test configuration
│   └── integration/                 # API integration tests
│
├── ARCHITECTURE.md                  # Detailed architecture docs
├── package.json
├── tsconfig.json
└── README.md                        # This file
```

---

## Architecture

This API is built with **Domain-Driven Design (DDD)** and **Hexagonal / Clean Architecture**.
Dependencies always point **inward** — Infrastructure → Application → Domain — and the
domain layer has zero framework imports (no Prisma, Express, or Pino).

```
┌─────────────────────────────────────────────────┐
│  Infrastructure  — Prisma, Express, Pino, HTTP   │
│  controllers, repository adapters, middlewares   │
├─────────────────────────────────────────────────┤
│  Application  — use-case services, repository    │
│  ports, DTOs, command/query handlers             │
├─────────────────────────────────────────────────┤
│  Domain  — entities, value objects, aggregates,  │
│  domain events  (framework-free)                 │
└─────────────────────────────────────────────────┘
            dependencies point inward ↑
```

### Key Principles

1. **Dependency Rule** — dependencies point inward; the domain never imports infrastructure.
2. **Aggregate boundaries** — cross-aggregate references by ID only; a parent owns its children within an aggregate.
3. **Ports & Adapters** — services depend on repository ports (interfaces), not concrete Prisma adapters.
4. **CQS** — every service method is either a Command (state-changing) or a Query (read-only), never both.
5. **Mappers** — `toDomain` / `toPersistence` / `toResponse` keep the layers decoupled.
6. **Validation at the boundary** — all external input is validated with Zod.

The authoritative, detailed patterns live in [AGENTS.md](AGENTS.md) and [.claude/skills/](.claude/skills/).
[ARCHITECTURE.md](ARCHITECTURE.md) is **infrastructural reference only** (DB, security, logging,
config, versioning) and does not govern design or coding style.

---

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- PostgreSQL 14+
- Git

### Installation

1. **Clone the repository**

```bash
git clone <repository-url>
cd paycycle_api
```

2. **Install dependencies**

```bash
npm install
```

3. **Setup environment**

```bash
cp .env.example .env
```

Edit `.env` and configure:
- `DATABASE_URL` - PostgreSQL connection string
- `JWT_SECRET` - Secret key for JWT (min 32 characters)
- Other settings as needed

4. **Setup database**

```bash
# Generate Prisma Client
npm run db:generate

# Run migrations
npm run migrate:deploy

# Seed initial data
npm run db:seed
```

5. **Start development server**

```bash
npm run dev
```

The API will be available at:
- **API**: http://localhost:3000/api/v1
- **Health Check**: http://localhost:3000/health
- **Swagger Docs**: http://localhost:3000/api-docs

---

## Environment Variables

All environment variables are validated on startup using Zod schemas.

Required variables:

```bash
# Server
NODE_ENV=development
PORT=3000
API_VERSION=v1

# Database
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/paycycle_db"

# JWT
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production-min-32-chars
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d

# CORS
CORS_ORIGIN=http://localhost:3000,http://localhost:5173

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# Logging
LOG_LEVEL=info

# Pagination
DEFAULT_PAGE_SIZE=20
MAX_PAGE_SIZE=100
```

---

## Database

### Prisma Commands

```bash
# Generate Prisma Client (after schema changes)
npm run db:generate

# Create new migration
npm run migrate:create

# Run migrations
npm run migrate:deploy

# Reset database (DANGER: deletes all data)
npm run migrate:reset

# Seed database
npm run db:seed

# Open Prisma Studio (GUI)
npm run db:studio
```

### Schema

The database schema is defined in [prisma/schema.prisma](prisma/schema.prisma).

Key models:
- **User** - User accounts
- **Role** - User roles (admin, manager, user)
- **Permission** - Granular permissions (resource:action)
- **RolePermission** - Role-permission mapping
- **RefreshToken** - JWT refresh tokens
- **AuditLog** - Audit trail (optional)

---

## API Documentation

### Swagger/OpenAPI

Interactive API documentation is available at:

**http://localhost:3000/api-docs**

Features:
- Complete endpoint documentation
- Request/response schemas
- Try-it-out functionality
- Authentication support

### OpenAPI Spec

Download the OpenAPI JSON specification:

**http://localhost:3000/api-docs.json**

---

## Authentication

### Login

```http
POST /api/v1/auth/login
Content-Type: application/json

{
  "email": "admin@paycycle.com",
  "password": "Admin@123"
}
```

Response:
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "...",
      "email": "admin@paycycle.com",
      "firstName": "System",
      "lastName": "Administrator",
      "role": "admin"
    },
    "tokens": {
      "accessToken": "eyJhbGc...",
      "refreshToken": "eyJhbGc..."
    }
  }
}
```

### Using the Token

Include the access token in the Authorization header:

```http
GET /api/v1/users
Authorization: Bearer eyJhbGc...
```

### Refresh Token

```http
POST /api/v1/auth/refresh
Content-Type: application/json

{
  "refreshToken": "eyJhbGc..."
}
```

---

## Common API Wrapper

The **Common API Wrapper** provides powerful dynamic querying for all list endpoints.

### Pagination

```http
GET /api/v1/users?page=1&limit=20
```

### Sorting

```http
# Sort by createdAt descending
GET /api/v1/users?sort[]=-createdAt

# Sort by multiple fields
GET /api/v1/users?sort[]=firstName&sort[]=-createdAt
```

### Column Selection

```http
GET /api/v1/users?select[]=id&select[]=email&select[]=firstName
```

### Filtering

#### Simple Filters

```http
# Equal
GET /api/v1/users?filter[status][eq]=ACTIVE

# Not equal
GET /api/v1/users?filter[status][ne]=INACTIVE

# Greater than
GET /api/v1/users?filter[createdAt][gt]=2024-01-01

# Like (contains)
GET /api/v1/users?filter[email][like]=@company.com
```

#### Advanced Filters (AND/OR)

```json
POST /api/v1/users (with query params encoded)
{
  "filter": {
    "AND": [
      { "status": { "eq": "ACTIVE" } },
      {
        "OR": [
          { "email": { "like": "@company.com" } },
          { "role": { "in": ["admin", "manager"] } }
        ]
      }
    ]
  }
}
```

### Search

```http
GET /api/v1/users?search[query]=john&search[fields][]=firstName&search[fields][]=email
```

### Complete Example

```http
GET /api/v1/users?
  page=1&
  limit=20&
  sort[]=-createdAt&
  select[]=id&select[]=email&select[]=firstName&
  filter[status][eq]=ACTIVE&
  search[query]=john&search[fields][]=firstName
```

---

## Testing

### Run Tests

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run in watch mode
npm run test:watch

# Run integration tests only
npm run test:integration
```

### Test Structure

- **Unit Tests**: [src/modules/*/__tests__/*.test.ts](src/modules/user/__tests__/user.service.test.ts)
- **Integration Tests**: [tests/integration/*.test.ts](tests/integration/user.test.ts)

### Writing Tests

**Unit Test Example** (Service):

```typescript
describe('UserService', () => {
  let userService: UserService;
  let mockUserRepository: jest.Mocked<UserRepository>;

  beforeEach(() => {
    mockUserRepository = new UserRepository() as jest.Mocked<UserRepository>;
    userService = new UserService(mockUserRepository, logger);
  });

  it('should return user when found', async () => {
    mockUserRepository.findById.mockResolvedValue(mockUser);
    const result = await userService.getById('123');
    expect(result).toEqual(expectedDto);
  });
});
```

**Integration Test Example** (API):

```typescript
describe('POST /api/v1/auth/login', () => {
  it('should return 200 with valid credentials', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@paycycle.com', password: 'Admin@123' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });
});
```

---

## Deployment

### Build for Production

```bash
npm run build
```

This generates JavaScript files in the `dist/` directory.

### Run Production Server

```bash
NODE_ENV=production npm start
```

### Environment Checklist

Before deploying to production:

- [ ] Change default admin password
- [ ] Set strong `JWT_SECRET` (min 32 characters)
- [ ] Configure `DATABASE_URL` for production database
- [ ] Set `NODE_ENV=production`
- [ ] Configure `CORS_ORIGIN` for your frontend
- [ ] Set appropriate `LOG_LEVEL` (warn or error)
- [ ] Enable SSL/TLS
- [ ] Setup reverse proxy (Nginx, Caddy)
- [ ] Configure rate limiting
- [ ] Setup monitoring (PM2, New Relic, etc.)

### Docker (Optional)

Create a `Dockerfile`:

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

---

## Best Practices

### Code Organization

- Keep files small (< 200 lines)
- One responsibility per file
- Group by feature, not by type
- Use meaningful names

### TypeScript

- Enable strict mode
- No `any` types
- Use interfaces for objects
- Prefer `unknown` over `any`

### Security

- Never trust user input
- Validate everything with Zod
- Use parameterized queries (Prisma handles this)
- Hash passwords with bcrypt
- Use HTTPS in production
- Implement rate limiting
- Keep dependencies updated

### Error Handling

- Use custom error classes
- Never swallow errors
- Log errors with context
- Return consistent error format

### Performance

- Use pagination
- Index database fields
- Enable compression
- Implement caching (Redis)
- Use connection pooling

---

## Scripts Reference

| Command                 | Description                          |
| ----------------------- | ------------------------------------ |
| `npm run dev`           | Start development server with hot reload |
| `npm run build`         | Build for production                 |
| `npm start`             | Start production server              |
| `npm test`              | Run tests with coverage              |
| `npm run lint`          | Lint code                            |
| `npm run lint:fix`      | Fix linting errors                   |
| `npm run format`        | Format code with Prettier            |
| `npm run migrate:deploy`| Run database migrations              |
| `npm run db:seed`       | Seed database                        |
| `npm run db:studio`     | Open Prisma Studio GUI               |

---

## Contributing & Commit Strategy

Full rules live in [CONTRIBUTING.md](CONTRIBUTING.md). Summary:

- **Branching** — one User Story per branch off `main` (`feat/us-<id>-<slug>`,
  `fix/<slug>`, `chore/<slug>`). Update `PROGRESS_TRACKER.md` when moving a story
  to In Progress / Completed. One US = one branch = one PR.
- **Commits** — [Conventional Commits](https://www.conventionalcommits.org/):
  `<type>(<scope>): <subject>` in imperative mood (e.g. `feat(auth): add refresh-token rotation`).
  Types: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `build`, `ci`, `chore`, `style`.
  Keep commits small and atomic — each one must lint and build clean.
- **Quality gate** — a husky `pre-commit` hook runs `npm run lint` then `npm run build`;
  the commit is created **only if both pass**. Fix with `npm run lint:fix`; do not
  bypass with `--no-verify` except in emergencies.

---

## License

This project is licensed under the MIT License.

---

## Support

For questions or issues:
- Create an issue on GitHub
- Email: api@paycycle.com
- Documentation: [ARCHITECTURE.md](ARCHITECTURE.md)

---

Built with ❤️ using Node.js, Express, TypeScript, and Prisma
