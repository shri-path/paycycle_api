# Feature Plan: Authentication & Account Setup (US-003)

**Last Updated**: 2026-06-07
**Feature Branch**: `feat/us-003-authentication`
**Status**: In Progress

---

## 1. Complexity Assessment

- **Tier**: Complex
- **Justification**:
  - Multi-aggregate coordination (User + Vendor + VendorUser created atomically in one transaction on signup)
  - Security-critical invariants: phone uniqueness enforced by DB unique constraint with ConflictError mapping, OTP expiry, token revocation
  - Stateful sessions: `user_sessions` with explicit revocation (`revoked_at`) and rotation semantics
  - OTP lifecycle: generate → persist → expire → validate → mark used
  - Domain Events emitted on signup, login, password change for downstream Audit module (US-007)
  - SMS integration via Strategy pattern (stub for v1, real adapter in the future)
  - Multi-vendor JWT payload: a user may belong to multiple vendors; all vendorIds are embedded in the access token
  - 6 endpoints with distinct security and rate-limiting rules
- **Skills applied**: `api-contract-design.md`, `prisma-schema-design.md`, `error-handling.md`, `validation-schemas.md`, `module-scaffold.md`

---

## 2. Module Directory Structure (Complex Tier)

Following the Complex Domain Module pattern with vertical command slicing:

```
src/modules/auth/
├── domain/
│   ├── user.entity.ts                      # User aggregate root — factory, invariants, behavior
│   ├── vendor.entity.ts                    # Vendor entity (creation scope only in this module)
│   ├── user.types.ts                       # UserProps, CreateUserProps, enums
│   ├── vendor.types.ts                     # VendorProps, CreateVendorProps
│   ├── auth.errors.ts                      # Domain-specific error subclasses (if needed)
│   ├── value-objects/
│   │   ├── phone-number.value-object.ts    # PhoneNumber VO with regex validation
│   │   └── hashed-password.value-object.ts # HashedPassword wrapper (wraps bcrypt hash)
│   └── events/
│       ├── user-registered.domain-event.ts
│       ├── user-logged-in.domain-event.ts
│       ├── password-changed.domain-event.ts
│       └── vendor-created.domain-event.ts
├── database/
│   ├── user.repository.port.ts             # IUserRepository interface (port)
│   ├── user.repository.ts                  # Prisma adapter for users
│   ├── vendor.repository.port.ts           # IVendorRepository interface (port)
│   ├── vendor.repository.ts                # Prisma adapter for vendors
│   └── session.repository.ts               # UserSession CRUD (no port — simple)
├── ports/
│   └── sms-notification.port.ts            # SmsNotificationPort interface
├── adapters/
│   └── sms-stub.adapter.ts                 # Stub SMS implementation (Pino logger, v1)
├── commands/
│   ├── signup/
│   │   ├── signup.service.ts               # RegisterUser command handler
│   │   └── signup.request.dto.ts           # Typed request DTO
│   ├── login/
│   │   ├── login.service.ts                # LoginUser command handler
│   │   └── login.request.dto.ts
│   ├── refresh-token/
│   │   ├── refresh-token.service.ts        # RefreshToken command handler
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
├── auth.mapper.ts                          # toPersistence / toDomain / toResponse
├── auth.types.ts                           # Shared DTOs: UserDto, TokenDto, VendorContextDto
├── auth.validator.ts                       # Zod schemas for all 6 endpoints
├── auth.controller.ts                      # HTTP handlers — try/catch → next(error)
├── auth.middleware.ts                      # authenticateToken middleware
├── auth.routes.ts                          # Route definitions + composition root
└── __tests__/
    ├── auth.controller.test.ts
    ├── auth.service.test.ts
    └── domain/
        ├── user.entity.test.ts
        ├── phone-number.value-object.test.ts
        └── hashed-password.value-object.test.ts
```

---

## 3. Aggregate Boundaries

### User Aggregate
- **Root**: `User` entity
- **Owns**: Nothing at the in-memory level — sessions and reset tokens are DB-side, referenced by `userId`
- **Value Objects (owned)**: `PhoneNumber`, `HashedPassword`
- **Cross-aggregate references**: `vendorId` via `VendorUser` join row — referenced by ID only, no in-memory Vendor object on User

### Vendor Aggregate (creation scope)
- **Root**: `Vendor` entity
- **Scope in this module**: Created atomically during signup; no further management here
- **Cross-aggregate references**: After creation, subsequent management belongs to US-011 (Settings)

### VendorUser (join — not a standalone aggregate here)
- Created as part of the `RegisterUser` command, within the same `$transaction`
- All subsequent management belongs to US-004 (Staff Management)
- The `vendor_owner` role is looked up from the seeded `roles` table during signup

### Cross-Aggregate Boundary Rule
- The auth module creates User, Vendor, and VendorUser rows **in one transaction** but owns none of their ongoing lifecycle except session and OTP management
- After signup, other modules reference `userId` and `vendorId` by ID only
- Domain Events (`UserRegisteredEvent`, `VendorCreatedEvent`) are the communication mechanism to downstream modules

