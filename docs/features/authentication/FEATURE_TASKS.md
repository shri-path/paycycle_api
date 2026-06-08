# Feature Tasks: Authentication & Account Setup (US-003)

**Complexity**: Complex
**Feature Branch**: `feat/us-003-authentication`
**Skills to follow**: `prisma-schema-design.md`, `domain-modeling.md`, `validation-schemas.md`, `error-handling.md`, `module-scaffold.md`, `api-contract-design.md`

**Prerequisites for the Dev agent**:
1. Read `docs/features/authentication/DOMAIN_MODEL.md` — domain entities, VOs, invariants
2. Read `docs/features/authentication/FEATURE_PLAN.md` — full API contract, error mapping, sequence diagrams
3. Read `.claude/memory/MEMORY.md` — standing decisions that override defaults
4. Review `src/modules/user/` — reference implementation for patterns

**Task Execution Order**: Tasks must be executed in the numbered sequence. Each task lists its dependencies. Do not skip to a later task without completing the prior ones.

---

## Task 1: Prisma Schema — Define All Models

**Skill**: `prisma-schema-design.md`
**Depends on**: Nothing (first task)
**Files to create/modify**:
- `prisma/schema.prisma` — add or verify all models

### Acceptance Criteria

Add the following Prisma models (matching the DB design SQLs in `../project_documents/db-design/`). If models already exist from a prior migration, verify column names and indexes match exactly.

**Models to define**:
1. `User` — `users` table. Fields: id, phone (unique, varchar 15), passwordHash (varchar 255), name, email, profilePhotoUrl, preferredLanguage (default 'en'), lastLoginAt, createdAt, updatedAt, deletedAt. Indexes: phone, email, createdAt, deletedAt.
2. `UserSession` — `user_sessions` table. Fields: id, userId (FK → users, CASCADE), accessToken, refreshToken, deviceId, deviceName, ipAddress, userAgent, lastActivityAt (default now), expiresAt, revokedAt, createdAt. NO `updatedAt` (use lastActivityAt instead). Indexes: userId, refreshToken, expiresAt, lastActivityAt.
3. `PasswordResetToken` — `password_reset_tokens` table. Fields: id, userId (FK → users, CASCADE), resetToken (unique, varchar 255), otpCode (varchar 6), isUsed (default false), usedAt, expiresAt, createdAt, updatedAt. Indexes: userId, resetToken, expiresAt.
4. `Vendor` — `vendors` table. Fields as per `02-vendors.sql`. Self-referencing on referredByVendorId (SetNull). Indexes: referralCode, category, phone, referredByVendorId, deletedAt.
5. `VendorUser` — `vendor_users` table with `VendorUserStatus` enum (INVITED, ACTIVE, DISABLED, REMOVED). Unique constraint: (vendorId, userId). FK → vendors (CASCADE), users (CASCADE), roles (RESTRICT). Indexes: vendorId, userId, roleId, status, deletedAt.
6. `Role` — `roles` table. Fields: id, name (unique), displayName, description, createdAt, updatedAt. Index: name.
7. `Permission` — `permissions` table. Fields: id, name (unique), resource, action, description, createdAt, updatedAt. Unique: (resource, action). Indexes: resource, action, name.
8. `RolePermission` — `role_permissions` table. Fields: id, roleId (FK → roles, CASCADE), permissionId (FK → permissions, CASCADE), assignedAt. Unique: (roleId, permissionId). Indexes: roleId, permissionId.

**Naming conventions** (CRITICAL — all must match):
- Prisma field names: camelCase
- DB column names: snake_case via `@map()`
- Table names: snake_case plural via `@@map()`
- Enum values: UPPER_SNAKE_CASE
- Enum DB name: snake_case via `@@map()`

**After editing schema.prisma**:
```bash
npm run migrate:create -- --name create_auth_tables
# Review generated SQL in prisma/migrations/[timestamp]_create_auth_tables/migration.sql
# Confirm it matches the SQL in ../project_documents/db-design/01-core-users.sql, 02-vendors.sql, 12-staff-management-rbac.sql
npm run migrate:deploy
npm run db:generate
```

---

## Task 2: Module Scaffold — Create Directory Structure

**Skill**: `module-scaffold.md` (Complex tier)
**Depends on**: Task 1 (Prisma client must be generated)
**Files to create** (empty shells — implementation comes in later tasks):

