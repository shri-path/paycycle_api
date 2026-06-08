# Domain Model: Authentication & Account Setup (US-003)

## Complexity Assessment

- **Level**: Complex
- **Justification**: Multiple aggregates (User, Vendor, VendorUser), cross-aggregate transaction on signup, stateful sessions, OTP lifecycle with time-based expiry, security-sensitive invariants (phone uniqueness, token revocation), domain events for downstream modules (AuditLog), and multi-vendor context in JWT claims.
- **Architecture depth**: Full DDD — Entities with behavior, Value Objects for Phone/Password, Domain Events, Application Services with ports & adapters. Vertical slicing for each auth use-case.

---

## Ubiquitous Language

| Term | Definition |
|------|-----------|
| **User** | A person who has registered an account via phone number. Shared across all vendor contexts and customer personas. |
| **Vendor** | A business entity owned and operated by a vendor owner. Created atomically with the first user during signup. |
| **VendorUser** | The join between a User and a Vendor, carrying role and status. The owner is a VendorUser with role `vendor_owner`. |
| **Session** | A JWT session stored in `user_sessions`. Holds access + refresh tokens and device metadata. Active when `revoked_at IS NULL` and `expires_at > now()`. |
| **OTP** | A 6-digit one-time passcode stored in `password_reset_tokens`, valid for 15 minutes. |
| **ResetToken** | A unique cryptographic token (`reset_token`) sent via stub/SMS, paired with an OTP for password reset. |
| **Phone** | A user's primary identity — must match `^\+?[1-9][0-9]{7,14}$`. Globally unique in the `users` table. |
| **Vendor Context** | A `{ vendorId, role }` pair representing one membership. Users may belong to multiple vendor contexts. |
| **Token Rotation** | On refresh, the old refresh token is revoked and a new session row is created atomically. |

---

## Context Map

### Owned Concepts
- **User** — account identity, credentials, session lifecycle, password reset
- **Vendor** — created on signup, initial setup only (no settings management here)
- **VendorUser** — owner relationship established during signup

### Boundaries
- This module OWNS: `users`, `user_sessions`, `password_reset_tokens`, `vendors` (creation only), `vendor_users` (owner record creation only)
- This module DOES NOT OWN: vendor settings (US-011), staff management (US-004), RBAC permission assignment (US-002), customer accounts (US-008)
- All internals are private — no other module imports from `src/modules/auth/`

### Relationships

| Related Context | Relationship | Integration Pattern | Communication | Shared Data |
|----------------|-------------|-------------------|----------------|-------------|
| Staff (US-004) | Downstream | Conformist | Domain Events | userId, vendorId |
| Audit (US-007) | Downstream | Open Host | Domain Events | userId, action |
| User (CRUD) | Downstream | Shared Kernel | Direct (same bounded context) | userId |
| Vendor (CRUD) | Downstream | Shared Kernel | Direct (same bounded context) | vendorId |

### Cross-Module Communication Strategy
- **UserRegistered** event → consumed by Audit module to log signup
- **UserLoggedIn** event → consumed by Audit module
- **PasswordChanged** event → consumed by Audit module
- Future: **UserRegistered** → Notification module (welcome SMS/WhatsApp)

---

## Aggregates

### User Aggregate
- **Root Entity**: `User` (extends entity base)
- **Nested Entities**: None (sessions and reset tokens are referenced by userId, not owned in memory)
- **Value Objects**: `PhoneNumber`, `HashedPassword`
- **Invariants** (enforced in `validate()`):
  1. `phone` must match `^\+?[1-9][0-9]{7,14}$` — validated by `PhoneNumber` VO
  2. `passwordHash` must never be empty or exposed raw
  3. `preferredLanguage` must be a valid ISO 639-1 code from the allowed list
  4. `deletedAt` — soft-deleted users cannot authenticate
- **Lifecycle**: `ACTIVE` (default) → `DELETED` (soft delete, `deletedAt` set)
- **Domain Events Emitted**:
  - `UserRegisteredEvent` — on successful signup
  - `UserLoggedInEvent` — on successful login (updates `lastLoginAt`)
  - `PasswordChangedEvent` — on successful password reset
- **Commands**: `RegisterUser`, `LoginUser`, `ChangePassword`
- **Queries**: `FindUserByPhone`, `FindUserById`

### Vendor Aggregate (creation scope only)
- **Root Entity**: `Vendor`
- **Nested Entities**: None
- **Value Objects**: None for v1
- **Invariants**:
  1. `name` must be non-empty, max 150 chars
  2. On signup, exactly one `VendorUser` record with `role = vendor_owner` must be created atomically
- **Domain Events Emitted**:
  - `VendorCreatedEvent` — on signup (triggers downstream modules)