---

## 4. API Endpoints

### Resource

| Resource | Base Path         | Aggregate Root | Module |
|----------|-------------------|----------------|--------|
| Auth     | /api/v1/auth      | User           | auth   |

All auth endpoints are **unauthenticated** except `POST /api/v1/auth/logout`.

---

### Endpoint 1: POST /api/v1/auth/signup

- **CQS Type**: Command (creates User + Vendor + VendorUser, emits domain events)
- **Auth**: Not required (public)
- **Rate Limit**: 3 requests per hour per IP (express-rate-limit)
- **Skill**: `validation-schemas.md`, `error-handling.md`

**Request Schema** (`.strict()` — reject unknown fields):

```typescript
// Zod schema: signupSchema
{
  phone: string          // Required. Regex ^\+?[1-9][0-9]{7,14}$. Trimmed.
  password: string       // Required. Min 8 chars, max 100 chars.
                         // Must contain: ≥1 uppercase, ≥1 lowercase, ≥1 digit, ≥1 special char.
  vendorName: string     // Required. Trimmed, min 1, max 150 chars.
}
```

**Response 201**:

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "1",
      "phone": "+919876543210",
      "name": null,
      "email": null,
      "preferredLanguage": "en",
      "createdAt": "2026-06-07T10:00:00.000Z",
      "updatedAt": "2026-06-07T10:00:00.000Z"
    },
    "tokens": {
      "accessToken": "eyJhbGc...",
      "refreshToken": "eyJhbGc..."
    },
    "vendorContext": {
      "vendorId": "1",
      "vendorName": "Ramesh Dairy",
      "role": "vendor_owner"
    }
  }
}
```

**Error Cases**:

| HTTP | Error Class     | Trigger                                    |
|------|-----------------|--------------------------------------------|
| 400  | ValidationError | Missing/invalid phone, password, vendorName |
| 409  | ConflictError   | Phone already registered (P2002 unique)    |
| 404  | NotFoundError   | `vendor_owner` role not seeded in DB       |
| 429  | TooManyRequestsError | Rate limit exceeded (3/hr per IP)     |
| 500  | InternalServerError | Transaction rollback, DB unavailable  |

---

### Endpoint 2: POST /api/v1/auth/login

- **CQS Type**: Command (updates `lastLoginAt`, creates `user_sessions` row)
- **Auth**: Not required (public)
- **Rate Limit**: 5 requests per 15 minutes per phone number (express-rate-limit, key = phone from body)
- **Skill**: `validation-schemas.md`, `error-handling.md`

**Request Schema** (`.strict()`):

```typescript
// Zod schema: loginSchema
{
  phone: string          // Required. Same regex as signup.
  password: string       // Required. Min 1, max 100 chars (no strength check on login).
}
```

**Response 200**:

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "1",
      "phone": "+919876543210",
      "name": "Ramesh",
      "email": null,
      "preferredLanguage": "en",
      "lastLoginAt": "2026-06-07T10:00:00.000Z",
      "createdAt": "2026-06-07T09:00:00.000Z",
      "updatedAt": "2026-06-07T10:00:00.000Z"
    },
    "tokens": {
      "accessToken": "eyJhbGc...",
      "refreshToken": "eyJhbGc..."
    },
    "vendorContexts": [
      {
        "vendorId": "1",
        "vendorName": "Ramesh Dairy",
        "role": "vendor_owner"
      }
    ]
  }
}
```

**Error Cases**:

| HTTP | Error Class       | Trigger                                                    |
|------|-------------------|------------------------------------------------------------|
| 400  | ValidationError   | Missing/invalid phone or password field                   |
| 401  | UnauthorizedError | Phone not found, wrong password, soft-deleted user         |
| 429  | TooManyRequestsError | Rate limit: 5 attempts in 15 minutes per phone         |

**Security Note**: Never distinguish phone-not-found from wrong-password in the error message. Always return the same generic `UnauthorizedError('Invalid credentials')`. This prevents phone enumeration attacks.

---

### Endpoint 3: POST /api/v1/auth/refresh

- **CQS Type**: Command (rotates session — revokes old, creates new)
- **Auth**: Not required (refresh token is the credential)
- **Rate Limit**: 10 requests per 15 minutes per IP
- **Skill**: `validation-schemas.md`, `error-handling.md`

**Request Schema** (`.strict()`):

```typescript
// Zod schema: refreshTokenSchema
{
  refreshToken: string   // Required. Non-empty JWT string.
}
```

**Response 200**:

```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGc...",
    "refreshToken": "eyJhbGc..."
  }
}
```

**Error Cases**:

| HTTP | Error Class       | Trigger                                                         |
|------|-------------------|-----------------------------------------------------------------|
| 400  | ValidationError   | Missing refreshToken field                                     |
| 401  | UnauthorizedError | JWT signature invalid, expired, session revoked (token reuse)  |

**Token Reuse Detection**: If `refreshToken` is valid JWT but not found in `user_sessions` (or `revoked_at IS NOT NULL`), this indicates a token reuse attempt. Revoke all sessions for that user (optional — conservative approach) or return 401. For v1, return 401 only.

