# Feature Tasks: US-013 — Multi-Language & Voice Interface

## Complexity: Moderate (one Complex slice) — Skills: `prisma-schema-design`, `domain-modeling`, `validation-schemas`, `repository-implementation`, `service-implementation`, `error-handling`, `module-scaffold`, `testing-strategy`

> Module: `src/modules/voice/`. `commands/` and `queries/` subdirectories are mandatory.
> Each Phase starts only after the prior phase's streams complete. Streams in the same phase own non-overlapping files.
> Reference the existing **credit** module (`src/modules/credit/`) for the exact command/query/port/adapter style.

---

### Phase 1 (parallel — no cross-stream dependencies)

#### Stream A: Data Foundation
**Files owned**: `prisma/schema.prisma`, `prisma/migrations/`, `prisma/seeds/index.ts`, `project_documents/db-design/17-language-voice.sql`
**Skills**: `prisma-schema-design`
- **Task A1** — Add enums `SupportedLanguage`, `BillLanguagePolicy`, `MessageTemplateType` and models `LanguagePreference`, `MessageTemplate`, `VoiceCommandLog` to `prisma/schema.prisma` exactly as in FEATURE_PLAN §Data Model Changes (incl. back-relations on `User`/`Vendor`, mandatory indexes, `@@unique([vendorId, templateType, languageCode])`). Create migration with a **current UTC timestamp** prefix (`prisma-schema-design` §7). Run `db:generate`. **Output**: schema + migration folder.
- **Task A2** — Seed permissions `message_template:read`, `message_template:manage`, `voice:use` and assign (`*` → owner; `voice:use` → staff) in `prisma/seeds/index.ts`. **Output**: updated seeds.
- **Task A3** — Dev seed: one `MessageTemplate` per type for `en` + `hi` (vendor 1) and a `LanguagePreference` (`hi`) for a seeded staff user. **Output**: updated seeds.
- **Task A4** — Update `project_documents/db-design/17-language-voice.sql` to match the Prisma models (Open Q1): rename `user_language_preferences` → `language_preferences`, add `bill_language_default`, `transliteration_enabled`, enum columns; align `message_templates`/`voice_command_logs`. **Output**: updated SQL.

#### Stream B: Domain Core
**Files owned**: `src/modules/voice/domain/**`
**Skills**: `domain-modeling`
- **Task B1** — Value objects in `domain/value-objects/`: `supported-language.vo.ts` (9-code guard, `toLocale`, `hasScript`), `bill-language-policy.vo.ts` (`resolve`), `template-type.vo.ts` (`allowedPlaceholders` per FEATURE_PLAN table), `template-body.vo.ts` (length + placeholder-whitelist validation, `render`), `voice-intent.vo.ts`, `confidence-score.vo.ts` (`isAutoExecutable`). **Output**: 6 VO files.
- **Task B2** — Entities: `language-preference.entity.ts` (`createDefault`, `update`, invariant: en ⇒ transliteration false), `message-template.entity.ts` (`create`, `updateBody`, `render`, validate placeholders), `voice-command-log.entity.ts` (`record`, INSERT-only). **Output**: 3 entity files.
- **Task B3** — `domain/voice-command-interpreter.ts` (pure domain service: honorific strip, pattern match, fuzzy name match, confidence) + `domain/intent-patterns.ts` (per-language regex tables for `hi`, `ta`, fallback `en`; others fall back). **Output**: 2 files.
- **Task B4** — `domain/voice.types.ts` (enums/string-literal unions) and `domain/voice.errors.ts` (`InvalidTemplatePlaceholderError`, `SpeechProviderError`, `UnprocessableVoiceCommandError` extending the shared `AppError` with correct HTTP codes per FEATURE_PLAN §Error Handling). **Output**: 2 files.

#### Stream C: Validation Layer
**Files owned**: `src/modules/voice/voice.validator.ts`, `src/modules/voice/voice.types.ts`
**Skills**: `validation-schemas`
- **Task C1** — Zod schemas (strict bodies, `z.enum` for language/type/policy/action, numeric-string→bigint coercion helpers, `audioData` ≤ 5 MB): `upsertLanguagePreferenceSchema`, `userIdParamSchema`, `vendorIdParamSchema`, `listTemplatesQuerySchema`, `upsertTemplateSchema`, `previewTemplateSchema`, `transcribeSchema`, `executeCommandSchema`. **Output**: `voice.validator.ts`.
- **Task C2** — Shared response DTO types + `toDto` shapes (string ids, number confidence) in `voice.types.ts` matching API_SPEC payloads. **Output**: `voice.types.ts`.

---

### Phase 2 (parallel — after Phase 1)

#### Stream D: Data Access + Mappers
**Files owned**: `src/modules/voice/database/**`, `src/modules/voice/*.mapper.ts`
**Skills**: `repository-implementation`
**Depends on**: A (schema), B (domain types)
- **Task D1** — Ports: `language-preference.repository.port.ts` (`findByUser`, `upsert`), `message-template.repository.port.ts` (`findByKey`, `list`, `upsert`, `findById`), `voice-command-log.repository.port.ts` (`insert`, `markExecuted`). **Output**: 3 port files.
- **Task D2** — Prisma adapters for the 3 ports: soft-delete filters on templates, P2002 → `ConflictError`, atomic upsert; log adapter INSERT-only + `markExecuted`. **Output**: 3 repository files.
- **Task D3** — Mappers `language-preference.mapper.ts`, `message-template.mapper.ts`, `voice-command-log.mapper.ts` (`toDomain`/`toPersistence`/`toResponse`, whitelist per DOMAIN_MODEL §Mapper). **Output**: 3 mapper files.