- **Commands**: `CreateVendor` (only via signup command — no standalone create in this module)
- **Queries**: None in this module

### VendorUser (join — created within signup transaction)
- Not a standalone aggregate in this module. Created as part of the `RegisterUser` command.
- The auth module is responsible for creating the `vendor_owner` VendorUser row during signup.
- All subsequent VendorUser management belongs to US-004 (Staff Management).

---

## Entities

### Entity: User

| Field | Type | Required | Default | Constraint |
|-------|------|----------|---------|-----------|
| id | BigInt | Yes | autoincrement | PK |
| phone | String (PhoneNumber VO) | Yes | — | UNIQUE, regex |
| passwordHash | String (HashedPassword VO) | Yes | — | Never exposed |
| name | String | No | null | max 100 chars |
| email | String | No | null | max 100, valid email format |
| profilePhotoUrl | String | No | null | max 500 chars |
| preferredLanguage | String | Yes | 'en' | ISO 639-1, allowed values |
| lastLoginAt | DateTime | No | null | Updated on each login |
| createdAt | DateTime | Yes | now() | — |
| updatedAt | DateTime | Yes | auto | — |
| deletedAt | DateTime | No | null | Soft delete |

**Behavior** (domain methods):
- `recordLogin()` — sets `lastLoginAt = new Date()`, emits `UserLoggedInEvent`
- `changePassword(newHash: string)` — replaces `passwordHash`, emits `PasswordChangedEvent`
- `softDelete()` — sets `deletedAt = new Date()`

**Invariants** (in `validate()`):
- `phone` is non-empty and matches phone regex
- `passwordHash` is non-empty
- `preferredLanguage` is one of `['en', 'hi', 'ta', 'te', 'mr', 'bn', 'kn', 'ml', 'gu']`

### Entity: Vendor (creation-scope only)

| Field | Type | Required | Default | Constraint |
|-------|------|----------|---------|-----------|
| id | BigInt | Yes | autoincrement | PK |
| name | String | Yes | — | max 150 chars |
| phone | String | No | null | max 15 chars |
| category | String | No | null | max 50 chars |
| referralCode | String | No | null | UNIQUE, max 50 |
| referredByVendorId | BigInt | No | null | FK → vendors(id) |
| autoMarkEnabled | Boolean | Yes | true | — |
| autoSendBills | Boolean | Yes | false | — |
| autoSendTime | String | No | '20:00' | TIME format |
| upiId | String | No | null | max 100 |
| bankDetails | Json | No | null | JSONB |
| createdAt | DateTime | Yes | now() | — |
| updatedAt | DateTime | Yes | auto | — |
| deletedAt | DateTime | No | null | Soft delete |

**Invariants** (in `validate()`):
- `name` is non-empty

---

## Value Objects

### Value Object: PhoneNumber
- **Properties**: `value: string`
- **Validation Rules** (enforced in constructor):
  - Must match regex `^\+?[1-9][0-9]{7,14}$`
  - Trimmed before validation
- **Equality**: Structural — compare `value` strings
- **Immutable**: Yes
- **Guard clauses**: `Guard.isEmpty()`, custom regex test
- **`unpack()`**: returns `string` for DB persistence

### Value Object: HashedPassword
- **Properties**: `value: string` (already bcrypt-hashed)
- **Note**: This VO wraps the hash — raw password is NEVER stored in a VO or entity. Hashing occurs in the application service before calling `HashedPassword.create(hash)`.
- **Validation Rules**: non-empty string, length >= 60 (bcrypt output is exactly 60 chars)
- **Equality**: N/A — passwords are compared via `bcrypt.compare()`, not structural equality
- **Immutable**: Yes
- **`unpack()`**: returns `string` for DB persistence

---

## Domain Events

| Event | Triggered When | Payload | Consumers |
|-------|---------------|---------|----------|
| `UserRegisteredEvent` | Signup completes — user + vendor + vendorUser created | `{ userId, phone, vendorId, correlationId, timestamp }` | Audit (US-007), Notification (future) |
| `UserLoggedInEvent` | Login succeeds | `{ userId, phone, ip, userAgent, correlationId, timestamp }` | Audit (US-007) |
| `PasswordChangedEvent` | Password reset completes | `{ userId, correlationId, timestamp }` | Audit (US-007) |
| `VendorCreatedEvent` | Vendor row created during signup | `{ vendorId, name, ownerUserId, correlationId, timestamp }` | Audit (US-007) |

### Cross-Module Event Flow

```
RegisterUser Command
  → User.create() emits UserRegisteredEvent
  → Vendor.create() emits VendorCreatedEvent
  → Events persist to AuditLog after transaction commit

LoginUser Command
  → user.recordLogin() emits UserLoggedInEvent
  → Event persists to AuditLog after transaction commit

ResetPassword Command
  → user.changePassword() emits PasswordChangedEvent
  → Event persists to AuditLog after transaction commit
```