---

### Endpoint 4: POST /api/v1/auth/forgot-password

- **CQS Type**: Command (generates OTP, persists reset token, stubs SMS)
- **Auth**: Not required (public)
- **Rate Limit**: 3 requests per hour per phone
- **Skill**: `validation-schemas.md`, `error-handling.md`

**Request Schema** (`.strict()`):

```typescript
// Zod schema: forgotPasswordSchema
{
  phone: string   // Required. Same regex as signup.
}
```

**Response 200** (always identical regardless of whether phone exists — prevents enumeration):

```json
{
  "success": true,
  "data": {
    "message": "If an account with this phone number exists, an OTP has been sent."
  }
}
```

**Error Cases**:

| HTTP | Error Class         | Trigger                          |
|------|---------------------|----------------------------------|
| 400  | ValidationError     | Missing/invalid phone field      |
| 429  | TooManyRequestsError | Rate limit: 3 per hour per phone |

**SMS Stub Behavior** (v1): `logger.info({ phone, otp }, '[SMS STUB] OTP for password reset')` — never calls a real SMS API.

---

### Endpoint 5: POST /api/v1/auth/reset-password

- **CQS Type**: Command (validates OTP, updates password, revokes all sessions)
- **Auth**: Not required (OTP + reset token is the credential)
- **Rate Limit**: None (already rate-limited on forgot-password; OTP itself is the defense)
- **Skill**: `validation-schemas.md`, `error-handling.md`

**Request Schema** (`.strict()`):

```typescript
// Zod schema: resetPasswordSchema
{
  phone: string          // Required. Used to confirm user identity.
  resetToken: string     // Required. UUID/crypto token from forgot-password flow.
  otpCode: string        // Required. Exactly 6 digits. Regex: /^[0-9]{6}$/.
  newPassword: string    // Required. Same strength rules as signup (min 8, complexity).
}
```

**Response 200**:

```json
{
  "success": true,
  "data": {
    "message": "Password updated successfully. Please log in with your new password."
  }
}
```

**Error Cases**:

| HTTP | Error Class       | Trigger                                                                      |
|------|-------------------|------------------------------------------------------------------------------|
| 400  | ValidationError   | Missing/invalid fields                                                       |
| 400  | BadRequestError   | OTP not found, already used, expired, or phone mismatch                     |
| 404  | NotFoundError     | User not found for userId on the reset token (should not happen in normal flow) |
| 500  | InternalServerError | Transaction failure                                                         |

---

### Endpoint 6: POST /api/v1/auth/logout

- **CQS Type**: Command (revokes single refresh token / session)
- **Auth**: Required — `authenticateToken` middleware (access token in `Authorization: Bearer`)
- **Rate Limit**: None
- **Skill**: `validation-schemas.md`, `error-handling.md`

**Request Schema** (`.strict()`):

```typescript
// Zod schema: logoutSchema
{
  refreshToken: string   // Required. The refresh token for the session to revoke.
}
```

**Response 200** (not 204 — idempotent operation returns success even if token not found):

```json
{
  "success": true,
  "data": {
    "message": "Logged out successfully."
  }
}
```

**Error Cases**:

| HTTP | Error Class       | Trigger                                         |
|------|-------------------|-------------------------------------------------|
| 400  | ValidationError   | Missing refreshToken                           |
| 401  | UnauthorizedError | Missing or invalid access token in Auth header |

**Idempotency**: If the refresh token is not found in `user_sessions`, still return 200 — logout is idempotent.

---

## 5. Middleware Contract: `authenticateToken`

**File**: `src/modules/auth/auth.middleware.ts`

```typescript
// Contract
export const authenticateToken = (req: Request, res: Response, next: NextFunction): void => {
  // 1. Extract Bearer token from Authorization header
  // 2. If missing → throw UnauthorizedError('Authentication required')
  // 3. jwt.verify(token, JWT_SECRET) — if expired/invalid → throw UnauthorizedError('Invalid token')
  // 4. Attach decoded payload to req.user:
  //    req.user = { userId: bigint, phone: string, vendorIds: bigint[] }
  // 5. Call next()
  // NO DB CALL — middleware is stateless, relies on JWT signature
};

// Extended Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: bigint;
        phone: string;
        vendorIds: bigint[];
      };
    }
  }
}
```

**Middleware Chain Order (all routes)**:
```
rate-limit → (authenticateToken if protected) → validate(schema, 'body') → controller method
```

---

## 6. Prisma Models Needed

### Existing Models (verify match with DB design SQLs)

All six tables already exist in the DB design SQL files. The Prisma schema must map them exactly.

