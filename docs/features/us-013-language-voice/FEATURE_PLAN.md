# Feature: US-013 — Multi-Language & Voice Interface

> Branch: `feat/us-013-language-voice` · Module: `src/modules/voice/`
> Companion docs: [DOMAIN_MODEL.md](./DOMAIN_MODEL.md) · [API_SPEC.md](./API_SPEC.md) · [FEATURE_TASKS.md](./FEATURE_TASKS.md) · [FEATURE_BUGS.md](./FEATURE_BUGS.md)
> Skills to follow: `ddd-module-design`, `domain-modeling`, `api-contract-design`, `prisma-schema-design`, `validation-schemas`, `repository-implementation`, `service-implementation`, `error-handling`, `testing-strategy`.

## Complexity Assessment
- **Tier**: **Moderate** overall, with one **Complex** slice (voice interpretation + cross-module execution).
- **Justification**: see DOMAIN_MODEL §Complexity. Language preferences and message templates are CRUD with light invariants; voice interpretation needs a pure domain service, value objects, a **Strategy** for the STT provider, and an **ACL** to Delivery/Customer. No domain events are *published* by this module.
- **Directory Structure**: Complex layout (`domain/`, `commands/`, `queries/`, `database/`, `ports/`, `adapters/`) — `commands/` and `queries/` subdirs are mandatory (MEMORY: module file structure).

## Scope
**In scope (backend):**
1. `voice` module with language-preference upsert/read, message-template CRUD + preview, voice transcribe + execute.
2. New Prisma models: `LanguagePreference`, `MessageTemplate`, `VoiceCommandLog` (see Data Model Changes).
3. STT **Strategy** port + Google/Bhashini/Stub adapters (Stub is the default and the only one fully wired now).
4. ACL adapters reusing existing **Delivery** mark commands and **Customer** roster reads.
5. `MessageTemplateRenderer` facade + `BillLanguagePolicy.resolve` for downstream billing/reminders.
6. Permission seeds, dev seed templates, unit + integration tests.

**Out of scope:**
- UI translation `.json` bundles (frontend repo).
- Front-end transliteration (client-side library; backend stores only the toggle).
- Real Google/Bhashini credentials + audio infra (adapters stubbed behind env; wiring is a deploy concern).
- `adjust_quantity` *interpretation patterns* are stubbed to `UNKNOWN` for non-English now (US marks it "future"); the **execute** path supports `adjust_quantity` so the API is forward-compatible.

## Domain Model (summary — full detail in DOMAIN_MODEL.md)
- **Aggregates**: `LanguagePreference` (root, 1:1 user), `MessageTemplate` (root, vendor-scoped). `VoiceCommandLog` is an INSERT-only analytics record.
- **Value Objects**: `SupportedLanguage`, `BillLanguagePolicy`, `TemplateType`, `TemplateBody`, `VoiceIntent`, `ConfidenceScore`.
- **Domain service**: `VoiceCommandInterpreter` (pure: transcription + roster → intent + match + confidence).
- **Domain Events**: none published. (This module is a downstream consumer of Delivery.)
- **Aggregate boundaries**: `LanguagePreference` references `userId` by ID; `MessageTemplate`/`VoiceCommandLog` reference `vendorId`/`userId`/`customerId`/`supplyListId` **by ID only** — no cross-aggregate Prisma relations into Customer/Delivery/SupplyList.

## API Endpoints (full contract in API_SPEC.md)
| # | Method | Path | CQS | Auth | Permission |
|---|--------|------|-----|------|-----------|
| 1.1 | GET | `/users/:userId/language-preferences` | Query | self | — (self) |
| 1.2 | PATCH | `/users/:userId/language-preferences` | Command | self | — (self) |
| 2.1 | GET | `/vendors/:vendorId/message-templates` | Query | owner | `message_template:read` |
| 2.2 | PUT | `/vendors/:vendorId/message-templates` | Command | owner | `message_template:manage` |
| 2.3 | POST | `/vendors/:vendorId/message-templates/preview` | Query | owner | `message_template:read` |
| 3.1 | POST | `/voice/transcribe` | Command (writes log) | vendor user | `voice:use` + list marking access |
| 3.2 | POST | `/voice/execute-command` | Command | vendor user | `voice:use` + `mark_deliveries`/`mark_leaves` on list |