```
src/modules/auth/
├── domain/
│   ├── user.entity.ts
│   ├── vendor.entity.ts
│   ├── user.types.ts
│   ├── vendor.types.ts
│   ├── auth.errors.ts
│   ├── value-objects/
│   │   ├── phone-number.value-object.ts
│   │   └── hashed-password.value-object.ts
│   └── events/
│       ├── user-registered.domain-event.ts
│       ├── user-logged-in.domain-event.ts
│       ├── password-changed.domain-event.ts
│       └── vendor-created.domain-event.ts
├── database/
│   ├── user.repository.port.ts
│   ├── user.repository.ts
│   ├── vendor.repository.port.ts
│   ├── vendor.repository.ts
│   └── session.repository.ts
├── ports/
│   └── sms-notification.port.ts
├── adapters/
│   └── sms-stub.adapter.ts
├── commands/
│   ├── signup/
│   │   ├── signup.service.ts
│   │   └── signup.request.dto.ts
│   ├── login/
│   │   ├── login.service.ts
│   │   └── login.request.dto.ts
│   ├── refresh-token/
│   │   ├── refresh-token.service.ts
│   │   └── refresh-token.request.dto.ts
│   ├── forgot-password/
│   │   ├── forgot-password.service.ts
│   │   └── forgot-password.request.dto.ts
│   ├── reset-password/
│   │   ├── reset-password.service.ts
│   │   └── reset-password.request.dto.ts
│   └── logout/
│       ├── logout.service.ts
│       └── logout.request.dto.ts
├── auth.mapper.ts
├── auth.types.ts
├── auth.validator.ts
├── auth.controller.ts
├── auth.middleware.ts
├── auth.routes.ts
└── __tests__/
    ├── auth.controller.test.ts
    ├── auth.service.test.ts
    └── domain/
        ├── user.entity.test.ts
        ├── phone-number.value-object.test.ts
        └── hashed-password.value-object.test.ts
```

### Acceptance Criteria
- All directories and placeholder files exist (can be empty with a single `// TODO` comment)
- `npm run build` must still pass after scaffolding (files need at minimum a valid export)

---

## Task 3: Domain Entities and Value Objects

**Skill**: `domain-modeling.md` (see `DOMAIN_MODEL.md` for full spec)
**Depends on**: Task 2
**Files to implement**:

### 3a. Value Object: PhoneNumber
**File**: `src/modules/auth/domain/value-objects/phone-number.value-object.ts`

- Validates: `^\+?[1-9][0-9]{7,14}$`
- Throws `ArgumentInvalidException` if validation fails
- Uses `Guard.isEmpty()` before regex check
- `static create(value: string): PhoneNumber` factory
- `unpack(): string` returns the raw string
- Immutable — no setters

### 3b. Value Object: HashedPassword
**File**: `src/modules/auth/domain/value-objects/hashed-password.value-object.ts`

- Wraps a bcrypt hash string (already hashed — never receives raw password)
- Validates: non-empty, length >= 60 (bcrypt output length)
- Throws `ArgumentInvalidException` if invalid
- `static create(hash: string): HashedPassword` factory
- `unpack(): string` returns the hash
- Immutable

### 3c. Domain Types
**File**: `src/modules/auth/domain/user.types.ts`

```typescript
export interface UserProps {
  phone: PhoneNumber;
  passwordHash: HashedPassword;
  name: string | null;
  email: string | null;
  profilePhotoUrl: string | null;
  preferredLanguage: string;
  lastLoginAt: Date | null;
  deletedAt: Date | null;
}

export interface CreateUserProps {
  phone: PhoneNumber;
  passwordHash: HashedPassword;
  preferredLanguage?: string;  // default 'en'
}
```

**File**: `src/modules/auth/domain/vendor.types.ts`

```typescript
export interface VendorProps {
  name: string;
  // All other fields are nullable/optional
}

export interface CreateVendorProps {
  name: string;
}
```

### 3d. Entity: User
**File**: `src/modules/auth/domain/user.entity.ts`

Extends the base `Entity` class (or `AggregateRoot` from `src/common/`).

Key methods:
- `static create(props: CreateUserProps): UserEntity` — factory, calls `validate()`, collects `UserRegisteredEvent` in domain events
- `static reconstitute(data: { id, createdAt, updatedAt, props: UserProps }): UserEntity` — rebuild from DB (no events)
- `recordLogin(): void` — sets `lastLoginAt = new Date()`, emits `UserLoggedInEvent`
- `changePassword(newHash: HashedPassword): void` — replaces `passwordHash`, emits `PasswordChangedEvent`
- `softDelete(): void` — sets `deletedAt = new Date()`
- `validate(): void` — enforces all invariants (phone regex via VO, preferredLanguage whitelist, passwordHash non-empty)