---

## Use Cases (CQS)

### Commands (State-Changing)

#### UC-1: RegisterUser (Signup)
- **Type**: Command
- **Input**: `{ phone, password, vendorName }` + IP address from request
- **Steps**:
  1. Validate input (Zod schema at boundary — `.strict()`)
  2. Create `PhoneNumber` VO — throws `ConflictError` caught at repo if phone unique constraint hits
  3. Hash password with bcrypt (10 rounds) in application service
  4. Create `HashedPassword` VO
  5. In a single `$transaction`:
     a. Create `User` entity via `User.create()` → persist via `UserRepository.insert()`
     b. Create `Vendor` entity via `Vendor.create()` → persist via `VendorRepository.insert()`
     c. Lookup `vendor_owner` role from `roles` table
     d. Create `VendorUser` row (userId, vendorId, roleId, status=ACTIVE)
  6. Create access token (JWT, 1h) and refresh token (JWT, 30d)
  7. Persist `UserSession` row with tokens + device metadata
  8. Dispatch domain events to AuditLog
  9. Return `{ user, tokens, vendorContext }`
- **Errors**: `ConflictError` (phone already exists), `NotFoundError` (vendor_owner role not seeded)
- **Auth**: Not required (public endpoint)
- **Rate Limit**: 3/hr per IP (express-rate-limit on route)
- **Transaction**: Required (all or nothing)

#### UC-2: LoginUser
- **Type**: Command (updates `lastLoginAt` and creates session)
- **Input**: `{ phone, password }` + IP, userAgent, deviceId from request
- **Steps**:
  1. Validate input (Zod `.strict()`)
  2. Find user by phone — if not found, throw generic `UnauthorizedError` (timing-safe: never distinguish phone vs password)
  3. `bcrypt.compare(password, user.passwordHash)` — if fail, throw `UnauthorizedError`
  4. Check `deletedAt IS NULL` — if deleted, throw `UnauthorizedError`
  5. Call `user.recordLogin()` — sets `lastLoginAt`, emits event
  6. Persist updated user via repository
  7. Load all vendor contexts: `SELECT vendor_id, role FROM vendor_users WHERE user_id = ? AND status = ACTIVE`
  8. Create JWT access token (1h, payload: `{ userId, phone, vendorIds: bigint[] }`)
  9. Create JWT refresh token (30d)
  10. Persist `UserSession` row
  11. Dispatch `UserLoggedInEvent`
  12. Return `{ user, tokens, vendorContexts[] }`
- **Errors**: `UnauthorizedError` (always generic — no phone/password distinction), `TooManyRequestsError`
- **Auth**: Not required (public endpoint)
- **Rate Limit**: 5/15min per phone number

#### UC-3: RefreshToken
- **Type**: Command (rotates session)
- **Input**: `{ refreshToken }`
- **Steps**:
  1. Validate input (Zod)
  2. Verify JWT signature and expiry — throw `UnauthorizedError` if invalid
  3. Find session by refresh token in `user_sessions` where `revoked_at IS NULL`
  4. If not found or `revoked_at IS NOT NULL` → throw `UnauthorizedError` (token reuse detection)
  5. In `$transaction`:
     a. Revoke old session: set `revoked_at = now()`
     b. Issue new access token and refresh token
     c. Create new `UserSession` row
  6. Return `{ accessToken, refreshToken }`
- **Errors**: `UnauthorizedError` (expired/revoked/invalid token)
- **Auth**: Not required (token is the credential)
- **Rate Limit**: 10/15min per IP

#### UC-4: ForgotPassword
- **Type**: Command
- **Input**: `{ phone }`
- **Steps**:
  1. Validate input
  2. Find user by phone — if NOT found, return success anyway (prevent phone enumeration)
  3. If found: generate `otp_code` (6 random digits), generate `reset_token` (UUID v4 or crypto.randomBytes)
  4. Persist to `password_reset_tokens` with `expires_at = now() + 15 minutes`
  5. **SMS stub**: `logger.info({ otp, phone }, '[SMS STUB] Send OTP')` — no real delivery in v1
  6. Return `{ message: 'If account exists, OTP sent' }` (always same response)
- **Errors**: `TooManyRequestsError`
- **Auth**: Not required
- **Rate Limit**: 3/hr per phone