#### Model: User
```prisma
model User {
  id                BigInt      @id @default(autoincrement())
  phone             String      @unique @db.VarChar(15)
  passwordHash      String      @map("password_hash") @db.VarChar(255)
  name              String?     @db.VarChar(100)
  email             String?     @db.VarChar(100)
  profilePhotoUrl   String?     @map("profile_photo_url") @db.VarChar(500)
  preferredLanguage String      @map("preferred_language") @db.VarChar(10) @default("en")
  lastLoginAt       DateTime?   @map("last_login_at")
  createdAt         DateTime    @default(now()) @map("created_at")
  updatedAt         DateTime    @updatedAt @map("updated_at")
  deletedAt         DateTime?   @map("deleted_at")

  // Relations (for query convenience — read-only, cross-aggregate)
  sessions          UserSession[]
  passwordResets    PasswordResetToken[]
  vendorUsers       VendorUser[]
  auditLogs         AuditLog[]

  @@index([phone])
  @@index([email])
  @@index([createdAt])
  @@index([deletedAt])
  @@map("users")
}
```

#### Model: UserSession
```prisma
model UserSession {
  id             BigInt    @id @default(autoincrement())
  userId         BigInt    @map("user_id")
  accessToken    String?   @map("access_token") @db.VarChar(500)
  refreshToken   String?   @map("refresh_token") @db.VarChar(500)
  deviceId       String?   @map("device_id") @db.VarChar(100)
  deviceName     String?   @map("device_name") @db.VarChar(200)
  ipAddress      String?   @map("ip_address") @db.VarChar(45)
  userAgent      String?   @map("user_agent")
  lastActivityAt DateTime  @default(now()) @map("last_activity_at")
  expiresAt      DateTime  @map("expires_at")
  revokedAt      DateTime? @map("revoked_at")
  createdAt      DateTime  @default(now()) @map("created_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([refreshToken])
  @@index([expiresAt])
  @@index([lastActivityAt])
  @@map("user_sessions")
}
```

#### Model: PasswordResetToken
```prisma
model PasswordResetToken {
  id         BigInt    @id @default(autoincrement())
  userId     BigInt    @map("user_id")
  resetToken String    @unique @map("reset_token") @db.VarChar(255)
  otpCode    String    @map("otp_code") @db.VarChar(6)
  isUsed     Boolean   @default(false) @map("is_used")
  usedAt     DateTime? @map("used_at")
  expiresAt  DateTime  @map("expires_at")
  createdAt  DateTime  @default(now()) @map("created_at")
  updatedAt  DateTime  @updatedAt @map("updated_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([resetToken])
  @@index([expiresAt])
  @@map("password_reset_tokens")
}
```

#### Model: Vendor
```prisma
model Vendor {
  id                  BigInt    @id @default(autoincrement())
  name                String    @db.VarChar(150)
  phone               String?   @db.VarChar(15)
  category            String?   @db.VarChar(50)
  referralCode        String?   @unique @map("referral_code") @db.VarChar(50)
  referredByVendorId  BigInt?   @map("referred_by_vendor_id")
  autoMarkEnabled     Boolean   @default(true) @map("auto_mark_enabled")
  autoSendBills       Boolean   @default(false) @map("auto_send_bills")
  autoSendTime        String?   @default("20:00") @map("auto_send_time") @db.VarChar(5)
  upiId               String?   @map("upi_id") @db.VarChar(100)
  bankDetails         Json?     @map("bank_details")
  createdAt           DateTime  @default(now()) @map("created_at")
  updatedAt           DateTime  @updatedAt @map("updated_at")
  deletedAt           DateTime? @map("deleted_at")

  referredBy    Vendor?     @relation("VendorReferrals", fields: [referredByVendorId], references: [id], onDelete: SetNull)
  referrals     Vendor[]    @relation("VendorReferrals")
  vendorUsers   VendorUser[]

  @@index([referralCode])
  @@index([category])
  @@index([phone])
  @@index([referredByVendorId])
  @@index([deletedAt])
  @@map("vendors")
}
```

#### Model: VendorUser (reference — owned by US-004/RBAC module)
```prisma
model VendorUser {
  id             BigInt           @id @default(autoincrement())
  vendorId       BigInt           @map("vendor_id")
  userId         BigInt           @map("user_id")
  roleId         BigInt           @map("role_id")
  status         VendorUserStatus @default(ACTIVE)
  phone          String?          @db.VarChar(15)
  areaRouteLabel String?          @map("area_route_label") @db.VarChar(200)
  invitedAt      DateTime?        @map("invited_at")
  joinedAt       DateTime?        @map("joined_at")
  disabledAt     DateTime?        @map("disabled_at")
  removedAt      DateTime?        @map("removed_at")
  createdAt      DateTime         @default(now()) @map("created_at")
  updatedAt      DateTime         @updatedAt @map("updated_at")
  deletedAt      DateTime?        @map("deleted_at")

  vendor Vendor @relation(fields: [vendorId], references: [id], onDelete: Cascade)
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  role   Role   @relation(fields: [roleId], references: [id], onDelete: Restrict)

  @@unique([vendorId, userId])
  @@index([vendorId])
  @@index([userId])
  @@index([roleId])
  @@index([status])
  @@index([deletedAt])
  @@map("vendor_users")
}

enum VendorUserStatus {
  INVITED
  ACTIVE
  DISABLED
  REMOVED
  @@map("vendor_user_status")
}
```

