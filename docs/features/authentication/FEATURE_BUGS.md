# Feature Bugs: Authentication & Account Setup (US-003)

**QA Agent**
**Date**: 2026-06-07
**Branch**: feat/us-003-authentication

---

## Verdict: FAIL

The implementation passes all 71 existing unit and integration tests. All BLOCKERs and CRITICALs from the Review Report are confirmed fixed. However, QA testing surfaced new bugs: one HIGH (missing `correlationId` in all error responses), one MEDIUM (incomplete integration test coverage for token rotation), and several MINORs that were carried forward from the Review Report but not yet remediated.

---

## Bugs Found

---

### BUG-001: `correlationId` missing from all error responses

- **Severity**: HIGH
- **Category**: Error Format
- **Endpoint**: All — applies to every error response across all 6 auth endpoints
- **Steps to Reproduce**:
  1. Send an invalid request to any auth endpoint, e.g.:
     ```
     POST /api/v1/auth/signup
     Content-Type: application/json
     { "phone": "bad", "password": "weak", "vendorName": "X" }
     ```
  2. Inspect the response body.
- **Request**:
  ```json
  { "phone": "bad", "password": "weak", "vendorName": "X" }
  ```
- **Expected** (per `qa.md` response format and `error-handling.md`):
  ```json
  {
    "success": false,
    "error": {
      "code": "VALIDATION_ERROR",
      "message": "Validation failed",
      "correlationId": "req-abc123-def456",
      "details": [...]
    }
  }
  ```
- **Actual**:
  ```json
  {
    "success": false,
    "error": {
      "code": "VALIDATION_ERROR",
      "message": "Validation failed",
      "details": [...]
    }
  }
  ```
  `correlationId` is absent from every error response. The `AppError.toJSON()` method (`src/common/errors/app-error.ts:32-38`) does not include `correlationId`, and the `errorHandler` middleware (`src/infrastructure/middlewares/error-handler.ts:20-26`) directly calls `error.toJSON()` without injecting a request ID.
- **Root Cause**: Implementation — neither `AppError.toJSON()` nor `errorHandler` generates or attaches a `correlationId` to error responses.
- **Skill Reference**: `qa.md` "Error Response Tests — `correlationId` is present in every error response" (rule 5); `error-handling.md` centralized error handler contract.
- **Status**: Open

---

### BUG-002: `hashed-password.value-object.test.ts` imports `ArgumentInvalidException` from wrong module

- **Severity**: MEDIUM
- **Category**: Domain Invariant / Code Coupling
- **Endpoint**: N/A (test file)
- **Steps to Reproduce**:
  1. Open `src/modules/auth/__tests__/domain/hashed-password.value-object.test.ts`, line 2.
  2. Observe: `import { ArgumentInvalidException } from '../../domain/value-objects/phone-number.value-object';`
  3. This imports from the PhoneNumber VO file, not from `@/common/errors/app-error` or `src/modules/auth/domain/auth.errors.ts`.
- **Expected**: Test should import `ArgumentInvalidException` from `@/common/errors/app-error` or from `../../domain/auth.errors`, not from `phone-number.value-object`.
- **Actual**: The import works because `phone-number.value-object.ts` re-exports `ArgumentInvalidException` (line 3 of that file), but this creates an implicit coupling between the password test and the phone-number VO file. If the re-export is removed as part of MAJOR-4 cleanup, the test will break.
- **Root Cause**: MAJOR-4 from the Review Report was partially fixed (entity files now import from `@/common/errors/app-error`) but the re-export in `phone-number.value-object.ts` and the incorrect import in `hashed-password.value-object.test.ts` were not cleaned up.
- **Skill Reference**: `module-scaffold.md` — clean file organization; Review Report MAJOR-4 (marked outstanding).
- **Status**: Open

---

### BUG-003: Integration test suite missing "rotated refresh token is rejected" test case

- **Severity**: MEDIUM
- **Category**: Edge Case / Security
- **Endpoint**: `POST /api/v1/auth/refresh`
- **Steps to Reproduce**:
  1. Login → get `refreshToken1`.
  2. POST `/api/v1/auth/refresh` with `refreshToken1` → get `refreshToken2` (rotation; `refreshToken1` is now revoked).
  3. POST `/api/v1/auth/refresh` again with `refreshToken1` (the old, revoked token).
  4. Expected: 401. This flow is NOT covered by any existing integration test.