Allowed `preferredLanguage` values: `['en', 'hi', 'ta', 'te', 'mr', 'bn', 'kn', 'ml', 'gu']`

### 3e. Entity: Vendor (creation scope)
**File**: `src/modules/auth/domain/vendor.entity.ts`

Key methods:
- `static create(props: CreateVendorProps): VendorEntity` — factory, calls `validate()`, collects `VendorCreatedEvent`
- `validate(): void` — `name` must be non-empty, max 150 chars

### 3f. Domain Events
**Files** in `src/modules/auth/domain/events/`:

Each event file exports an event class with at minimum:
```typescript
export class UserRegisteredEvent {
  readonly type = 'UserRegisteredEvent';
  constructor(
    public readonly userId: bigint,
    public readonly phone: string,
    public readonly vendorId: bigint,
    public readonly correlationId: string,
    public readonly timestamp: Date = new Date(),
  ) {}
}
```

Similarly for `UserLoggedInEvent` (+ ip, userAgent), `PasswordChangedEvent` (+ userId), `VendorCreatedEvent` (+ vendorId, name, ownerUserId).

### Acceptance Criteria
- All VOs throw `ArgumentInvalidException` for invalid inputs (not generic `Error`)
- `UserEntity.create()` uses `Guard.isEmpty()` from `src/common/utils/guard.ts`
- Domain events are collected on the entity (using base class `addDomainEvent()` or similar)
- `npm run build` passes

---

## Task 4: Zod Validation Schemas

**Skill**: `validation-schemas.md`
**Depends on**: Task 2
**File**: `src/modules/auth/auth.validator.ts`

Implement all 6 Zod schemas:

### signupSchema (`.strict()`)
```
phone:      string, trimmed, regex ^\+?[1-9][0-9]{7,14}$, error: 'Invalid phone number format'
password:   string, min 8, max 100, complexity regex (uppercase, lowercase, digit, special char)
vendorName: string, trimmed, min 1, max 150
```

### loginSchema (`.strict()`)
```
phone:    string, trimmed, regex as above
password: string, min 1, max 100 (no strength check on login)
```

### refreshTokenSchema (`.strict()`)
```
refreshToken: string, min 1
```

### forgotPasswordSchema (`.strict()`)
```
phone: string, trimmed, regex as above
```

### resetPasswordSchema (`.strict()`)
```
phone:       string, trimmed, phone regex
resetToken:  string, min 1 (non-empty)
otpCode:     string, regex /^[0-9]{6}$/, error: 'OTP must be exactly 6 digits'
newPassword: string, min 8, max 100, complexity (same as signup)
```

### logoutSchema (`.strict()`)
```
refreshToken: string, min 1
```

### Acceptance Criteria
- All schemas export their inferred TypeScript types: `type SignupInput = z.infer<typeof signupSchema>`
- Reusable field helpers extracted: `phoneField`, `passwordField`, `strongPasswordField`
- `npm run build` passes

---

## Task 5: Repository Ports (Interfaces)

**Skill**: `module-scaffold.md` (Step 5), `prisma-schema-design.md`
**Depends on**: Task 3 (entities), Task 1 (Prisma types)
**Files**:

### 5a. IUserRepository
**File**: `src/modules/auth/database/user.repository.port.ts`

```typescript
export interface IUserRepository {
  findByPhone(phone: string, tx?: PrismaTransaction): Promise<User | null>;
  findById(id: bigint, tx?: PrismaTransaction): Promise<User | null>;
  insert(data: Prisma.UserCreateInput, tx?: PrismaTransaction): Promise<User>;
  update(id: bigint, data: Prisma.UserUpdateInput, tx?: PrismaTransaction): Promise<User>;
}
```

### 5b. IVendorRepository
**File**: `src/modules/auth/database/vendor.repository.port.ts`

```typescript
export interface IVendorRepository {
  insert(data: Prisma.VendorCreateInput, tx?: PrismaTransaction): Promise<Vendor>;
  findById(id: bigint): Promise<Vendor | null>;
}
```

---

## Task 6: Repository Prisma Adapters

**Skill**: `module-scaffold.md` (Step 5), `error-handling.md`
**Depends on**: Task 5

### 6a. UserRepository
**File**: `src/modules/auth/database/user.repository.ts`

- Implements `IUserRepository`
- `findByPhone`: `findFirst({ where: { phone, deletedAt: null } })`
- `findById`: `findFirst({ where: { id, deletedAt: null } })`
- `insert`: Catches P2002 → throws `ConflictError('Phone number is already registered')`
- `update`: Standard Prisma update

