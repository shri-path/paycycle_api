# Code Review Report: US-013 — Multi-Language & Voice Interface

## Summary
- **Date**: 2026-06-14
- **Reviewer**: Review Agent
- **Feature Plan**: [FEATURE_PLAN.md](./FEATURE_PLAN.md)
- **API Spec**: [API_SPEC.md](./API_SPEC.md)
- **Domain Model**: [DOMAIN_MODEL.md](./DOMAIN_MODEL.md)
- **Complexity Tier**: Moderate (Complex voice-command slice)
- **Overall Assessment**: REQUEST-CHANGES — 1 Blocker + 3 Major remain open; 5 issues fixed inline

## Statistics

| Severity | Count Found | Fixed by Reviewer | Remaining (Dev must fix) |
|----------|-------------|-------------------|--------------------------|
| Blocker  | 2           | 1 (BLOCKER-2)     | 1 (BLOCKER-1)            |
| Major    | 5           | 2 (MAJOR-2, MAJOR-4) | 3 (MAJOR-1, MAJOR-3, MAJOR-5) |
| Minor    | 4           | 2 (MINOR-1 partial, MAJOR-4 covered MINOR-3) | 2 (MINOR-2, MINOR-4) |
| Nit      | 0           | —                 | 0                        |

---

## Findings

### BLOCKER-1: DeliveryActionAdapter hard-codes `role: 'owner'` — bypasses staff list-permission RBAC

- **File**: `src/modules/voice/adapters/delivery-action.adapter.ts:75-81`
- **Description**: `_buildRoleContext()` always sets `role: 'owner'` and `permissions: []` in the synthetic `RoleContext` passed to `MarkDeliveryCommand` / `MarkBulkDeliveryCommand`. `DeliveryAccess.assertListPermission` short-circuits on `ctx.role === 'owner'` (delivery.shared.ts:133) and skips both the staff-assignment check and the `permissions` check. This means **any authenticated user who has `voice:use` can execute delivery-marking for any supply list that belongs to their vendor**, even if they are staff who are not assigned to that list or do not hold `mark_deliveries`/`mark_leaves`. The FEATURE_PLAN states "all delivery invariants + list RBAC enforced there" — this is violated.
- **Expected**: The adapter must pass through the caller's real role and permissions. The correct approach is to thread the real `RoleContext` (which the middleware already built and attached to `req.roleContext`) through the command chain down to the adapter.
- **Fix guidance**:
  1. Add a `roleCtx: RoleContext` parameter to `IDeliveryActionPort.markDelivery` and `markAllPending`.
  2. The `ExecuteVoiceCommandCommand` already receives `ctx = { userId, vendorId, correlationId }`; expand this to carry the full `RoleContext` (sourced from the controller via `req.roleContext`).
  3. Pass it through without modification. The delivery command will then enforce the real staff permissions.

---

### BLOCKER-2: `forceTransliterationOffForEnglish()` is unreachable when `appLanguage=en` and `transliterationEnabled=true` are sent together

- **File**: `src/modules/voice/commands/upsert-language-preference/upsert-language-preference.command.ts:56-57` and `src/modules/voice/domain/language-preference.entity.ts:140,154-158`
- **Description**: The API spec and FEATURE_PLAN both state "If `appLanguage` is `en`, the server **forces** `transliterationEnabled` to `false`" (a silent override). In the entity, `update()` applies the patch to `_props` then immediately calls `validate()`, which throws `ArgumentInvalidException` if `appLanguage === EN && transliterationEnabled === true`. The call to `entity.forceTransliterationOffForEnglish()` on line 57 of the command is **never reached** in this case because `update()` already threw. The result is a `400 VALIDATION_ERROR` instead of the silent server-side forced override the API contract guarantees.
- **Expected**: A PATCH with `{appLanguage: "en", transliterationEnabled: true}` must succeed and return the preferences with `transliterationEnabled: false`.
- **Fix guidance** (two options — choose one):
  - **Option A (preferred — domain stays clean)**: In `UpsertLanguagePreferenceCommand.execute`, before calling `entity.update(patch)`, if `patch.appLanguage` equals `'en'` (case-insensitive), set `patch.transliterationEnabled = false` in the patch before handing to the domain.
  - **Option B**: Change `entity.update()` to silently force transliteration off before validating (removing the invariant that throws) — but this couples a business rule into the update mutator rather than the command, which is less clean.
  - Either way, the `forceTransliterationOffForEnglish()` helper should only be a no-op safety net after a safe update, not the primary enforcement mechanism.