#### Stream E: ACL Ports + Adapters (external + cross-module)
**Files owned**: `src/modules/voice/ports/**`, `src/modules/voice/adapters/**`
**Skills**: `service-implementation` (ACL/Strategy section), `ddd-module-design` §4
**Depends on**: B (domain types)
- **Task E1** — `ports/speech-to-text.port.ts` + adapters `stub-speech.adapter.ts` (deterministic, default), `google-speech.adapter.ts` and `bhashini-speech.adapter.ts` (shells throwing `SpeechProviderError` until creds wired); add env vars `SPEECH_PROVIDER`/`GOOGLE_SPEECH_KEY`/`BHASHINI_*` to the config Zod schema (optional, defaults). **Output**: port + 3 adapters + config edit.
- **Task E2** — `ports/customer-lookup.port.ts` + `adapters/customer-lookup.adapter.ts` (`listRosterForList`, `getCustomer`, tenant-scoped reads of supply-list customers). **Output**: port + adapter.
- **Task E3** — `ports/delivery-action.port.ts` + `adapters/delivery-action.adapter.ts` wrapping existing `MarkDeliveryCommand`/`MarkBulkDeliveryCommand` and resolving `deliveryId` from `(vendorId, supplyListId, customerId, serviceDate)`. Must reuse delivery commands, not re-implement. **Output**: port + adapter.

#### Stream F: Renderer facade
**Files owned**: `src/modules/voice/voice.renderer.ts`
**Skills**: `service-implementation`
**Depends on**: B (TemplateBody, BillLanguagePolicy)
- **Task F1** — `MessageTemplateRenderer` public facade: `render(template, data)` + `resolveBillLanguage(policy, ownerLang, customerLang)`, for downstream billing/reminder modules. **Output**: `voice.renderer.ts`.

---

### Phase 3 (parallel — after Phase 2)

#### Stream G: Application — Commands
**Files owned**: `src/modules/voice/commands/**`
**Skills**: `service-implementation` (CQS)
**Depends on**: D, E
- **Task G1** — `commands/upsert-language-preference/upsert-language-preference.command.ts` (Command): upsert + sync `users.preferred_language`; self-guard. **Output**: 1 file.
- **Task G2** — `commands/upsert-message-template/upsert-message-template.command.ts` (Command): validate placeholders via `TemplateBody`, upsert, P2002→409, owner/tenant guard. **Output**: 1 file.
- **Task G3** — `commands/transcribe-voice-command/transcribe-voice-command.command.ts` (Command): STT port → interpreter → combined confidence → insert log (`wasExecuted:false`); never mutates delivery; STT failure still logs + throws `SpeechProviderError`. **Output**: 1 file.
- **Task G4** — `commands/execute-voice-command/execute-voice-command.command.ts` (Command): validate intent, resolve delivery id or mark-all via delivery port, `markExecuted` log; `unknown`/unresolved → 422. **Output**: 1 file.

#### Stream H: Application — Queries
**Files owned**: `src/modules/voice/queries/**`
**Skills**: `service-implementation` (CQS)
**Depends on**: D
- **Task H1** — `queries/get-language-preference/get-language-preference.query.ts` (returns defaults if absent). **Output**: 1 file.
- **Task H2** — `queries/list-message-templates/list-message-templates.query.ts` + `queries/get-message-template/get-message-template.query.ts`. **Output**: 2 files.
- **Task H3** — `queries/preview-message-template/preview-message-template.query.ts` (render supplied or saved content; return `{preview, unresolved}`). **Output**: 1 file.

---

### Phase 4 (after Phase 3)

#### Stream I: Interface Layer
**Files owned**: `src/modules/voice/voice.controller.ts`, `src/modules/voice/voice.routes.ts`, `src/app.ts`
**Skills**: `module-scaffold` (Steps 5–9)
**Depends on**: C, G, H
- **Task I1** — `voice.controller.ts`: arrow-fn handlers, `try/catch → next(error)`, ids/vendorId from JWT context, map use-case results to API_SPEC response shapes. **Output**: controller.
- **Task I2** — `voice.routes.ts`: composition root (instantiate repos/adapters/commands/queries like `credit.routes.ts`), middleware chain `authenticateToken → validate → identifyUserRole('vendorId') → requireOwnerRole()` (templates) / list-marking guard (voice) / self-guard (prefs); `writeLimiter`; STT provider selected from env. Mount the user-preference and voice routers in `app.ts`; add Swagger annotations. **Output**: routes + `app.ts` edit.

#### Stream J: Tests
**Files owned**: `src/modules/voice/__tests__/**`, `tests/integration/voice.test.ts`
**Skills**: `testing-strategy`
**Depends on**: all
- **Task J1** — Unit: VO validations (each VO), `TemplateBody` placeholder whitelist, `VoiceCommandInterpreter` (hi/ta patterns, honorific strip, fuzzy match, ambiguity, unknown), `BillLanguagePolicy.resolve`, mapper whitelists, commands with mocked ports (incl. STT failure path). **Output**: unit specs.
- **Task J2** — Integration: full HTTP lifecycle for all 7 endpoints with `StubSpeechAdapter`; correlationId in errors; auth/RBAC (self-guard, owner-only, list-marking); multi-tenant isolation (wrong vendor → 404); duplicate template → 409; unknown intent → 422. **Output**: `tests/integration/voice.test.ts`.