### 6b. VendorRepository
**File**: `src/modules/auth/database/vendor.repository.ts`

- Implements `IVendorRepository`
- `insert`: Standard create with P2002 handling for referral_code if provided

### 6c. SessionRepository
**File**: `src/modules/auth/database/session.repository.ts`

No port (simple enough). Methods needed:
- `create(data, tx?)` — create new session row
- `findByRefreshToken(token)` — find active session
- `revoke(id, tx?)` — set `revokedAt = now()`
- `revokeAll(userId, tx?)` — set `revokedAt = now()` WHERE userId AND `revokedAt IS NULL` (for password reset)

Additionally, the auth module needs to query `VendorUser` table during login. Add:
- `VendorUserRepository` (inline in session.repository.ts or a separate file `vendor-user.repository.ts`): `findActiveContextsByUserId(userId)` — returns `{ vendorId, roleName, vendorName }[]`

### Acceptance Criteria
- All repositories accept optional `tx?: PrismaTransaction` parameter for use inside `prisma.$transaction()`
- P2002 Prisma error translated to `ConflictError` at repository level
- `npm run build` passes

---

## Task 7: JWT Utility

**Skill**: `api-contract-design.md` (security section)
**Depends on**: Task 1 (env config)
**File**: `src/modules/auth/utils/jwt.util.ts` (or `src/infrastructure/utils/jwt.util.ts` if shared)

Implement the `JwtUtil` interface from FEATURE_PLAN.md Section 7.

```typescript
// Access token payload
interface JwtAccessPayload {
  userId: string;
  phone: string;
  vendorIds: string[];
}

// Refresh token payload
interface JwtRefreshPayload {
  userId: string;
  sessionId: string;
}
```

Functions:
- `generateAccessToken(payload: JwtAccessPayload): string` — signs with `JWT_SECRET`, exp from `JWT_ACCESS_EXPIRY` env (default `1h`)
- `generateRefreshToken(payload: JwtRefreshPayload): string` — signs with `JWT_SECRET`, exp from `JWT_REFRESH_EXPIRY` env (default `30d`)
- `verifyAccessToken(token: string): JwtAccessPayload` — throws `UnauthorizedError` on invalid/expired
- `verifyRefreshToken(token: string): JwtRefreshPayload` — throws `UnauthorizedError` on invalid/expired

### Acceptance Criteria
- Uses `jsonwebtoken` library (already in package.json)
- Throws `UnauthorizedError` (not generic Error) on verification failure
- `npm run build` passes

---

## Task 8: Password Utility

**Skill**: `error-handling.md`
**Depends on**: Task 2
**File**: `src/modules/auth/utils/password.util.ts`

```typescript
export const passwordUtil = {
  hash(password: string): Promise<string>;      // bcrypt.hash(password, 10)
  compare(password: string, hash: string): Promise<boolean>;  // bcrypt.compare
};
```

### Acceptance Criteria
- bcrypt rounds = 10 (hardcoded constant, not env-configurable for v1)
- No other logic — purely hashing/comparison
- `npm run build` passes

---

## Task 9: SMS Service Port and Stub Adapter

**Skill**: `api-contract-design.md` (Step 9 — Strategy Pattern)
**Depends on**: Task 2
**Files**:

### 9a. Port
**File**: `src/modules/auth/ports/sms-notification.port.ts`
```typescript
export interface SmsNotificationPort {
  sendOtp(phone: string, otp: string): Promise<void>;
}
```

### 9b. Stub Adapter
**File**: `src/modules/auth/adapters/sms-stub.adapter.ts`
```typescript
export class SmsStubAdapter implements SmsNotificationPort {
  constructor(private readonly logger: Logger) {}
  async sendOtp(phone: string, otp: string): Promise<void> {
    this.logger.info({ phone, otp }, '[SMS STUB] Would send OTP — not delivered in v1');
  }
}
```

### Acceptance Criteria
- Adapter does NOT throw — it resolves silently
- `npm run build` passes

---

## Task 10: Auth Mapper

**Skill**: `module-scaffold.md` (Step 3 — Mapper)
**Depends on**: Tasks 3, 1
**File**: `src/modules/auth/auth.mapper.ts`

Implement `UserMapper` class with three methods as specified in FEATURE_PLAN.md Section 13:
- `toPersistence(entity: UserEntity): Prisma.UserCreateInput`
- `toDomain(record: PrismaUser): UserEntity`
- `toResponse(entity: UserEntity): UserDto`