- **Expected**: A test asserting that a previously valid but now-rotated refresh token returns 401. The QA task plan explicitly requires: "Old refresh token after rotation → 401 (revoked)".
- **Actual**: `tests/integration/auth.test.ts` only covers `200 — valid refresh token` and `401 — invalid JWT string`. The revoked-but-valid-JWT path is absent.
- **Root Cause**: Missing test — the token rotation / revocation rejection path has no integration test coverage.
- **Skill Reference**: `testing-strategy.md` — "Hidden User Flow Tests — Refresh token after access token expires"; QA task plan section 3 (refresh endpoint checklist).
- **Status**: Open

---

### BUG-004: `loginSchema` is strict but controller reads `deviceId` from body — clients sending `deviceId` on login get 400

- **Severity**: MEDIUM
- **Category**: Validation
- **Endpoint**: `POST /api/v1/auth/login`
- **Steps to Reproduce**:
  1. Send login request with an optional `deviceId` field:
     ```json
     { "phone": "+919876543210", "password": "Test@123x", "deviceId": "my-device-001" }
     ```
  2. The `loginSchema` uses `.strict()` which rejects unknown fields.
  3. Observe: 400 VALIDATION_ERROR — `"Unrecognized key(s) in object: 'deviceId'"`.
- **Request**:
  ```json
  { "phone": "+919876543210", "password": "Test@123x", "deviceId": "my-device-001" }
  ```
- **Expected**: If `deviceId` is a legitimate optional field (the `auth.controller.ts` line 101 and `login.service.ts` line 73 both use `dto.deviceId`), then `loginSchema` should include it as an optional field. If `deviceId` is not intended to be accepted by clients, the controller and service should not reference it.
- **Actual**: `auth.controller.ts:101` reads `body.deviceId` and passes it to `loginService.execute()`, and `login.service.ts:73` uses `dto.deviceId` to store device ID on the session — but `loginSchema` (`.strict()`) will reject any request body containing `deviceId` with a 400 before the controller is ever reached. The feature is implemented in the service layer but is unreachable because the validator rejects the field.
- **Root Cause**: Schema and implementation mismatch — `deviceId` is handled by service/controller but absent from `loginSchema`.
- **Skill Reference**: `validation-schemas.md` Rule — "Every accepted field must be in the schema"; `api-contract-design.md` — schema is the source of truth for accepted fields.
- **Status**: Open

---

### BUG-005: `UserEntity.reconstitute()` skips `validate()` — corrupted DB records loaded silently

- **Severity**: LOW (MINOR-3 from Review Report — carried forward, not yet fixed)
- **Category**: Domain Invariant
- **Endpoint**: N/A (domain layer)
- **Steps to Reproduce**:
  1. Insert a user record into the DB with an empty `preferredLanguage` (e.g., via direct SQL: `UPDATE users SET preferred_language = 'xx' WHERE id = 1`).
  2. Call any endpoint that loads this user (e.g., login).
  3. The `UserMapper.toDomain()` calls `UserEntity.reconstitute()` at line 22 of `auth.mapper.ts`.
  4. `reconstitute()` at `user.entity.ts:86-89` constructs the entity but never calls `entity.validate()`.
  5. The entity is returned with an invalid `preferredLanguage` — no exception thrown.
- **Expected**: `reconstitute()` should call `validate()` after construction, just as `create()` does (line 81). A corrupted DB record should not produce a silently invalid entity.
- **Actual**: `reconstitute()` returns the entity without validation, allowing invalid state to propagate into the application layer.
- **Root Cause**: Implementation gap — `reconstitute()` does not call `validate()`. Same issue exists for `VendorEntity.reconstitute()` at line 69-71 of `vendor.entity.ts`.
- **Skill Reference**: `domain-modeling.md` — "Entity validates invariants in `validate()` method — Called on construction and before persistence"; Review Report MINOR-3.
- **Status**: Open

---

### BUG-006: Dev seed `vendor.create` is not idempotent — duplicate Test Vendors on re-seed

- **Severity**: LOW (MINOR-5 from Review Report — carried forward, not yet fixed)
- **Category**: Edge Case
- **Endpoint**: N/A (seed script)
- **Steps to Reproduce**:
  1. Run `npm run db:seed` twice on a development database.
  2. Check the `vendors` table.
- **Expected**: One "Test Vendor" row, idempotently maintained.
- **Actual**: Each run of `npm run db:seed` creates a new `vendor` row with `name = 'Test Vendor'` (line 115 of `prisma/seeds/index.ts` uses `prisma.vendor.create()`, not `upsert()`). After two seed runs, two "Test Vendor" rows exist. The `vendorUser` upsert on line 119 will then fail or succeed against the first vendor only, leaving orphaned vendor rows.
- **Root Cause**: `prisma.vendor.create()` is not idempotent. Vendor has no unique constraint on `name`, so there is no `upsert` key available without adding one (e.g., a `referralCode`).
- **Skill Reference**: `prisma-schema-design.md` — safe seeding patterns; Review Report MINOR-5.
- **Status**: Open