#### UC-5: ResetPassword
- **Type**: Command
- **Input**: `{ phone, otpCode, resetToken, newPassword }`
- **Steps**:
  1. Validate input (Zod `.strict()`)
  2. Find `password_reset_tokens` where `reset_token = ?` AND `otp_code = ?` AND `is_used = false` AND `expires_at > now()`
  3. If not found → throw `BadRequestError('Invalid or expired OTP')`
  4. Find user by `user_id` from token record — confirm phone matches
  5. Hash new password with bcrypt (10 rounds)
  6. In `$transaction`:
     a. Update `password_reset_tokens` set `is_used = true, used_at = now()`
     b. Update user: `passwordHash = newHash`
     c. Revoke ALL active sessions: `UPDATE user_sessions SET revoked_at = now() WHERE user_id = ? AND revoked_at IS NULL`
  7. Emit `PasswordChangedEvent`
  8. Return `{ message: 'Password updated successfully' }`
- **Errors**: `BadRequestError` (invalid/expired OTP), `NotFoundError` (user not found)
- **Auth**: Not required

#### UC-6: Logout
- **Type**: Command
- **Input**: `{ refreshToken }` from request body (or Authorization header bearer token identifies the session)
- **Steps**:
  1. Validate input
  2. Find session by refresh token
  3. If found, set `revoked_at = now()`
  4. Return 204
- **Errors**: None (idempotent — if token not found, still return 200)
- **Auth**: Required (`authenticateToken` middleware — access token in header)

### Queries (Data Retrieval)

#### UC-7: GetCurrentUser (implicit, via middleware)
- **Type**: Query
- **Input**: JWT access token (from `Authorization: Bearer` header)
- **Steps**: Decode JWT, attach `req.user = { userId, phone, vendorIds[] }` — no DB call in middleware
- **Note**: This is the `authenticateToken` middleware, not a standalone endpoint

---

## Mapper Design

### UserMapper
- **toPersistence**: `User entity → Prisma UserCreateInput` — extract all fields, call `phoneNumber.unpack()`, `hashedPassword.unpack()`
- **toDomain**: `Prisma User record → User entity` — reconstruct `PhoneNumber` VO and `HashedPassword` VO from DB strings
- **toResponse**: `User entity → UserDto` — whitelist: `{ id: string, phone: string, name, email, profilePhotoUrl, preferredLanguage, lastLoginAt, createdAt, updatedAt }`. Never expose `passwordHash`, `deletedAt`.

### SessionMapper
- **toPersistence**: `SessionCreateProps → Prisma UserSessionCreateInput`
- **toResponse**: N/A (sessions not returned as API resources directly)

---

## Anti-Corruption Layer

### SMS Notification Stub (Strategy Pattern)
- **Port** (interface): `src/modules/auth/ports/sms-notification.port.ts`
  ```typescript
  interface SmsNotificationPort {
    sendOtp(phone: string, otp: string): Promise<void>;
  }
  ```
- **Stub Adapter** (v1): `src/modules/auth/adapters/sms-stub.adapter.ts` — logs OTP via Pino, returns `Promise.resolve()`
- **Real Adapter** (future): Twilio / MSG91 — same interface, different implementation
- **Selection**: Composition root in `auth.routes.ts` injects the stub for v1

---

## Module Structure

Following the **Complex Domain Module** pattern with vertical slicing:

```
src/modules/auth/
├── domain/
│   ├── user.entity.ts                      # User aggregate root
│   ├── vendor.entity.ts                    # Vendor entity (creation scope)
│   ├── user.types.ts                       # UserProps, CreateUserProps, enums
│   ├── vendor.types.ts                     # VendorProps, CreateVendorProps
│   ├── auth.errors.ts                      # Domain-specific auth errors
│   ├── value-objects/
│   │   ├── phone-number.value-object.ts    # PhoneNumber with regex validation
│   │   └── hashed-password.value-object.ts # HashedPassword wrapper
│   └── events/
│       ├── user-registered.domain-event.ts
│       ├── user-logged-in.domain-event.ts
│       ├── password-changed.domain-event.ts
│       └── vendor-created.domain-event.ts
├── database/
│   ├── user.repository.port.ts             # IUserRepository interface
│   ├── user.repository.ts                  # Prisma adapter
│   ├── vendor.repository.port.ts           # IVendorRepository interface
│   ├── vendor.repository.ts                # Prisma adapter
│   └── session.repository.ts               # Session CRUD (no port — simple)
├── ports/
│   └── sms-notification.port.ts            # SmsNotificationPort interface
├── adapters/
│   └── sms-stub.adapter.ts                 # Stub SMS implementation (v1)
├── commands/
│   ├── signup/
│   │   ├── signup.service.ts               # RegisterUser command handler
│   │   └── signup.request.dto.ts
│   ├── login/
│   │   ├── login.service.ts                # LoginUser command handler
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
├── auth.mapper.ts                          # toPersistence / toDomain / toResponse
├── auth.types.ts                           # Shared DTOs (UserDto, TokenDto, VendorContextDto)
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