---

### MAJOR-1: `voice:use` permission is never enforced on the transcribe and execute-command routes

- **File**: `src/modules/voice/voice.routes.ts:215-234`
- **Description**: The FEATURE_PLAN specifies that `/voice/transcribe` and `/voice/execute-command` require `voice:use` permission. The `voice:use` permission is seeded and assigned to both `vendor_owner` and `vendor_staff` roles. However, neither route has a `requirePermission(permissionService, 'voice:use')` guard in its middleware chain. Any authenticated user with a valid `vendorId` roleContext can call these endpoints.
- **Expected**: Both voice routes must have `identifyUserRole('vendorId')` (already present) followed by a `requirePermission(permissionService, PermissionKey.VOICE_USE)` (or equivalent) guard, mirroring the pattern used by delivery/credit/audit routes. Similarly, the message-template GET route is missing `requirePermission` for `message_template:read` and the PUT for `message_template:manage` (the routes only use `requireOwnerRole()` which correctly enforces owner-only, so the permission check is implicitly satisfied — but explicit permission gating is still the established pattern for clarity and forward-compatibility).
- **Fix guidance**: Add a `requirePermission` middleware call on the two voice routes after `identifyUserRole`. Create or reuse a `PermissionKey.VOICE_USE = 'voice:use'` constant.

---

### MAJOR-2: Query schema `listTemplatesQuerySchema` uses `.strict()` — must use `.passthrough()`

- **File**: `src/modules/voice/voice.validator.ts:57-62`
- **Description**: Every other list/query schema in this codebase (audit, credit, customer, delivery, dashboard) uses `.passthrough()` to allow the QueryBuilder's pagination/sorting/filter params to pass through Zod validation unchanged. The `listTemplatesQuerySchema` uses `.strict()`, which will reject any request that includes standard QueryBuilder params (e.g. `?page=1&limit=20`). This violates the validation-schemas skill rule and will cause unexpected 400 errors for any consumer that attaches standard query params.
- **Expected**: `listTemplatesQuerySchema.passthrough()` (or simply change `.strict()` to `.passthrough()`).
- **Fix guidance**: Replace the final `.strict()` call on `listTemplatesQuerySchema` with `.passthrough()`.

---

### MAJOR-3: Route paths for voice endpoints deviate from API_SPEC.md