---

### BUG-007: `phone-number.value-object.ts` re-exports `ArgumentInvalidException` — unexpected public API

- **Severity**: LOW
- **Category**: Code Coupling
- **Endpoint**: N/A (domain layer)
- **Steps to Reproduce**:
  1. Open `src/modules/auth/domain/value-objects/phone-number.value-object.ts`, line 3.
  2. Observe: `export { ArgumentInvalidException };`
- **Expected**: `phone-number.value-object.ts` should export only `PhoneNumber`. `ArgumentInvalidException` is a shared error class that belongs in `@/common/errors/app-error` or `src/modules/auth/domain/auth.errors.ts`. Re-exporting it from a VO file creates a misleading import path.
- **Actual**: `ArgumentInvalidException` is re-exported from the PhoneNumber VO file, making it appear as if it belongs to the phone-number domain concept. The test file `hashed-password.value-object.test.ts` imports it from there (BUG-002 above).
- **Root Cause**: MAJOR-4 from the Review Report: the entities were fixed but the re-export in `phone-number.value-object.ts` remains.
- **Skill Reference**: `module-scaffold.md` — clean file organization; Review Report MAJOR-4.
- **Status**: Open

---

### BUG-008: Integration tests do not assert `correlationId` in any error response

- **Severity**: LOW
- **Category**: Error Format / Test Coverage
- **Endpoint**: All
- **Steps to Reproduce**:
  1. Search `tests/integration/auth.test.ts` for any assertion on `correlationId`.
  2. None found.
- **Expected per `qa.md`**: "Verify correlationId in every error — Missing correlationId is a Medium bug." Integration tests must include at least one assertion that `res.body.error.correlationId` is present.
- **Actual**: No integration test asserts `correlationId` on any error response.
- **Root Cause**: Missing test coverage combined with underlying BUG-001 (the field is genuinely absent from responses). Once BUG-001 is fixed, these assertions must also be added to the test suite.
- **Skill Reference**: `testing-strategy.md` — "Error Response Tests — `correlationId` is present in every error response".
- **Status**: Open (depends on BUG-001 fix)

---

## Passed Checks

The following items from the QA task plan were verified and pass:

**Domain Invariant Tests (source code review)**
- `PhoneNumber.create()` rejects empty string, too-short numbers (`123`), strings starting with `+0`, and non-numeric strings — verified in source and confirmed by 8 unit tests passing.
- `HashedPassword.create()` rejects empty string and strings shorter than 60 chars — verified in source and confirmed by 4 unit tests passing.
- `UserEntity.create()` with invalid `preferredLanguage` throws `ArgumentInvalidException` — confirmed in `user.entity.ts:125-129` and tested.
- `user.recordLogin()` sets `lastLoginAt` and emits `UserLoggedInEvent` — confirmed in `user.entity.ts:91-103` and tested.
- `user.changePassword()` emits `PasswordChangedEvent` — confirmed in `user.entity.ts:105-109` and tested.
- `UserEntity.getProps()` returns a frozen object (`Object.freeze()` at line 40) — confirmed.
- Domain events extend `DomainEventBase` and carry `id` (UUID), `aggregateId`, `occurredAt`, and `metadata` (with `correlationId`, optional `causationId`) — confirmed in `domain-event.base.ts` and all 4 event classes.
- `ArgumentInvalidException` in entity files (`user.entity.ts`, `vendor.entity.ts`) imports directly from `@/common/errors/app-error` — confirmed; MAJOR-4 is fixed for entity files.

**Test Suite**
- `npm test -- --no-coverage`: all 71 tests pass, 0 failures, 8 suites. No regressions.

**Endpoint: POST /api/v1/auth/signup**
- 201 with correct shape `{ success, data: { user, tokens, vendorContext } }` — PASS (integration test line 56-73).
- `user` response never includes `passwordHash` or `deletedAt` — PASS (line 71-72 and `UserMapper.toResponse` whitelist).
- `vendorContext.role` is `"vendor_owner"` — PASS (line 69).
- Duplicate phone → 409 — PASS (line 110-117).
- Weak password → 400 — PASS (line 93-100).
- Extra unknown field in body → 400 (strict schema) — PASS (line 119-127).
- Missing `vendorName` → 400 — PASS (line 102-108).

**Endpoint: POST /api/v1/auth/login**
- 200 with `vendorContexts` array (not `vendorContext`) — PASS (line 141, `Array.isArray` assertion).
- Wrong password → 401, message is `"Invalid credentials"` — PASS (line 153-159).
- Phone not found → 401, SAME message — PASS (line 144-151).