#### Model: Role (reference — seeded by init migration)
```prisma
model Role {
  id          BigInt    @id @default(autoincrement())
  name        String    @unique @db.VarChar(50)
  displayName String    @map("display_name") @db.VarChar(100)
  description String?
  createdAt   DateTime  @default(now()) @map("created_at")
  updatedAt   DateTime  @updatedAt @map("updated_at")

  vendorUsers VendorUser[]
  rolePermissions RolePermission[]

  @@index([name])
  @@map("roles")
}
```

---

## 7. JWT Utility Contract

**File**: `src/modules/auth/utils/jwt.util.ts` (or `src/infrastructure/utils/jwt.util.ts`)

```typescript
interface JwtAccessPayload {
  userId: string;       // BigInt serialized as string
  phone: string;
  vendorIds: string[];  // BigInt[] serialized as string[]
}

interface JwtRefreshPayload {
  userId: string;
  sessionId: string;    // BigInt session ID, for lookup
}

interface JwtUtil {
  generateAccessToken(payload: JwtAccessPayload): string;   // exp: 1h
  generateRefreshToken(payload: JwtRefreshPayload): string; // exp: 30d
  verifyAccessToken(token: string): JwtAccessPayload;       // throws UnauthorizedError on fail
  verifyRefreshToken(token: string): JwtRefreshPayload;     // throws UnauthorizedError on fail
}
```

**Configuration** (from env):
- `JWT_SECRET` — HS256 signing key (min 32 chars)
- `JWT_ACCESS_EXPIRY` — default `1h`
- `JWT_REFRESH_EXPIRY` — default `30d`

---

## 8. Rate Limiting Strategy

Using `express-rate-limit` configured per route, not globally.

| Endpoint          | Limit     | Window  | Key                    | Rationale                            |
|-------------------|-----------|---------|------------------------|--------------------------------------|
| POST /auth/signup  | 3 req     | 1 hour  | IP address             | Prevent mass account creation        |
| POST /auth/login   | 5 req     | 15 min  | Phone (from req.body)  | Brute force protection per account   |
| POST /auth/refresh | 10 req    | 15 min  | IP address             | Token churn protection               |
| POST /auth/forgot-password | 3 req | 1 hour | Phone (from req.body) | OTP abuse prevention              |
| POST /auth/reset-password  | None | —      | —                      | OTP itself is the rate-limiting mechanism |
| POST /auth/logout  | None      | —       | —                      | No abuse vector                     |

**Implementation pattern** (in `auth.routes.ts`):

```typescript
import rateLimit from 'express-rate-limit';

const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour
  max: 3,
  keyGenerator: (req) => req.ip ?? 'unknown',
  handler: (_req, _res, next) =>
    next(new TooManyRequestsError('Too many signup attempts. Try again in an hour.')),
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 min
  max: 5,
  keyGenerator: (req) => (req.body as { phone?: string })?.phone ?? req.ip ?? 'unknown',
  handler: (_req, _res, next) =>
    next(new TooManyRequestsError('Too many login attempts. Try again in 15 minutes.')),
});
```

---

## 9. SMS Service Strategy Pattern

### Port (Interface)
**File**: `src/modules/auth/ports/sms-notification.port.ts`

```typescript
export interface SmsNotificationPort {
  /**
   * Send an OTP to the given phone number.
   * Implementations must not throw — they should log and resolve silently on failure,
   * or throw SmsDeliveryError for the service to catch and handle.
   */
  sendOtp(phone: string, otp: string): Promise<void>;
}
```

### Stub Adapter (v1)
**File**: `src/modules/auth/adapters/sms-stub.adapter.ts`

```typescript
export class SmsStubAdapter implements SmsNotificationPort {
  constructor(private readonly logger: Logger) {}

  async sendOtp(phone: string, otp: string): Promise<void> {
    this.logger.info({ phone, otp }, '[SMS STUB] Would send OTP via SMS — not delivered in v1');
    // No real delivery. Resolves immediately.
  }
}
```

### Selection in Composition Root
**File**: `src/modules/auth/auth.routes.ts`

```typescript
// Composition root — inject stub for v1
const smsService: SmsNotificationPort = new SmsStubAdapter(logger);
const forgotPasswordService = new ForgotPasswordService(
  userRepository, resetTokenRepository, smsService, logger
);
```

### Future Real Adapter
```typescript
// Future: src/modules/auth/adapters/msg91.adapter.ts
export class Msg91SmsAdapter implements SmsNotificationPort {
  async sendOtp(phone: string, otp: string): Promise<void> { /* ... */ }
}
```

---

## 10. Validation Schemas Summary

**File**: `src/modules/auth/auth.validator.ts`

All schemas use `.strict()` to reject unknown fields.

| Schema             | Zod Pattern          | Key Constraints                                                  |
|--------------------|----------------------|------------------------------------------------------------------|
| `signupSchema`     | `.strict()`          | phone regex, password min 8 complexity, vendorName max 150      |
| `loginSchema`      | `.strict()`          | phone regex, password min 1                                      |
| `refreshTokenSchema` | `.strict()`        | refreshToken non-empty string                                   |
| `forgotPasswordSchema` | `.strict()`      | phone regex                                                      |
| `resetPasswordSchema` | `.strict()`       | phone regex, resetToken non-empty, otpCode /^[0-9]{6}$/, newPassword complexity |
| `logoutSchema`     | `.strict()`          | refreshToken non-empty string                                   |