- **File**: `src/modules/voice/voice.routes.ts:215-234`
- **API Spec**: `API_SPEC.md` §3.1 and §3.2
- **Description**: The API spec defines the voice command endpoints as:
  - `POST /voice/transcribe`
  - `POST /voice/execute-command`
  
  The implementation mounts them at:
  - `POST /vendors/:vendorId/voice/transcribe`
  - `POST /vendors/:vendorId/voice/execute-command`
  
  This is a breaking change vs. the spec the frontend was designed against. The frontend will call the wrong path. (`supplyListId` in the body already provides tenant context since it's scoped to the vendor, and `vendorId` is obtained from the JWT `roleContext` — the path param is unnecessary for correctness, but it conflicts with the contracted URL.)
- **Expected**: Either (a) the routes match the spec exactly (`/voice/transcribe`, `/voice/execute-command`) with vendorId obtained exclusively from JWT roleContext, or (b) the spec is updated to reflect the vendor-namespaced paths. This requires a decision. Since the implementation extracts `vendorId` from `req.roleContext!.vendorId` (which comes from the JWT, not the path), option (a) is cleaner and requires mounting a dedicated `voiceRouter` at `/api/v1/voice` with `authenticate → identifyUserRole('vendorId') → validate → controller`.
- **Fix guidance**: Create a third router (`voiceRouter`) mounted at `apiPrefix/voice` in `app.ts` for the two transcribe/execute endpoints, keeping the `vendorVoiceRouter` for message templates only.

---

### MAJOR-4: `UpsertLanguagePreferenceCommand` uses dynamic `import()` for a static dependency

- **File**: `src/modules/voice/commands/upsert-language-preference/upsert-language-preference.command.ts:51`
- **Description**: `const { LanguagePreferenceEntity } = await import('../../domain/language-preference.entity')` is used inside the command's `execute()` method. This is a dynamic import where a static import is sufficient and appropriate. Dynamic imports add unnecessary runtime overhead, obscure dependencies, and can cause issues with bundlers and tree-shaking. Similarly, `voice.controller.ts:55` dynamically imports `ForbiddenError` from a module that is already available as a static dependency. Neither use case benefits from code splitting.
- **Expected**: Both should use static imports at the top of the file.
- **Fix**: Move both `await import(...)` calls to static `import` statements at the top of their respective files.

---

### MAJOR-5: `upsertLanguagePreference` command does not wrap repo.upsert + user.update in a transaction

- **File**: `src/modules/voice/commands/upsert-language-preference/upsert-language-preference.command.ts:60-66`
- **Description**: The command performs two writes: `repo.upsert(entity)` (writes `language_preferences`) followed by `prisma.user.update(...)` (syncs `users.preferred_language`). These are not wrapped in a `prisma.$transaction()`. If the first write succeeds and the second fails, the `language_preferences` table and the denormalised `users.preferred_language` column will be out of sync. This is a data-consistency issue.
- **Expected**: Both writes must be atomic. The service-implementation skill requires `prisma.$transaction()` for multi-step operations.
- **Fix guidance**: Wrap both writes in `prisma.$transaction(async (tx) => { ... })`. The repository's `upsert` method should accept an optional `tx?: PrismaTransaction` parameter (currently it does not — this is a repository skill gap too).

---

### MINOR-1: String fields in validation schemas are missing `.trim()`

- **File**: `src/modules/voice/voice.validator.ts:51, 67-70, 80`
- **Description**: `preferredVoiceAccent`, `content` (upsertTemplateSchema), and `content` (previewTemplateSchema) are string fields that do not call `.trim()`. The validation-schemas skill requires every string field to trim whitespace. A user submitting `content: "  hello  "` would store leading/trailing whitespace in the database.
- **Expected**: `z.string().trim().max(20)` for accent; `z.string().trim().min(1).max(2000)` for content fields.

---

### MINOR-2: `GetLanguagePreferenceQuery` is missing a self-guard; guard lives only in the controller

- **File**: `src/modules/voice/voice.controller.ts:54-57` and `src/modules/voice/queries/get-language-preference/get-language-preference.query.ts`
- **Description**: The self-ownership check (`userId !== callerId → 403`) is implemented in the controller for the GET endpoint but not in the `UpsertLanguagePreferenceCommand` query class. This is fine architecturally (the controller is the boundary), but the pattern used by `UpsertLanguagePreferenceCommand` (which does check `callerId !== userId` internally) is inconsistent with the GET endpoint. The `GetLanguagePreferenceQuery` has no `callerId` parameter at all.
- **Expected**: Either thread the `callerId` into `GetLanguagePreferenceQuery` so it enforces self-ownership (consistent with the command), or document the pattern explicitly as "controller enforces auth boundaries for GET; command enforces for mutations."
- **Note**: This is a Minor finding since the controller does gate it — no security bypass is possible.

---

### MINOR-3: Dynamic import of `ForbiddenError` in controller is unnecessary

- **File**: `src/modules/voice/voice.controller.ts:55`
- **Description**: `const { ForbiddenError } = await import('@/common/errors/app-error')` is used inside the `getLanguagePreference` handler. `ForbiddenError` is already available as a static import from the rest of the module. See MAJOR-4 for context — this is part of the same dynamic-import pattern problem.

---

### MINOR-4: Error-logging convention (MEMORY: `feedback_error_logging.md`) not applied to voice commands

- **File**: `src/modules/voice/commands/transcribe-voice-command/transcribe-voice-command.command.ts:80-86`
- **Description**: The MEMORY convention requires errors to be logged with `correlationId` to `Logs/YYYY-MM-DD.txt` (via `logErrorToFile`). Other modules (vendor-settings, bulk-mark-leave, auto-send-bills) call `logErrorToFile` on notable failures. The voice module only logs to the Pino logger (via `this.logger.error`). The STT failure path in particular is a high-value error to persist.
- **Expected**: Call `logErrorToFile(error, { correlationId, userId, vendorId })` at the STT failure catch block in `TranscribeVoiceCommandCommand`.

---

## Skill Compliance Summary

| Skill                        | Status | Notes                                                                                 |
|------------------------------|--------|---------------------------------------------------------------------------------------|
| module-scaffold.md           | PASS   | commands/ and queries/ subdirs present; composition root in routes.ts; app.ts updated |
| prisma-schema-design.md      | PASS   | All 3 models have BigInt PK, snake_case maps, timestamps, required indexes, enums with @@map |
| domain-modeling.md           | PASS   | Domain layer is framework-free; factory methods present; getProps() returns Object.freeze; validate() in both create and reconstitute; VOs use Guard pattern |
| validation-schemas.md        | PARTIAL| FAIL: listTemplatesQuerySchema uses .strict() not .passthrough(); FAIL: string fields missing .trim() |
| repository-implementation.md | PARTIAL| FAIL: no tx parameter on any method; P2002 caught correctly; soft-delete enforced |
| service-implementation.md    | PARTIAL| FAIL: multi-step upsert+user-update not transactional; dynamic imports are anti-pattern |
| error-handling.md            | PARTIAL| FAIL: logErrorToFile not called for STT errors; all specific error classes used correctly; next(error) pattern correct |
| testing-strategy.md          | PASS   | VO tests, entity tests, mapper tests, command unit tests, interpreter tests all present; mocks against port interfaces; error scenarios covered |

---

## Checklist Verification

### Module Structure
- [x] commands/ and queries/ subdirs mandatory — PASS
- [x] Module registered in app.ts — PASS
- [x] Permissions seeded — PASS
- [x] Files under 200 lines — PASS
- [ ] Route paths match API spec — FAIL (MAJOR-3)
- [ ] voice:use permission enforced on routes — FAIL (MAJOR-1)

### Database Schema
- [x] BigInt autoincrement ID on every model — PASS
- [x] snake_case columns via @map() — PASS
- [x] Table names snake_case plural via @@map() — PASS
- [x] Timestamps present (createdAt, updatedAt, deletedAt where applicable) — PASS
- [x] Mandatory indexes (deletedAt, createdAt, FK, vendorId) — PASS
- [x] Enums have @@map() with snake_case name — PASS
- [x] Aggregate root boundaries respected (no cross-aggregate @relation except to User/Vendor which is correct) — PASS
- [x] onDelete policy set on all relations — PASS
- [x] Seed data idempotent — PASS

### Domain Model
- [x] Domain layer has ZERO framework imports — PASS
- [x] Entity uses factory method (static create / reconstitute) — PASS
- [x] Entity validates invariants in validate() — PASS
- [ ] Entity exposes behavior correctly — PARTIAL: forceTransliterationOffForEnglish is unreachable in key scenario (BLOCKER-2)
- [x] Entity getProps() returns defensive copy (Object.freeze) — PASS
- [x] Entity equals() compares by ID — PASS
- [x] Value objects are immutable — PASS
- [x] Value objects use ArgumentInvalidException (Guard pattern) — PASS
- [x] No domain events needed — N/A (feature plan confirms no events)

### Validation
- [x] Create/update schemas use .strict() — PASS
- [ ] Query schemas use .passthrough() — FAIL (MAJOR-2)
- [ ] All strings use .trim() — FAIL (MINOR-1)
- [x] Every field has max length — PASS (content max 2000, accent max 20)
- [x] Types exported via z.infer — PASS
- [x] z.enum() used for enum validation — PASS

### Repository
- [ ] Every method accepts tx?: PrismaTransaction — FAIL (MAJOR-5)
- [x] Soft delete enforced — PASS
- [x] P2002 unique constraint caught — PASS (in MessageTemplateRepository)
- [x] No business logic in repository — PASS
- [x] Mapper used for domain entity conversion — PASS

### Service (Commands/Queries)
- [x] Every method classified as Command or Query — PASS
- [x] Constructor injection on port interfaces — PASS
- [x] Uses domain entity factory for creation — PASS
- [x] Uses mapper for entity-DTO transformations — PASS
- [x] No database queries directly in commands — PASS (goes through repo and ports)
- [x] No req/res objects in commands — PASS
- [ ] Transactions for multi-step operations — FAIL (MAJOR-5: upsert + user sync)
- [x] Multi-tenant check — PASS (vendorId from JWT roleContext throughout)
- [x] Strategy pattern for STT provider — PASS
- [ ] Dynamic imports removed — FAIL (MAJOR-4)

### Error Handling
- [x] Specific error classes used — PASS
- [x] Controller always calls next(error) — PASS
- [x] Multi-tenant masked as NotFound — PASS (findById scoped by vendorId)
- [x] No errors swallowed — PASS (log failures in execute command use logger.warn)
- [ ] logErrorToFile not called for notable errors — FAIL (MINOR-4)
- [x] Error messages are user-facing — PASS

### Controller and Routes
- [x] Arrow function methods — PASS
- [x] try/catch → next(error) — PASS
- [x] No business logic in controller — PASS
- [x] vendorId from JWT (roleContext), not request body — PASS
- [x] Routes file is composition root — PASS
- [x] Middleware chain order correct — PASS
- [x] Response utils used — PASS (sendSuccess, sendCreated)

### Security
- [x] No SQL injection — PASS (Prisma parameterized queries throughout)
- [x] Input validated with Zod — PASS
- [x] Sensitive data not in responses — PASS (mapper whitelist enforced)
- [x] STT provider keys only from env — PASS
- [x] audioData size-capped in Zod — PASS (5 MB limit)
- [x] Rate limiting applied — PASS (writeLimiter on mutations)
- [ ] Delivery list RBAC bypassed for staff — FAIL (BLOCKER-1)
- [x] Tenant isolation enforced via vendorId from JWT — PASS

---

## Fixes Applied by Reviewer

The following mechanical issues were fixed inline (lint: 0 errors, build: clean after changes):

| Fixed | Finding | File |
|-------|---------|------|
| YES | BLOCKER-2: `transliterationEnabled` forced off before `update()` call | `commands/upsert-language-preference/upsert-language-preference.command.ts` |
| YES | MAJOR-2: `listTemplatesQuerySchema` changed from `.strict()` to `.passthrough()` | `voice.validator.ts` |
| YES | MAJOR-4: Dynamic `await import(LanguagePreferenceEntity)` → static import | `commands/upsert-language-preference/upsert-language-preference.command.ts` |
| YES | MAJOR-4: Dynamic `await import(ForbiddenError)` → static import | `voice.controller.ts` |
| YES | MINOR-1: Added `.trim()` to `preferredVoiceAccent`, `content` (upsert), `content` (preview) | `voice.validator.ts` |

---

## Required Changes Before QA

The following must be fixed:

### Critical (must fix before QA):

1. **BLOCKER-1** — `DeliveryActionAdapter._buildRoleContext()` must pass through the real caller role and permissions. Thread `req.roleContext` from the controller through `ExecuteVoiceCommandCommand` into the adapter so `assertListPermission` runs with real staff identity.

2. **BLOCKER-2** — `UpsertLanguagePreferenceCommand.execute()` must force `transliterationEnabled = false` in the patch **before** calling `entity.update(patch)` when `patch.appLanguage` is `'en'`. The post-update call to `forceTransliterationOffForEnglish()` is dead code in the failing scenario.

3. **MAJOR-1** — Add `requirePermission(permissionService, PermissionKey.VOICE_USE)` (or equivalent gate) to the two voice command routes (`POST /:vendorId/voice/transcribe` and `POST /:vendorId/voice/execute-command`).

4. **MAJOR-2** — Change `listTemplatesQuerySchema` from `.strict()` to `.passthrough()`.

5. **MAJOR-3** — Align the voice-command route paths with API_SPEC.md (`/voice/transcribe`, `/voice/execute-command`) or update the spec. The frontend is built against the spec. Recommended: create a dedicated `voiceRouter` mounted at `/api/v1/voice` with JWT auth + `identifyUserRole` sourcing vendorId from JWT (the current controller already does this correctly with `req.roleContext!.vendorId`).

6. **MAJOR-4** — Replace dynamic `await import(...)` with static imports in both `upsert-language-preference.command.ts` and `voice.controller.ts`.

7. **MAJOR-5** — Wrap the two-write sequence (repo.upsert + prisma.user.update) in `prisma.$transaction()`. Add an optional `tx?: PrismaTransaction` parameter to `ILanguagePreferenceRepository.upsert`.

### Should fix (Minor — before or immediately after QA):

8. **MINOR-1** — Add `.trim()` to `preferredVoiceAccent`, and both `content` fields in the Zod schemas.

9. **MINOR-4** — Add `logErrorToFile(err, { correlationId, userId, vendorId })` to the STT failure catch block in `TranscribeVoiceCommandCommand`.

---

## What Is Done Well

The implementation is architecturally sound and follows the DDD/Hexagonal pattern faithfully across the board:

- The domain layer is 100% framework-free. All value objects validate correctly with `ArgumentInvalidException`.
- The ACL pattern (CustomerLookupAdapter, DeliveryActionAdapter) correctly keeps the voice module from owning delivery state — it only delegates.
- The Strategy pattern for STT (ISpeechToTextPort / StubSpeechAdapter / GoogleSpeechAdapter / BhashiniSpeechAdapter) is correctly implemented with the stub as the safe default.
- Mappers are fully three-way (toDomain / toPersistence / toResponse) with proper whitelist enforcement — `userId` and `vendorId` never leak into responses.
- The STT failure path correctly writes a log row before re-throwing, matching the FEATURE_PLAN sequence diagram.
- Test coverage is comprehensive: all VOs, all entities, all mappers, both commands, and the interpreter all have unit tests.
- Prisma schema additions exactly match FEATURE_PLAN data-model spec. Seed data is idempotent.
- Rate limiting, CORS, and audio size cap are all correctly wired.

---

## Fix Pass — 2026-06-14

All remaining findings have been resolved. Final status: **lint 0 errors, build clean, 193/193 voice tests passing**.

### BLOCKER-1 — DeliveryActionAdapter hardcoded `role: 'owner'`

**Fixed.** The `_buildRoleContext()` method and its hardcoded `role: 'owner' / permissions: []` synthetic context were removed entirely. Changes:
- `IDeliveryActionPort.markDelivery` and `markAllPending` signatures updated to include `roleCtx: RoleContext` in the `ctx` parameter (`src/modules/voice/ports/delivery-action.port.ts`).
- `DeliveryActionAdapter` now passes `ctx.roleCtx` directly to `MarkDeliveryCommand` / `MarkBulkDeliveryCommand` (`src/modules/voice/adapters/delivery-action.adapter.ts`).
- `ExecuteVoiceCommandInput` gained a `roleCtx: RoleContext` field (`execute-voice-command.command.ts`).
- Controller `executeCommand` passes `req.roleContext!` into the command input (`voice.controller.ts`).
- Unit tests updated to supply a `MOCK_ROLE_CTX` and added two new RBAC regression tests confirming that a staff `roleCtx` is forwarded without modification to both `markDelivery` and `markAllPending`.

### MAJOR-1 — `voice:use` permission not enforced on voice routes

**Fixed.** A `requireVoiceAccess()` middleware was added in `voice.routes.ts`. It gates routes on `req.roleContext` being present (set by `identifyUserRole` / `identifyUserRoleFromJwt`) and the caller's `role` being `'owner'` or `'staff'`. This is the semantically correct check since both `vendor_owner` and `vendor_staff` hold `voice:use` at the role level (seeded as role-level permissions, not per-staff-membership grants, so `PermissionService.hasCapability` would incorrectly deny staff). Both `POST /voice/transcribe` and `POST /voice/execute-command` now include this guard.

### MAJOR-3 — Route paths deviate from API_SPEC.md §3.1/3.2

**Fixed.** A dedicated third router `voiceCommandRouter` is now exported from `voice.routes.ts` and mounted at `apiPrefix/voice` in `app.ts`. It contains exactly:
- `POST /voice/transcribe`
- `POST /voice/execute-command`

The old vendor-namespaced routes (`POST /vendors/:vendorId/voice/transcribe` and `POST /vendors/:vendorId/voice/execute-command`) have been removed from `vendorVoiceRouter`. A `identifyUserRoleFromJwt` middleware (local to `voice.routes.ts`) resolves `vendorId` from the JWT `vendorIds` array (with optional `?vendorId` query param for multi-vendor callers) and performs the same DB membership + status check as `identifyUserRole`.

### MAJOR-5 — `upsertLanguagePreference` not transactional

**Fixed.** `UpsertLanguagePreferenceCommand.execute()` now wraps both writes in `prisma.$transaction(async (tx) => { ... })` returning the persisted entity. `ILanguagePreferenceRepository.upsert` gained an optional `tx?: PrismaTransaction` parameter, and `LanguagePreferenceRepository.upsert` uses `tx ?? prisma` as the Prisma client. If the `user.preferred_language` sync fails, the `language_preferences` write is rolled back atomically.

### MINOR-2 — GET language-preferences self-guard inconsistency

**Fixed.** `GetLanguagePreferenceQuery.execute()` now accepts `(userId, callerId)` and throws `ForbiddenError` if `callerId !== userId`, mirroring the pattern in `UpsertLanguagePreferenceCommand`. The controller no longer duplicates this guard inline; it simply passes `req.user!.userId` as `callerId`.

### MINOR-4 — `logErrorToFile` not called on STT failure

**Fixed.** `TranscribeVoiceCommandCommand` now imports `logErrorToFile` from `@/common/utils/log-error-to-file` and calls it in the STT failure catch block with `{ correlationId, userId, vendorId }`, satisfying the MEMORY `feedback_error_logging.md` convention. The Pino `logger.error` call is retained alongside it.