Also implement `VendorMapper`:
- `toPersistence(entity: VendorEntity): Prisma.VendorCreateInput`
- `toDomain(record: PrismaVendor): VendorEntity`
- `toResponse(entity: VendorEntity): { vendorId: string; vendorName: string }`

### Acceptance Criteria
- `toResponse` NEVER includes `passwordHash` or `deletedAt`
- BigInt IDs are converted to `string` in `toResponse`
- Dates are ISO 8601 strings in `toResponse`
- `npm run build` passes

---

## Task 11: Auth Types (DTOs)

**Skill**: `module-scaffold.md` (Step 2)
**Depends on**: Task 2
**File**: `src/modules/auth/auth.types.ts`

Implement all DTOs from FEATURE_PLAN.md Section 14:
- `UserDto` (extends ResponseBase)
- `TokenDto`
- `VendorContextDto`
- `SignupResponseDto`
- `LoginResponseDto`
- `RefreshResponseDto`

---

## Task 12: Command Services (6 use cases)

**Skill**: `module-scaffold.md` (Step 6), `error-handling.md`, `api-contract-design.md`
**Depends on**: Tasks 6, 7, 8, 9, 10, 11

Implement one service per command. Each service receives its dependencies via constructor injection and is tested independently.

### 12a. SignupService
**File**: `src/modules/auth/commands/signup/signup.service.ts`

Follow sequence diagram from FEATURE_PLAN.md Section 12 exactly.

Key steps:
1. Create `PhoneNumber` VO
2. `passwordUtil.hash(password)` → `HashedPassword` VO
3. `UserEntity.create({ phone, passwordHash })`
4. `VendorEntity.create({ name: vendorName })`
5. `prisma.$transaction(async tx => { insert user, insert vendor, lookup vendor_owner role, insert vendorUser })`
6. Generate access + refresh tokens via `JwtUtil`
7. `SessionRepository.create({ userId, accessToken, refreshToken, ip, userAgent, expiresAt })`
8. Return `SignupResponseDto`

Error handling: wrap $transaction in try/catch per Pattern 5 from `error-handling.md`.

### 12b. LoginService
**File**: `src/modules/auth/commands/login/login.service.ts`

1. `UserRepository.findByPhone(phone)`
2. If null or `deletedAt IS NOT NULL`: throw `UnauthorizedError('Invalid credentials')`
3. `passwordUtil.compare(password, user.passwordHash.unpack())`
4. If false: throw `UnauthorizedError('Invalid credentials')`
5. `user.recordLogin()`
6. `UserRepository.update(userId, { lastLoginAt: user.getProps().lastLoginAt })`
7. `VendorUserRepository.findActiveContextsByUserId(userId)` → vendor contexts
8. Generate tokens, create session
9. Return `LoginResponseDto`

**Critical**: NEVER reveal whether the failure was phone-not-found or wrong-password.

### 12c. RefreshTokenService
**File**: `src/modules/auth/commands/refresh-token/refresh-token.service.ts`

1. `JwtUtil.verifyRefreshToken(refreshToken)` → if invalid: `UnauthorizedError`
2. `SessionRepository.findByRefreshToken(refreshToken)` → if null or revoked: `UnauthorizedError`
3. `prisma.$transaction(async tx => { revoke old session, create new session })`
4. Generate new access + refresh tokens
5. Return `RefreshResponseDto`

### 12d. ForgotPasswordService
**File**: `src/modules/auth/commands/forgot-password/forgot-password.service.ts`

1. `UserRepository.findByPhone(phone)` → if null: return early with success (no error)
2. Generate 6-digit OTP: `Math.floor(100000 + Math.random() * 900000).toString()`
3. Generate reset token: `crypto.randomUUID()`
4. `PasswordResetTokenRepository.create({ userId, resetToken, otpCode, expiresAt: now + 15min })`
5. `SmsNotificationPort.sendOtp(phone, otp)`
6. Return `{ message: 'If an account with this phone number exists, an OTP has been sent.' }`

### 12e. ResetPasswordService
**File**: `src/modules/auth/commands/reset-password/reset-password.service.ts`

1. `PasswordResetTokenRepository.findValid({ resetToken, otpCode })` (where `isUsed = false AND expiresAt > now()`)
2. If null: `BadRequestError('Invalid or expired OTP')`
3. `UserRepository.findById(token.userId)` — confirm `user.phone === phone`
4. `passwordUtil.hash(newPassword)` → `HashedPassword` VO
5. `user.changePassword(hashedPassword)`
6. `prisma.$transaction(async tx => { markTokenUsed, updateUserPassword, revokeAllSessions })`
7. Return success message