**Password strength regex** (applied on signup and reset-password only):
```typescript
const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(100, 'Password must be at most 100 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one digit')
  .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character');
```

---

## 11. Error Handling Strategy

### Error Class Mapping per Operation

| Operation         | Error Class        | HTTP | Trigger                                            |
|-------------------|--------------------|------|----------------------------------------------------|
| Phone duplicate   | ConflictError      | 409  | Prisma P2002 on `users.phone` unique index        |
| Login fail        | UnauthorizedError  | 401  | Phone not found OR wrong password (same message)  |
| Deleted user      | UnauthorizedError  | 401  | `deletedAt IS NOT NULL` — masked as credentials failure |
| Invalid JWT       | UnauthorizedError  | 401  | JWT verify fails in middleware or refresh service |
| Revoked session   | UnauthorizedError  | 401  | `revoked_at IS NOT NULL` on session lookup        |
| Bad OTP           | BadRequestError    | 400  | OTP not found, expired, or already used           |
| Role not seeded   | NotFoundError      | 404  | `vendor_owner` role missing from DB               |
| Transaction fail  | InternalServerError | 500 | Any uncaught Prisma error in $transaction         |
| Rate limit        | TooManyRequestsError | 429 | express-rate-limit handler triggers next(error)  |

### Multi-Tenant Masking
This module has no multi-tenant resource isolation (auth is pre-tenant-context). However:
- User phone enumeration is masked in forgot-password (always 200)
- Login phone enumeration is masked (generic 401 for both phone-not-found and wrong-password)

### Transaction Error Pattern
```typescript
try {
  await prisma.$transaction(async (tx) => { /* ... */ });
} catch (error) {
  if (error instanceof AppError) throw error;  // Re-throw business errors
  logger.error({ error }, 'Signup transaction failed');
  throw new InternalServerError('Registration failed. Please try again.');
}
```

### Repository P2002 Handling
```typescript
// user.repository.ts
async insert(data: Prisma.UserCreateInput, tx?: PrismaTransaction): Promise<User> {
  try {
    return await this.getClient(tx).create({ data });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictError('Phone number is already registered');
    }
    throw error;
  }
}
```

---

## 12. Sequence Diagrams

### Signup Flow

```
Client
  → POST /auth/signup { phone, password, vendorName }
  → [signupLimiter] rate-limit check
  → [validate(signupSchema, 'body')]
  → AuthController.signup()
    → SignupService.execute({ phone, password, vendorName, ip })
      → PhoneNumber.create(phone)                # VO validation
      → bcrypt.hash(password, 10)               # In service, not in entity
      → HashedPassword.create(hash)              # VO wrapping
      → prisma.$transaction(async tx => {
          → UserRepository.insert(user, tx)      # may throw ConflictError (P2002)
          → VendorRepository.insert(vendor, tx)
          → roles lookup: findByName('vendor_owner', tx)
          → VendorUserRepository.insert(vendorUser, tx)
        })
      → JwtUtil.generateAccessToken({ userId, phone, vendorIds: [vendorId] })
      → JwtUtil.generateRefreshToken({ userId, sessionId })
      → SessionRepository.create(session)
      → Dispatch UserRegisteredEvent, VendorCreatedEvent → AuditLog (async, after commit)
      → return { user, tokens, vendorContext }
    ← SignupService returns AuthResponseDto
  → AuthMapper.toResponse(user)
  ← 201 { success: true, data: { user, tokens, vendorContext } }
```

### Login Flow

```
Client
  → POST /auth/login { phone, password }
  → [loginLimiter] rate-limit (key: phone)
  → [validate(loginSchema, 'body')]
  → AuthController.login()
    → LoginService.execute({ phone, password, ip, userAgent, deviceId })
      → UserRepository.findByPhone(phone)
        → null OR deletedAt IS NOT NULL → throw UnauthorizedError('Invalid credentials')
      → bcrypt.compare(password, user.passwordHash)
        → false → throw UnauthorizedError('Invalid credentials')
      → user.recordLogin()                       # sets lastLoginAt, emits UserLoggedInEvent
      → UserRepository.update(user)
      → VendorUserRepository.findActiveContextsByUserId(userId)
      → JwtUtil.generateAccessToken({ userId, phone, vendorIds })
      → JwtUtil.generateRefreshToken({ userId, sessionId })
      → SessionRepository.create(session)
      → Dispatch UserLoggedInEvent → AuditLog
      → return { user, tokens, vendorContexts }
    ← LoginService returns LoginResponseDto
  ← 200 { success: true, data: { user, tokens, vendorContexts } }
```

### Password Reset Flow