**Endpoint: POST /api/v1/auth/refresh**
- Valid refresh token → 200 with new `accessToken` and `refreshToken` — PASS (line 182-187).
- New access token payload carries valid `phone` and `vendorIds` (MAJOR-1 fix) — verified in `refresh-token.service.ts:33-51`; service fetches user and vendor contexts before generating the new token.
- Tampered/invalid JWT → 401 — PASS (line 189-192).

**Endpoint: POST /api/v1/auth/forgot-password**
- Existing phone → 200 with generic message — PASS (line 196-200).
- Non-existing phone → 200 with SAME message — PASS (line 202-209).
- OTP generated with `crypto.randomInt` (not `Math.random`) — PASS, confirmed in `forgot-password.service.ts:30`.

**Endpoint: POST /api/v1/auth/reset-password**
- Wrong OTP code → 400 — PASS (line 219-226).
- Invalid `otpCode` format → 400 — PASS (line 228-237).

**Endpoint: POST /api/v1/auth/logout**
- Valid access token + refresh token → 200 — PASS (line 253-259).
- Idempotent: already-revoked token → 200 — PASS (line 261-264).
- Missing Authorization header → 401 — PASS (line 266-268).

**Security Checks**
- Rate limiters present on signup, login, forgot-password, refresh — PASS (confirmed in `auth.routes.ts` lines 37-75).
- `authenticateToken` middleware makes no DB call — PASS (confirmed in `auth.middleware.ts`; pure JWT verify).
- `passwordHash` never appears in any response body — PASS (`UserMapper.toResponse` whitelist confirmed).
- BLOCKER-2 fix verified: `crypto.randomInt(100000, 1000000)` at line 30 of `forgot-password.service.ts`.
- MAJOR-1 fix verified: `refresh-token.service.ts` loads `user.phone` and active `vendorIds` from DB before generating the new access token.

**Seed Data**
- Roles `vendor_owner` and `vendor_staff` are seeded via `upsert` — PASS (lines 34-53 of `prisma/seeds/index.ts`).
- 21 permissions seeded and assigned — PASS (seed logs `21 permissions seeded`).
- Dev test user `+919000000001 / Test@123` seeded and login works — confirmed by seed code and DB.

---

## Acceptance Criteria Coverage

Based on `FEATURE_PLAN.md` and `FEATURE_TASKS.md`:

| Criterion | Status | Notes |
|-----------|--------|-------|
| POST /auth/signup → 201 with `{ user, tokens, vendorContext }` | PASS | |
| `passwordHash`, `deletedAt` never in response | PASS | Mapper whitelist confirmed |
| `vendorContext.role = "vendor_owner"` on signup | PASS | |
| Duplicate phone → 409 ConflictError | PASS | |
| Weak password → 400 ValidationError | PASS | |
| Unknown fields → 400 (strict schema) | PASS | |
| Missing `vendorName` → 400 | PASS | |
| POST /auth/login → 200 with `vendorContexts[]` | PASS | Array confirmed |
| Login phone enumeration prevention | PASS | Same 401 message for phone-not-found and wrong-password |
| POST /auth/refresh → 200 with new tokens | PASS | |
| New access token has valid `phone` and `vendorIds` | PASS | MAJOR-1 fix verified in source |
| Old refresh token after rotation → 401 | FAIL | BUG-003: no integration test for this path |
| Tampered/invalid JWT → 401 on refresh | PASS | |
| POST /auth/forgot-password → 200 always | PASS | |
| Phone enumeration prevention on forgot-password | PASS | |
| OTP uses `crypto.randomInt` (CSPRNG) | PASS | BLOCKER-2 fix confirmed |
| OTP logged via SMS stub | PASS | SmsStubAdapter logs via Pino |
| POST /auth/reset-password → 200, old password invalidated | PARTIAL | Happy path not tested end-to-end (OTP logged but not captured in test) |
| All sessions revoked after reset | PASS | `revokeAll()` in same transaction confirmed in source |
| POST /auth/logout → 200 | PASS | |
| Logout idempotent | PASS | |
| Missing Auth header → 401 on logout | PASS | |
| `correlationId` in every error response | FAIL | BUG-001: not implemented in error handler |
| Rate limiters per route | PASS | Confirmed in `auth.routes.ts` |
| `authenticateToken` stateless (no DB) | PASS | |
| Domain events extend `DomainEventBase` | PASS | CRITICAL-1 fix confirmed |
| `getProps()` returns frozen object | PASS | CRITICAL-3 fix confirmed |
| `UserEntity.equals()` present | PASS | MAJOR-2 fix confirmed |
| `HashedPassword.equals()` present | PASS | MAJOR-3 fix confirmed |
| All 71 existing tests pass | PASS | `npm test` → 71/71 |