### 12f. LogoutService
**File**: `src/modules/auth/commands/logout/logout.service.ts`

1. `SessionRepository.findByRefreshToken(refreshToken)`
2. If found and not revoked: `SessionRepository.revoke(session.id)`
3. Return (idempotent — no error if not found)

### Acceptance Criteria for all services
- Constructor-injected dependencies only (no direct Prisma imports, no singletons)
- All try/catch follows Pattern 5 from `error-handling.md`
- `logger.info` at start, `logger.info` at success, `logger.warn/error` on failure
- `npm run build` passes

---

## Task 13: Auth Middleware

**Skill**: `error-handling.md`
**Depends on**: Task 7 (JwtUtil)
**File**: `src/modules/auth/auth.middleware.ts`

Implement `authenticateToken` middleware per contract in FEATURE_PLAN.md Section 5.

```typescript
export const authenticateToken = (req: Request, res: Response, next: NextFunction): void => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return next(new UnauthorizedError('Authentication required'));
  }
  const token = header.slice(7);
  try {
    const payload = jwtUtil.verifyAccessToken(token);
    req.user = {
      userId: BigInt(payload.userId),
      phone: payload.phone,
      vendorIds: payload.vendorIds.map(BigInt),
    };
    next();
  } catch {
    next(new UnauthorizedError('Invalid or expired token'));
  }
};
```

Also extend Express's `Request` type (add `user` field) — either in this file or a `src/types/express.d.ts` global type declaration.

### Acceptance Criteria
- No DB calls in middleware
- `UnauthorizedError` (not 500) on any JWT failure
- `npm run build` passes

---

## Task 14: Auth Controller

**Skill**: `module-scaffold.md` (Step 7)
**Depends on**: Tasks 12, 13
**File**: `src/modules/auth/auth.controller.ts`

Implement `AuthController` class with 6 arrow-function methods:
- `signup` → `SignupService.execute()`
- `login` → `LoginService.execute()`
- `refresh` → `RefreshTokenService.execute()`
- `forgotPassword` → `ForgotPasswordService.execute()`
- `resetPassword` → `ResetPasswordService.execute()`
- `logout` → `LogoutService.execute()`

Each method follows the Extract → Delegate → Respond pattern:
```typescript
signup = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await this.signupService.execute({
      ...req.body,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    sendCreated(res, result);
  } catch (error) {
    next(error);
  }
};
```

Response helper mappings:
- `signup` → `sendCreated` (201)
- `login` → `sendSuccess` (200)
- `refresh` → `sendSuccess` (200)
- `forgotPassword` → `sendSuccess` (200)
- `resetPassword` → `sendSuccess` (200)
- `logout` → `sendSuccess` (200)

### Acceptance Criteria
- Arrow functions on all methods (proper `this` binding)
- No business logic in controller
- All wrapped in try/catch → `next(error)`
- `npm run build` passes

---

## Task 15: Auth Routes (Composition Root)

**Skill**: `module-scaffold.md` (Steps 8, 9)
**Depends on**: Tasks 4, 13, 14
**File**: `src/modules/auth/auth.routes.ts`

Wire all dependencies (Composition Root pattern) and register routes with correct middleware chain per FEATURE_PLAN.md:

```typescript
const router = Router();

// === Composition Root ===
const smsService: SmsNotificationPort = new SmsStubAdapter(logger);
const userRepository = new UserRepository();
const vendorRepository = new VendorRepository();
const sessionRepository = new SessionRepository();
const signupService = new SignupService(userRepository, vendorRepository, sessionRepository, jwtUtil, passwordUtil, logger);
// ... rest of services

const controller = new AuthController(
  signupService, loginService, refreshService, forgotService, resetService, logoutService,
);

// === Routes with rate limiters ===
router.post('/signup',          signupLimiter,          validate(signupSchema, 'body'),          controller.signup);
router.post('/login',           loginLimiter,           validate(loginSchema, 'body'),           controller.login);
router.post('/refresh',         refreshLimiter,         validate(refreshTokenSchema, 'body'),    controller.refresh);
router.post('/forgot-password', forgotPasswordLimiter,  validate(forgotPasswordSchema, 'body'), controller.forgotPassword);
router.post('/reset-password',                          validate(resetPasswordSchema, 'body'),  controller.resetPassword);
router.post('/logout',          authenticateToken,      validate(logoutSchema, 'body'),         controller.logout);

export default router;
```

**Rate limiter definitions**: Add to this file (see FEATURE_PLAN.md Section 8 for exact config). Rate limiters must use `TooManyRequestsError` in their handler so it goes through the centralized error handler.