```
Client
  → POST /auth/forgot-password { phone }
  → [forgotPasswordLimiter] rate-limit (key: phone)
  → ForgotPasswordService.execute({ phone })
    → UserRepository.findByPhone(phone)
      → not found: return early (no error — phone enumeration prevention)
    → crypto.randomInt(100000, 999999).toString() → otp
    → crypto.randomUUID() → resetToken
    → PasswordResetTokenRepository.create({ userId, otp, resetToken, expiresAt: now+15min })
    → SmsNotificationPort.sendOtp(phone, otp)  # stub: logger.info
    → return { message: 'If account exists, OTP sent' }
  ← 200

Client
  → POST /auth/reset-password { phone, resetToken, otpCode, newPassword }
  → [validate(resetPasswordSchema, 'body')]
  → ResetPasswordService.execute({ phone, resetToken, otpCode, newPassword })
    → PasswordResetTokenRepository.findValid({ resetToken, otpCode })
      → not found / expired / used → throw BadRequestError('Invalid or expired OTP')
    → UserRepository.findById(token.userId)
      → confirm user.phone === phone → if mismatch: throw BadRequestError
    → bcrypt.hash(newPassword, 10)
    → user.changePassword(newHash)    # emits PasswordChangedEvent
    → prisma.$transaction(async tx => {
        → PasswordResetTokenRepository.markUsed(token.id, tx)
        → UserRepository.updatePassword(userId, newHash, tx)
        → SessionRepository.revokeAll(userId, tx)
      })
    → Dispatch PasswordChangedEvent → AuditLog
    → return { message: 'Password updated successfully' }
  ← 200
```

---

## 13. Mapper Design

**File**: `src/modules/auth/auth.mapper.ts`

```typescript
export class UserMapper {
  toPersistence(entity: UserEntity): Prisma.UserCreateInput {
    const props = entity.getProps();
    return {
      phone: props.phone.unpack(),
      passwordHash: props.passwordHash.unpack(),
      name: props.name ?? null,
      email: props.email ?? null,
      preferredLanguage: props.preferredLanguage,
    };
  }

  toDomain(record: PrismaUser): UserEntity {
    return UserEntity.reconstitute({
      id: record.id,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      props: {
        phone: PhoneNumber.create(record.phone),
        passwordHash: HashedPassword.create(record.passwordHash),
        name: record.name,
        email: record.email,
        preferredLanguage: record.preferredLanguage,
        lastLoginAt: record.lastLoginAt,
        deletedAt: record.deletedAt,
      },
    });
  }

  toResponse(entity: UserEntity): UserDto {
    const props = entity.getProps();
    return {
      id: props.id.toString(),
      phone: props.phone.unpack(),
      name: props.name ?? null,
      email: props.email ?? null,
      profilePhotoUrl: props.profilePhotoUrl ?? null,
      preferredLanguage: props.preferredLanguage,
      lastLoginAt: props.lastLoginAt?.toISOString() ?? null,
      createdAt: props.createdAt.toISOString(),
      updatedAt: props.updatedAt.toISOString(),
      // NEVER include: passwordHash, deletedAt
    };
  }
}
```

---

## 14. Response DTOs

**File**: `src/modules/auth/auth.types.ts`

```typescript
// === ResponseBase (from domain-driven-hexagon) ===
interface ResponseBase {
  id: string;          // BigInt as string
  createdAt: string;   // ISO 8601
  updatedAt: string;   // ISO 8601
}

// === UserDto ===
export interface UserDto extends ResponseBase {
  phone: string;
  name: string | null;
  email: string | null;
  profilePhotoUrl: string | null;
  preferredLanguage: string;
  lastLoginAt: string | null;
  // NEVER: passwordHash, deletedAt
}

// === TokenDto ===
export interface TokenDto {
  accessToken: string;
  refreshToken: string;
}

// === VendorContextDto ===
export interface VendorContextDto {
  vendorId: string;    // BigInt as string
  vendorName: string;
  role: string;        // 'vendor_owner' | 'vendor_staff'
}

// === Auth Response DTOs ===
export interface SignupResponseDto {
  user: UserDto;
  tokens: TokenDto;
  vendorContext: VendorContextDto;
}

export interface LoginResponseDto {
  user: UserDto;
  tokens: TokenDto;
  vendorContexts: VendorContextDto[];
}

export interface RefreshResponseDto {
  accessToken: string;
  refreshToken: string;
}
```

---

## 15. Seed Data Plan

**File**: `prisma/seeds/index.ts`

### Phase 1 Seed (required before any auth flow works)