- Validation: Zod, **strict** (`.strict()`) for all mutation bodies; `z.nativeEnum`/`z.enum` for the language/type enums; query schemas allow only the documented params. IDs accepted as numeric strings and coerced to BigInt.
- All error responses carry `meta.correlationId`.

## Data Model Changes (Prisma)

> The Dev applies these to `prisma/schema.prisma` and creates a migration with a **current UTC timestamp** prefix (see `prisma-schema-design` §7). Three new models + three new enums. `User.preferred_language` and `Customer.language_preference` already exist and are reused (no change).

### Enums
```prisma
enum SupportedLanguage {
  EN HI TA TE MR BN KN ML GU
  @@map("supported_language")
}

enum BillLanguagePolicy {
  CUSTOMER
  MY_LANGUAGE
  ENGLISH
  @@map("bill_language_policy")
}

enum MessageTemplateType {
  PAYMENT_REMINDER
  MONTHLY_BILL
  DELIVERY_CONFIRMATION
  LEAVE_CONFIRMATION
  @@map("message_template_type")
}
```

### Model: LanguagePreference  (replaces the raw `user_language_preferences` SQL — see Open Q1)
```prisma
model LanguagePreference {
  id        BigInt @id @default(autoincrement())
  userId    BigInt @unique @map("user_id")

  appLanguage           SupportedLanguage  @default(EN) @map("app_language")
  secondaryLanguage     SupportedLanguage? @map("secondary_language")
  voiceCommandsEnabled  Boolean            @default(false) @map("voice_commands_enabled")
  voiceResponsesEnabled Boolean            @default(false) @map("voice_responses_enabled")
  transliterationEnabled Boolean           @default(false) @map("transliteration_enabled")
  billLanguageDefault   BillLanguagePolicy @default(CUSTOMER) @map("bill_language_default")
  preferredVoiceAccent  String?            @map("preferred_voice_accent") @db.VarChar(20)

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([appLanguage])
  @@map("language_preferences")
}
```

### Model: MessageTemplate
```prisma
model MessageTemplate {
  id           BigInt              @id @default(autoincrement())
  vendorId     BigInt              @map("vendor_id")
  templateType MessageTemplateType @map("template_type")
  languageCode SupportedLanguage   @map("language_code")
  content      String              @map("content") @db.Text
  isActive     Boolean             @default(true) @map("is_active")

  createdAt DateTime  @default(now()) @map("created_at")
  updatedAt DateTime  @updatedAt @map("updated_at")
  deletedAt DateTime? @map("deleted_at")

  vendor Vendor @relation(fields: [vendorId], references: [id], onDelete: Cascade)

  @@unique([vendorId, templateType, languageCode])
  @@index([vendorId])
  @@index([templateType])
  @@index([languageCode])
  @@index([deletedAt])
  @@index([createdAt])
  @@map("message_templates")
}
```

### Model: VoiceCommandLog  (INSERT-only analytics; no soft delete)
```prisma
model VoiceCommandLog {
  id              BigInt   @id @default(autoincrement())
  userId          BigInt   @map("user_id")
  vendorId        BigInt   @map("vendor_id")
  languageCode    SupportedLanguage @map("language_code")
  supplyListId    BigInt?  @map("supply_list_id")
  customerId      BigInt?  @map("customer_id")
  transcription   String?  @map("transcription") @db.Text
  detectedAction  String?  @map("detected_action") @db.VarChar(40)
  confidenceScore Decimal? @map("confidence_score") @db.Decimal(5, 2)
  wasExecuted     Boolean  @default(false) @map("was_executed")
  executionResult Json?    @map("execution_result")
  errorMessage    String?  @map("error_message") @db.Text

  createdAt DateTime @default(now()) @map("created_at")

  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  vendor Vendor @relation(fields: [vendorId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([vendorId])
  @@index([detectedAction])
  @@index([createdAt])
  @@map("voice_command_logs")
}
```
- Add the matching back-relations on `User`, `Vendor` (`languagePreference LanguagePreference?`, `messageTemplates MessageTemplate[]`, `voiceCommandLogs VoiceCommandLog[]`).
- Decimal serialized as a number in responses; BigInt as string.

### Seed data
- Permissions: `message_template:read`, `message_template:manage`, `voice:use` → assigned to **owner** role; `voice:use` also to **staff** role.
- Dev seed: one `MessageTemplate` per type for `en` + `hi` for vendor 1; a `LanguagePreference` for the seeded users (`hi` for one staff user to demo).