### Register in app.ts
**File**: `src/app.ts`

Add:
```typescript
import authRoutes from '@/modules/auth/auth.routes';
// In the route registration section:
app.use(`${apiPrefix}/auth`, authRoutes);
```

### Acceptance Criteria
- Middleware chain order: `[rateLimiter] → [authenticateToken if protected] → validate → controller`
- `npm run build` passes
- `npm run dev` starts without errors
- Swagger docs at `/api-docs` renders without errors

---

## Task 16: Unit Tests — Domain Layer

**Skill**: `module-scaffold.md` (testing section)
**Depends on**: Task 3
**Files**:

### 16a. PhoneNumber VO tests
**File**: `src/modules/auth/__tests__/domain/phone-number.value-object.test.ts`

Test cases:
- Valid phone numbers accepted: `+919876543210`, `+12345678901`, `9876543210`
- Invalid phones rejected: empty string, `abc`, `123` (too short), `+0123456789` (starts with 0)
- `unpack()` returns the original value

### 16b. HashedPassword VO tests
**File**: `src/modules/auth/__tests__/domain/hashed-password.value-object.test.ts`

Test cases:
- Valid bcrypt hash (60 chars) accepted
- Empty string rejected
- String shorter than 60 chars rejected
- `unpack()` returns the hash

### 16c. UserEntity tests
**File**: `src/modules/auth/__tests__/domain/user.entity.test.ts`

Test cases:
- `UserEntity.create()` with valid props succeeds and emits `UserRegisteredEvent`
- `UserEntity.create()` with invalid phone VO throws `ArgumentInvalidException`
- `user.recordLogin()` updates `lastLoginAt` and emits `UserLoggedInEvent`
- `user.changePassword()` updates `passwordHash` and emits `PasswordChangedEvent`
- `user.softDelete()` sets `deletedAt`
- Invalid `preferredLanguage` in `validate()` throws `ArgumentInvalidException`

### 16d. JWT Utility tests
**File**: `src/modules/auth/__tests__/jwt.util.test.ts`

Test cases:
- `generateAccessToken` → `verifyAccessToken` round-trip succeeds
- `verifyAccessToken` with expired token throws `UnauthorizedError`
- `verifyAccessToken` with wrong secret throws `UnauthorizedError`
- Payload fields are preserved correctly

### 16e. Password Utility tests
**File**: `src/modules/auth/__tests__/password.util.test.ts`

Test cases:
- `hash(password)` produces a bcrypt string (starts with `$2b$`)
- `compare(password, hash)` returns true for correct password
- `compare(wrong, hash)` returns false for wrong password

### Acceptance Criteria
- All tests pass: `npm test -- --testPathPattern=auth`
- No real DB calls in unit tests

---

## Task 17: Integration Tests — All 6 Endpoints

**Skill**: `module-scaffold.md`
**Depends on**: Tasks 12–15
**File**: `tests/integration/auth.test.ts`

Use Supertest + Jest. Tests hit the real Express app with a test database.

### Test Suite Structure

```typescript
describe('POST /api/v1/auth/signup', () => {
  it('201 — valid signup creates user, vendor, vendorUser, returns tokens');
  it('400 — missing phone');
  it('400 — invalid phone format');
  it('400 — weak password');
  it('400 — missing vendorName');
  it('409 — duplicate phone');
  it('400 — unknown fields rejected (strict schema)');
});

describe('POST /api/v1/auth/login', () => {
  it('200 — valid credentials returns user, tokens, vendorContexts');
  it('401 — phone not found returns generic error (no enumeration)');
  it('401 — wrong password returns same generic error');
  it('400 — invalid phone format');
});

describe('POST /api/v1/auth/refresh', () => {
  it('200 — valid refresh token returns new tokens');
  it('401 — expired refresh token');
  it('401 — revoked refresh token');
  it('401 — invalid JWT string');
});

describe('POST /api/v1/auth/forgot-password', () => {
  it('200 — existing phone returns success (no error)');
  it('200 — non-existing phone returns same success (enumeration prevention)');
  it('400 — invalid phone format');
});

describe('POST /api/v1/auth/reset-password', () => {
  it('200 — valid OTP + resetToken updates password and revokes all sessions');
  it('400 — wrong OTP code');
  it('400 — expired OTP');
  it('400 — already used OTP');
  it('400 — invalid otpCode format (not 6 digits)');
});

describe('POST /api/v1/auth/logout', () => {
  it('200 — valid access token + refresh token revokes session');
  it('200 — idempotent: already-revoked refresh token returns 200');
  it('401 — missing Authorization header');
  it('401 — expired access token');
});
```