```typescript
// 1. Roles
await prisma.role.upsert({
  where: { name: 'vendor_owner' },
  update: {},
  create: {
    name: 'vendor_owner',
    displayName: 'Vendor Owner',
    description: 'Full control over the vendor business',
  },
});

await prisma.role.upsert({
  where: { name: 'vendor_staff' },
  update: {},
  create: {
    name: 'vendor_staff',
    displayName: 'Vendor Staff',
    description: 'Limited permissions assigned by the owner',
  },
});

// 2. Core Permissions (auth-related)
const authPermissions = [
  { name: 'vendor:read',   resource: 'vendor',   action: 'read',   description: 'View vendor details' },
  { name: 'vendor:write',  resource: 'vendor',   action: 'write',  description: 'Edit vendor details' },
  { name: 'staff:read',    resource: 'staff',    action: 'read',   description: 'View staff' },
  { name: 'staff:write',   resource: 'staff',    action: 'write',  description: 'Add/edit staff' },
  { name: 'staff:delete',  resource: 'staff',    action: 'delete', description: 'Remove staff' },
  // ... remaining permissions from 12-staff-management-rbac.sql
];

for (const perm of authPermissions) {
  await prisma.permission.upsert({
    where: { name: perm.name },
    update: {},
    create: perm,
  });
}

// 3. Assign all permissions to vendor_owner role
// (done in US-002 seed — auth module only seeds roles)
```

### Development Seed (non-production)
```typescript
// Development: create a test vendor owner with known credentials
if (process.env.NODE_ENV !== 'production') {
  const hash = await bcrypt.hash('Test@123', 10);
  const user = await prisma.user.upsert({
    where: { phone: '+919000000001' },
    update: {},
    create: { phone: '+919000000001', passwordHash: hash, name: 'Test Owner', preferredLanguage: 'en' },
  });
  const ownerRole = await prisma.role.findFirst({ where: { name: 'vendor_owner' } });
  const vendor = await prisma.vendor.create({ data: { name: 'Test Vendor' } });
  await prisma.vendorUser.upsert({
    where: { vendorId_userId: { vendorId: vendor.id, userId: user.id } },
    update: {},
    create: { vendorId: vendor.id, userId: user.id, roleId: ownerRole!.id, status: 'ACTIVE' },
  });
}
```

---

## 16. Security Considerations

1. **Phone enumeration prevention**: forgot-password always returns 200; login always returns the same 401 message
2. **Timing attack prevention**: `bcrypt.compare` always runs even if user not found (find a dummy hash and compare against it — or use a constant-time dummy compare)
3. **Password strength**: Enforced at API boundary (Zod) on signup and reset — not at entity level, to avoid re-hashing concerns
4. **Token storage**: Refresh tokens stored in DB with `revoked_at` for revocation; access tokens are stateless
5. **Token rotation**: Every refresh call revokes the old session row and creates a new one atomically
6. **Soft-deleted users cannot authenticate**: `deletedAt IS NOT NULL` check during login
7. **OTP expiry**: 15 minutes — enforced at query time (`expiresAt > now()`)
8. **OTP single-use**: `isUsed = true` set atomically in the same transaction as password update
9. **bcrypt rounds**: 10 (good balance between security and latency ~100ms on modern hardware)
10. **JWT secret**: HS256, loaded from `JWT_SECRET` env var, min 32 chars validated on startup

---

## 17. Performance Considerations

1. **bcrypt is CPU-bound**: 10 rounds ≈ 100ms per hash; acceptable for auth flows. Do NOT increase in hot paths.
2. **Session lookup**: `user_sessions.refresh_token` is indexed — O(1) lookup
3. **Phone lookup**: `users.phone` is UNIQUE indexed — O(1) lookup
4. **Vendor contexts on login**: One query `SELECT vendor_id, role FROM vendor_users WHERE user_id = ? AND status = ACTIVE` — indexed by `user_id`
5. **$transaction overhead**: Signup has 4 DB operations in one transaction — acceptable for a low-frequency endpoint

---

## 18. Open Questions

1. **Token reuse detection policy**: When a refresh token is presented that is already revoked (`revoked_at IS NOT NULL`), should we revoke ALL active sessions for that user (conservative / "detect theft" approach)? Or just return 401 for the specific token? For v1 the plan is return 401 only. Confirm before implementing.

2. **OTP delivery channel**: The DB has `password_reset_tokens` but no channel field. For v1 SMS is stubbed. When real SMS is introduced, should we log the channel (`SMS`, `WHATSAPP`) on the token row?

3. **Session metadata**: `deviceId`, `deviceName`, `userAgent` — should the client send these in the request body, or should the server extract `userAgent` from headers only and accept `deviceId` / `deviceName` from body? Current plan: `userAgent` from `req.headers['user-agent']`, `deviceId` and `deviceName` from optional body fields (not validated strictly in v1).

4. **`updatedAt` on `UserSession`**: The DB design SQL has no `updated_at` on `user_sessions` (only `last_activity_at`). Prisma `@updatedAt` requires `updatedAt`. Do NOT add `updatedAt` to `user_sessions` — use `lastActivityAt` for activity tracking instead. Confirm this is intentional.

---

## Skills Reference Checklist

- [x] `api-contract-design.md` — All 6 endpoints with CQS, request/response, errors, security matrix
- [x] `prisma-schema-design.md` — All 5 models with aggregate boundaries, indexes, naming conventions
- [x] `error-handling.md` — Error class mapping per operation, P2002 handling, transaction error pattern
- [x] `validation-schemas.md` — `.strict()` on all mutation schemas, phone regex, password strength, field max lengths
- [x] `module-scaffold.md` — Complex tier structure, composition root in routes, middleware chain order