## Business Rules
- **Language**: only the 9 codes are valid. `secondaryLanguage` ≠ `appLanguage`. `appLanguage = en` ⇒ `transliterationEnabled = false` (forced). Upsert also writes `users.preferred_language` (denormalized sync).
- **Templates**: unique per `(vendorId, type, language)`. Placeholders must be in the type whitelist (DOMAIN_MODEL §TemplateType). 1–2000 chars. Owner-only.
- **Voice transcribe**: never mutates delivery state; always records a log row (even on STT failure). `autoExecute = confidence > 80`. Combined confidence = `round(0.5*sttConfidence + 0.5*matchConfidence)`.
- **Voice execute**: re-uses Delivery's `MarkDeliveryCommand`/`MarkBulkDeliveryCommand` via the ACL → all delivery invariants + list RBAC enforced there. Honorifics stripped before matching. Ambiguous/Unknown → 422.
- **Multi-tenant isolation**: every query scoped by `vendorId` from JWT context; wrong-tenant resource → **404** (never reveal existence). `:userId` ≠ self → 403.
- **Bill language**: `BillLanguagePolicy.resolve(ownerLang, customerLang)`.

## Sequence — Voice transcribe + execute
```
Client → POST /voice/transcribe { audioData, languageCode, supplyListId, serviceDate }
  Controller → validate(Zod) → TranscribeVoiceCommand.execute(ctx, input)
    ISpeechToTextPort.transcribe({audioBase64, locale=hi-IN}) → { transcription, sttConfidence }
    ICustomerLookupPort.listRosterForList(vendorId, supplyListId, serviceDate) → roster[]
    VoiceCommandInterpreter.interpret(transcription, lang, roster)
        → { intent(VoiceIntent), customerId?, candidates?, matchConfidence }
    combined = round(0.5*sttConfidence + 0.5*matchConfidence)
    VoiceCommandLogRepository.insert({...wasExecuted:false, confidence:combined})
    mapper.toResponse → { logId, transcription, confidence, interpretation{ ..., autoExecute } }
  ← 200

Client (autoExecute or after confirm) → POST /voice/execute-command { interpretation, supplyListId, serviceDate, logId }
  Controller → validate → ExecuteVoiceCommand.execute(ctx, input)
    if action == mark_all:
        IDeliveryActionPort.markAllPending(ctx, supplyListId, serviceDate, meta) → { markedCount }
    else:
        deliveryId = IDeliveryActionPort.resolveDeliveryId(vendorId, supplyListId, customerId, serviceDate)
        if !deliveryId → NotFoundError (404)
        IDeliveryActionPort.markDelivery(ctx, deliveryId, status, meta)   // reuses MarkDeliveryCommand → list RBAC + invariants
    VoiceCommandLogRepository.markExecuted(logId, result)   // or insert new
  ← 200 { executed:true, ... }
```

## Strategy Interfaces (external services)
- **`ISpeechToTextPort`** (Strategy): `{ id, transcribe({audioBase64, locale}) → {transcription, confidence} }`. Adapters: `GoogleSpeechAdapter`, `BhashiniSpeechAdapter`, `StubSpeechAdapter`. Selected at the routes composition root from `env.SPEECH_PROVIDER` (default `stub`). Provider errors → `SpeechProviderError` (502). New env vars (add to config schema, all optional with safe defaults): `SPEECH_PROVIDER` (`stub`|`google`|`bhashini`, default `stub`), `GOOGLE_SPEECH_KEY?`, `BHASHINI_API_KEY?`, `BHASHINI_USER_ID?`.
- **`ICustomerLookupPort`** / **`IDeliveryActionPort`** — ACL ports (DOMAIN_MODEL §ACL). The Delivery adapter constructs and calls the existing `MarkDeliveryCommand`/`MarkBulkDeliveryCommand`; it must **not** re-implement marking.