### Acceptance Criteria
- All integration tests pass against test DB
- Each test cleans up its created data in `afterEach`/`afterAll`
- Error responses include `correlationId`
- `npm run test:integration` passes

---

## Task 18: Swagger / OpenAPI Annotations

**Skill**: `api-contract-design.md`
**Depends on**: Task 15 (routes registered)
**File**: `src/modules/auth/auth.routes.ts` or inline JSDoc on controller methods

Add JSDoc OpenAPI annotations for all 6 endpoints. Minimum per endpoint:
- `@openapi` tag with method, path, summary, requestBody schema, responses (200/201, 400, 401, 409, 429)
- Tag group: `Authentication`
- Security: `[]` for public, `[bearerAuth]` for logout

### Acceptance Criteria
- `GET /api-docs` renders all 6 auth endpoints without errors
- Each endpoint shows request/response schema in Swagger UI
- `npm run dev` → visit `http://localhost:3000/api-docs` to verify visually

---

## Task 19: Seed Data

**Skill**: `prisma-schema-design.md` (Step 8)
**Depends on**: Task 1 (schema and migration)
**File**: `prisma/seeds/index.ts`

Implement seed data as specified in FEATURE_PLAN.md Section 15:

1. Upsert roles: `vendor_owner`, `vendor_staff`, `customer`
2. Upsert all permissions from `12-staff-management-rbac.sql` seed data comment (21 permissions)
3. Assign all permissions to `vendor_owner` role via `role_permissions` upsert
4. Assign relevant permissions to `vendor_staff` role (read-only subset: delivery:read, leave:read, etc.)
5. Dev-only: create test user `+919000000001` / `Test@123` with a test vendor

### Run seed:
```bash
npm run db:seed
```

### Acceptance Criteria
- `npm run db:seed` completes without errors
- `vendor_owner` role exists in DB
- All 21 permissions seeded
- Login with test user credentials works in development

---

## Task 20: Final Verification

**Depends on**: All previous tasks
**No files to create**

Run the full quality gate:

```bash
# 1. TypeScript
npm run build

# 2. Lint
npm run lint

# 3. All tests
npm test

# 4. Integration tests specifically
npm run test:integration

# 5. Manual smoke test (server must be running)
npm run dev
# Then:
# curl -X POST http://localhost:3000/api/v1/auth/signup \
#   -H 'Content-Type: application/json' \
#   -d '{"phone":"+919876543210","password":"Test@123x","vendorName":"Ramesh Dairy"}'
# Expected: 201 with user, tokens, vendorContext

# 6. Swagger docs
# Visit http://localhost:3000/api-docs — confirm 6 auth endpoints visible
```

### Acceptance Criteria
- `npm run build` exits 0
- `npm run lint` exits 0
- `npm test` — all tests pass (unit + integration)
- Signup → Login → Refresh → Logout flow works end-to-end via curl or Swagger UI
- Forgot-password logs OTP to console (stub behavior confirmed)
- Reset-password flow completes with OTP from console log

---

## Summary Checklist

| Task | Description | Skill | Status |
|------|-------------|-------|--------|
| 1 | Prisma schema + migration | prisma-schema-design | — |
| 2 | Module directory scaffold | module-scaffold | — |
| 3 | Domain entities + VOs + events | domain-modeling | — |
| 4 | Zod validation schemas | validation-schemas | — |
| 5 | Repository ports (interfaces) | module-scaffold | — |
| 6 | Repository Prisma adapters | module-scaffold + error-handling | — |
| 7 | JWT utility | api-contract-design | — |
| 8 | Password utility | error-handling | — |
| 9 | SMS port + stub adapter | api-contract-design (Strategy) | — |
| 10 | Auth mapper (3-way) | module-scaffold | — |
| 11 | Auth types / DTOs | module-scaffold | — |
| 12 | 6 command services | module-scaffold + error-handling | — |
| 13 | authenticateToken middleware | error-handling | — |
| 14 | Auth controller | module-scaffold | — |
| 15 | Auth routes + app.ts | module-scaffold | — |
| 16 | Unit tests (domain + utils) | module-scaffold | — |
| 17 | Integration tests (all 6 endpoints) | module-scaffold | — |
| 18 | Swagger / OpenAPI annotations | api-contract-design | — |
| 19 | Seed data (roles, permissions, dev user) | prisma-schema-design | — |
| 20 | Final verification (build, lint, test) | all | — |