## Error Handling Strategy
| Operation | Error class → HTTP |
|-----------|--------------------|
| Unknown/invalid language or policy | `ValidationError` → 400 |
| `secondaryLanguage == appLanguage` | `ValidationError` → 400 |
| Unknown placeholder in template | `InvalidTemplatePlaceholderError` → 400 (`INVALID_PLACEHOLDER`, token in details) |
| Duplicate template (P2002) | `ConflictError` → 409 |
| Template/preference/list wrong tenant or missing | `NotFoundError` → 404 |
| `:userId` ≠ self | `ForbiddenError` → 403 |
| No marking permission on list | reuse delivery `ForbiddenError` → 403 |
| Customer not on list for date / no pending delivery | `NotFoundError` → 404 |
| Delivery already in requested state | `ConflictError` → 409 (from delivery command) |
| Interpretation `unknown` / unresolved customer on execute | `UnprocessableError` → 422 |
| STT provider failure | `SpeechProviderError` → 502 |
| Rate limit | `TooManyRequestsError` → 429 |
- All errors logged with `correlationId`; per MEMORY (error logging) also appended to `Logs/YYYY-MM-DD.txt`. New error classes go in `voice/domain/voice.errors.ts` extending the shared `AppError`.

## Security Considerations
- Voice/template endpoints are tenant-scoped via `identifyUserRole('vendorId')`; templates owner-gated (`requireOwnerRole`), voice gated by existing list-marking permission (reused from Delivery via the ACL).
- `audioData` size-capped in Zod (e.g. ≤ 5 MB base64) to prevent abuse; `writeLimiter` rate limit on all voice/template mutations (reuse credit module's per-user limiter pattern).
- `executionResult` JSON must not store PII beyond customer id/name + action.
- STT provider keys read only from env at composition root; never logged.

## Performance Considerations
- `language_preferences.user_id` unique index; `message_templates` unique `(vendorId, type, language)` covers the hot read; `voice_command_logs` indexed on `vendorId`, `detectedAction`, `createdAt` for analytics.
- Roster lookup for interpretation is a single scoped query; cap audio size; target voice round-trip < 2 s (dominated by STT).
- Template list is small (≤ 9 langs × 4 types) — no pagination needed.

## Open Questions (recommendation + trade-off; defaults chosen so the team is not blocked)

1. **Persist as a typed `language_preferences` table vs. the db-design `user_language_preferences` raw SQL?**
   - *Recommendation*: use the typed Prisma model `LanguagePreference` (table `language_preferences`) as specified above, and update `project_documents/db-design/17-language-voice.sql` to match (rename, add `bill_language_default`, `transliteration_enabled`, enum columns). Trade-off: a one-time edit to the design SQL, but we gain enum safety, the `bill_language_default`/`transliteration` fields the US/wireframe require (the raw SQL omitted them), and consistency with the rest of the Prisma schema. *(I have not yet edited the SQL — flagged here; Dev/Architect to apply alongside the migration.)*

2. **Voice intent storage: enum column vs. free `VARCHAR`?**
   - *Recommendation*: keep `detected_action` as `VARCHAR(40)` (not a DB enum) in `voice_command_logs`. Trade-off: slightly weaker typing at the DB layer, but the log is append-only analytics and an enum would force a migration every time we add an intent — flexibility wins for a log table. The API/domain still validate via the `VoiceIntent` VO.

3. **STT provider for v1 — Google vs. Bhashini vs. stub?**
   - *Recommendation*: ship the **Strategy** with all three adapter shells but default `SPEECH_PROVIDER=stub` and only fully implement the stub now (deterministic transcription for tests/demo). Trade-off: real transcription is not live until creds + the Google/Bhashini adapter bodies are finished, but the contract, interpretation, execution, and tests are complete and provider-swappable — unblocking the whole pipeline without a cloud dependency.

4. **Should high-confidence (>80%) commands auto-execute server-side in `/voice/transcribe`?**
   - *Recommendation*: **No** — transcribe only interprets and returns `autoExecute: true`; the client calls `/voice/execute-command`. Trade-off: one extra round trip for the happy path, but it keeps `transcribe` side-effect-light (no delivery mutation), gives the client a chance to honour "Undo/Next" UX (wireframe 2.49), and makes execution idempotently auditable. (The client may chain the two calls instantly.)

5. **`adjust_quantity` now or later?**
   - *Recommendation*: support it in the **execute** API + VO now (forward-compatible), but leave non-English **interpretation patterns** returning `UNKNOWN` (US labels it "future"). Trade-off: a small amount of unexercised execute code, but no breaking API change when patterns are added later.

6. **`message_templates` soft-delete vs. `is_active` only?**
   - *Recommendation*: include both `deletedAt` (per mandatory-index convention) and `isActive`. Trade-off: minor redundancy, but matches the schema-design checklist (every deletable model has `deletedAt`) while `isActive` lets owners temporarily disable a template without deleting.
