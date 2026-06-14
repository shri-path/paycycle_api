# Domain Model: US-013 — Multi-Language & Voice Interface

## Complexity Assessment

- **Level**: **Moderate** (one slice — Voice Command interpretation/execution — has Complex characteristics; the rest is Simple CRUD).
- **Justification**:
  - `LanguagePreference`, `MessageTemplate` and `VoiceCommandLog` are essentially CRUD/persistence with light invariants (enum validity, placeholder syntax, uniqueness). → Domain Entity with minimal behaviour.
  - **Voice command interpretation + execution** is the only genuinely complex slice: it parses transcribed text into an *intent*, fuzzy-matches a customer, computes a confidence score, then **delegates a state change to the Delivery aggregate** (cross-module). This needs Value Objects (`VoiceIntent`, `ConfidenceScore`), a domain service (`VoiceCommandInterpreter`), and an Anti-Corruption Layer to Delivery/Customer. It does **not** own a write aggregate of its own — the log is INSERT-only analytics.
- **Architecture depth**: Domain Entities + Value Objects + a stateless domain service for interpretation + ports/adapters (ACL) for STT provider, Customer lookup, and Delivery mutation. Full event sourcing is **not** warranted (no cross-module reactions are required *from* this module — it is a downstream consumer of Delivery, not a publisher).

---

## Ubiquitous Language

| Term | Definition |
|------|-----------|
| **Language Preference** | A user's per-account UI language + voice/transliteration toggles + default bill language policy. |
| **Supported Language** | One of the 9 fixed ISO-639-1 codes: `en, hi, ta, te, mr, bn, kn, ml, gu`. |
| **Locale Code** | Speech-API form of a language: `<lang>-IN` (e.g. `hi-IN`). Derived, never stored. |
| **Message Template** | Vendor-owned, per-(type, language) free text with `{{placeholder}}` tokens used to render bills/reminders/confirmations. |
| **Placeholder** | A `{{token}}` inside a template, replaced at render time (e.g. `{{customer_name}}`). |
| **Transcription** | The text produced by the speech-to-text provider from an audio clip. |
| **Voice Intent** | The interpreted action of a transcription: `MARK_DELIVERED`, `MARK_LEAVE`, `MARK_ALL`, `ADJUST_QUANTITY`, `UNKNOWN`. |
| **Confidence Score** | 0–100 measure combining STT confidence and customer-match strength. |
| **Voice Command Log** | Immutable analytics record of a transcription, its interpretation, and its execution result. |
| **Bill Language Policy** | How the bill language is chosen: `CUSTOMER` (customer's language), `MY_LANGUAGE` (owner's), `ENGLISH`. |

---

## Context Map: Language & Voice

### Owned Concepts
- **Language Preference** — the user's language/voice/transliteration/bill settings.
- **Message Template** — vendor-scoped per-language message bodies + placeholder rendering.
- **Voice Command interpretation** — transcription → intent + customer match + confidence.
- **Voice Command Log** — analytics record (INSERT-only).
- **Rendered message** — output of applying a template + data.

### Boundaries
- This module **OWNS**: `LanguagePreference`, `MessageTemplate`, `VoiceCommandLog`, the interpretation/rendering logic, the STT provider port.
- This module **DOES NOT OWN**:
  - The actual delivery state change (owned by **Delivery** / US-006) — invoked via an ACL port.
  - Customer identity/roster (owned by **Customer** / US-008) — read via an ACL port.
  - The UI translation `.json` bundles — those ship in the frontend repo (`paycycle_vendor`). The backend does **not** serve UI strings.
- Module internals are PRIVATE — no other module imports from `voice/` directly.

### Relationships
| Related Context | Relationship | Integration Pattern | Communication | Shared Data |
|-----------------|-------------|---------------------|---------------|-------------|
| Auth | Upstream | Conformist | JWT claims | `userId`, `vendorId`, role |
| Customer (US-008) | Downstream dependency | Anti-Corruption Layer (port) | Direct read via `ICustomerLookupPort` | `customerId`, `name`, `languagePreference` |
| Delivery (US-006) | Downstream dependency | Anti-Corruption Layer (port) | Direct call via `IDeliveryActionPort` (wraps `MarkDeliveryCommand` / `MarkBulkDeliveryCommand`) | `deliveryId`, `supplyListId`, `serviceDate`, `status` |
| Speech provider (Google STT / Bhashini) | External | ACL + **Strategy** | `ISpeechToTextPort` | audio → `{transcription, confidence}` |
| Billing/Reminders (US-009/US-012) | Peer | Open Host (this module exposes a render service) | `MessageTemplateRenderer` | template + data → string |

### Cross-Module Communication Strategy
- **Synchronous, port-based ACL**. The voice-execute use case fuzzy-matches a customer (Customer port), resolves the matching `DailySupply` for the service date, then calls the Delivery action port. Each external boundary is an interface defined in this module and implemented by an adapter in `voice/adapters/`.
- **No domain events are published by this module** — it does not need other modules to react to it. (The `VoiceCommandLog` is analytics, written inline.)
- **Strategy pattern** for the STT provider so Google STT can be swapped for Bhashini without touching application code.

---

## Aggregates

### 1. LanguagePreference Aggregate
- **Root Entity**: `LanguagePreferenceEntity`
- **Nested Entities**: None
- **Value Objects**: `SupportedLanguage`, `BillLanguagePolicy`
- **Invariants** (enforced in `validate()`):
  1. `appLanguage` must be a `SupportedLanguage`.
  2. `secondaryLanguage`, when present, must be a `SupportedLanguage` and ≠ `appLanguage`.
  3. `billLanguageDefault` must be a valid `BillLanguagePolicy`.
  4. If `appLanguage === 'en'`, `transliterationEnabled` is forced `false` (no script to transliterate to). (Edge case 10.)
- **Lifecycle**: Created (on first read with defaults) → Updated.
- **Commands**: `UpsertLanguagePreference`.
- **Queries**: `GetLanguagePreference`.

### 2. MessageTemplate Aggregate
- **Root Entity**: `MessageTemplateEntity`
- **Value Objects**: `TemplateType`, `SupportedLanguage`, `TemplateBody` (validates placeholder syntax & whitelist).
- **Invariants**:
  1. `(vendorId, templateType, languageCode)` is unique.
  2. `templateType` ∈ {`PAYMENT_REMINDER`, `MONTHLY_BILL`, `DELIVERY_CONFIRMATION`, `LEAVE_CONFIRMATION`}.
  3. Every `{{placeholder}}` in the body must be in the allowed set for its `templateType`.
  4. Body length 1..2000 chars.
- **Lifecycle**: Created → Updated → (soft) Deactivated.
- **Commands**: `UpsertMessageTemplate`.
- **Queries**: `ListMessageTemplates`, `GetMessageTemplate`, `PreviewMessageTemplate`.

### 3. VoiceCommandLog (Analytics record — not a write aggregate)
- INSERT-only. No update/delete. No invariants beyond "must reference a user". Written by the transcribe and execute use cases.

> **Voice interpretation/execution is a use case, not an aggregate.** It orchestrates the Customer port, Delivery port, and the `VoiceCommandInterpreter` domain service, and records a `VoiceCommandLog`.

---

## Entities

### Entity: LanguagePreferenceEntity
- **Identity**: BigInt (autoincrement); 1:1 with `userId` (unique).
- **Fields**: `id`, `userId`, `appLanguage` (VO), `secondaryLanguage?` (VO|null), `voiceCommandsEnabled`, `voiceResponsesEnabled`, `transliterationEnabled`, `billLanguageDefault` (VO), `preferredVoiceAccent?`, `createdAt`, `updatedAt`.
- **Behaviour**:
  - `static createDefault(userId)` → defaults `{ appLanguage: 'en', voiceCommandsEnabled: false, voiceResponsesEnabled: false, transliterationEnabled: false, billLanguageDefault: CUSTOMER }`.
  - `update(patch)` → applies a partial, re-runs `validate()` (enforces invariant 4 — disable transliteration for `en`).
- **Note**: This is the *source of truth* for app language. `users.preferred_language` (already in schema) is kept in sync as a denormalized convenience column by the upsert command (so other modules that already read `users.preferred_language` keep working). The dedicated table holds the richer voice/bill fields.

### Entity: MessageTemplateEntity
- **Identity**: BigInt (autoincrement).
- **Fields**: `id`, `vendorId`, `templateType` (VO), `languageCode` (VO), `body` (VO `TemplateBody`), `isActive`, `createdAt`, `updatedAt`, `deletedAt?`.
- **Behaviour**:
  - `static create({ vendorId, templateType, languageCode, body })`.
  - `updateBody(body: TemplateBody)`.
  - `render(data: Record<string,string>): string` — replaces every `{{token}}`; missing values render as empty string and are reported (used by preview to list unresolved placeholders).
- **Invariants**: as above; `validate()` checks placeholder whitelist for the type.

### Entity: VoiceCommandLogEntity
- **Identity**: BigInt (autoincrement). INSERT-only.
- **Fields**: `id`, `userId`, `commandText?`, `commandAudioUrl?`, `detectedIntent?`, `wasExecuted`, `executionResult?` (Json), `errorMessage?`, `confidenceScore?`, `customerId?`, `supplyListId?`, `createdAt`.
- **Behaviour**: `static record({...})` — no mutation after creation.

---

## Value Objects

### SupportedLanguage
- **Properties**: `value: string` (one of the 9 codes).
- **Validation**: must be in `['en','hi','ta','te','mr','bn','kn','ml','gu']`. Guard rejects empty/unknown.
- **Helpers**: `toLocale(): string` → `${value}-IN` for STT; `hasScript(): boolean` → `false` only for `en`.
- **Equality**: structural.

### BillLanguagePolicy
- **Properties**: `value: 'CUSTOMER' | 'MY_LANGUAGE' | 'ENGLISH'`.
- **Validation**: enum membership.
- **Helper**: `resolve(ownerLang: SupportedLanguage, customerLang: SupportedLanguage): SupportedLanguage` — applies the policy (Edge case 6: staff Hindi, customer Tamil → bill in customer's language).

### TemplateType
- **Properties**: `value: 'PAYMENT_REMINDER' | 'MONTHLY_BILL' | 'DELIVERY_CONFIRMATION' | 'LEAVE_CONFIRMATION'`.
- **Validation**: enum membership.
- **Helper**: `allowedPlaceholders(): string[]`.

| TemplateType | Allowed placeholders |
|--------------|----------------------|
| PAYMENT_REMINDER | `customer_name, month, amount, upi_id, phone, vendor_name, due_date` |
| MONTHLY_BILL | `customer_name, month, total_due, items, upi_id, phone, vendor_name` |
| DELIVERY_CONFIRMATION | `customer_name, item, quantity, date, vendor_name` |
| LEAVE_CONFIRMATION | `customer_name, from_date, to_date, vendor_name` |

### TemplateBody
- **Properties**: `raw: string`.
- **Validation** (constructor): length 1..2000; extract `{{...}}` tokens via regex `/\{\{\s*([a-z_]+)\s*\}\}/g`; **all extracted tokens must be in the type's whitelist** (constructor takes the `TemplateType` to validate against). Unknown placeholder → `InvalidTemplatePlaceholderError`.
- **Helper**: `placeholders(): string[]`, `render(data): { text: string; unresolved: string[] }`.

### VoiceIntent
- **Properties**: `action: 'MARK_DELIVERED' | 'MARK_LEAVE' | 'MARK_ALL' | 'ADJUST_QUANTITY' | 'UNKNOWN'`, `customerName?: string`, `quantity?: number`.
- **Validation**: action enum; if action ∈ {MARK_DELIVERED, MARK_LEAVE} then `customerName` required; if ADJUST_QUANTITY then `quantity > 0`.

### ConfidenceScore
- **Properties**: `value: number` (0..100, 2dp).
- **Validation**: 0 ≤ value ≤ 100.
- **Helper**: `isAutoExecutable(threshold = 80): boolean` → `value > threshold`.

---

## Domain Service: VoiceCommandInterpreter (pure, framework-free)

- **Input**: `transcription: string`, `language: SupportedLanguage`, `roster: { id: bigint; name: string }[]`.
- **Responsibility**:
  1. Strip honorifics (`ji`, `जी`, `sir`, `madam`, etc.) — Edge case 8.
  2. Match a per-language intent pattern table (delivered / leave / mark_all / quantity). Falls back to `en` patterns.
  3. For name-bearing intents, fuzzy-match the spoken name against `roster` (Levenshtein-ratio threshold 0.6; ties → ambiguous). Edge cases 2 & 5.
  4. Produce `{ intent: VoiceIntent, customerId?: bigint, candidates?: bigint[], confidence: ConfidenceScore }`.
     - exact/strong match → confidence 90–98
     - weak/ambiguous match → confidence 40–60, `candidates` populated (disambiguation)
     - no match / `UNKNOWN` → confidence 0
- **No I/O** — roster is passed in; STT confidence is folded in by the application service (combined = `round(0.5*sttConfidence + 0.5*matchConfidence)`).

---

## Use Cases (CQS)

### Commands (state-changing)
| # | Use case | Type | Notes |
|---|----------|------|-------|
| C1 | `UpsertLanguagePreference` | Command | Upsert by `userId`; also syncs `users.preferred_language`. Auth: self only. |
| C2 | `UpsertMessageTemplate` | Command | Upsert by `(vendorId, type, language)`; owner only. P2002 → ConflictError. |
| C3 | `TranscribeVoiceCommand` | Command | Calls STT port → interpreter → writes `VoiceCommandLog` (wasExecuted=false). Returns transcription + interpretation. Side-effect = log row, hence Command. |
| C4 | `ExecuteVoiceCommand` | Command | Validates intent, resolves daily-supply id(s), delegates to Delivery port, writes/updates `VoiceCommandLog` (wasExecuted=true/result). |

### Queries (read-only)
| # | Use case | Type | Notes |
|---|----------|------|-------|
| Q1 | `GetLanguagePreference` | Query | Returns prefs (defaults if absent). Self only. |
| Q2 | `ListMessageTemplates` | Query | Filter by `templateType`, `languageCode`. Owner only. |
| Q3 | `GetMessageTemplate` | Query | By id, tenant-scoped. |
| Q4 | `PreviewMessageTemplate` | Query | Render with sample/supplied data; returns text + unresolved placeholders. No persistence. |

> `MessageTemplateRenderer` (the `render` on the entity + `BillLanguagePolicy.resolve`) is exposed as a small public service so Billing/Reminder modules can render in the right language. It is a **read/pure** operation.

---

## Mapper Design

### language-preference.mapper.ts
- `toPersistence(entity)` → `{ userId, primaryLanguage: appLanguage.value, secondaryLanguage, enableVoiceCommands, enableVoiceResponses, transliterationEnabled, billLanguageDefault: policy.value, preferredVoiceAccent }`.
- `toDomain(row)` → reconstitutes VOs from columns.
- `toResponse(entity)` → **whitelist**: `{ appLanguage, secondaryLanguage, voiceCommandsEnabled, voiceResponsesEnabled, transliterationEnabled, billLanguageDefault, preferredVoiceAccent }`. (Never returns `userId`/`id`.)

### message-template.mapper.ts
- `toPersistence(entity)` → `{ vendorId, templateType, languageCode: language.value, templateText: body.raw, isActive }` (maps to `template_key`+`language` per existing SQL via composite — see schema note).
- `toDomain(row)`.
- `toResponse(entity)` → `{ id, templateType, languageCode, content, isActive, placeholders, createdAt, updatedAt }`.

### voice-command-log.mapper.ts
- `toPersistence` only (INSERT). `toResponse` for analytics queries (out of scope for FE here).

---

## Anti-Corruption Layer & Strategy

### Strategy: ISpeechToTextPort  (`voice/ports/speech-to-text.port.ts`)
```
interface ISpeechToTextPort {
  readonly id: 'google' | 'bhashini' | 'stub';
  transcribe(args: { audioBase64: string; locale: string }): Promise<{ transcription: string; confidence: number }>; // confidence 0..100
}
```
- Implementations (`voice/adapters/`): `GoogleSpeechAdapter`, `BhashiniSpeechAdapter`, `StubSpeechAdapter` (deterministic, used in tests + when no provider key is configured).
- Selection at composition root via env (`SPEECH_PROVIDER`, default `stub`). Errors from the provider are translated to `SpeechProviderError` (a 502) — external error types never leak.

### ACL: ICustomerLookupPort (`voice/ports/customer-lookup.port.ts`)
```
listRosterForList(vendorId, supplyListId, serviceDate): Promise<{ id: bigint; name: string }[]>
getCustomer(customerId, vendorId): Promise<{ id: bigint; name: string } | null>
```
Adapter reads `supply_list_customers` + `customers` (and/or `daily_supplies`) scoped by vendor.

### ACL: IDeliveryActionPort (`voice/ports/delivery-action.port.ts`)
```
resolveDeliveryId(vendorId, supplyListId, customerId, serviceDate): Promise<bigint | null>
markDelivery(ctx, deliveryId, status: 'DELIVERED'|'LEAVE', meta): Promise<void>
markAllPending(ctx, supplyListId, serviceDate, meta): Promise<{ markedCount: number }>
```
Adapter wraps the existing `MarkDeliveryCommand` / `MarkBulkDeliveryCommand`, so all delivery invariants and RBAC (`assertListPermission`) are reused — voice is just another caller. **This keeps the Delivery aggregate the single writer of delivery state.**

---

## Module Structure (Complex layout — `commands/` + `queries/` mandatory)

```
src/modules/voice/
├── domain/
│   ├── language-preference.entity.ts
│   ├── message-template.entity.ts
│   ├── voice-command-log.entity.ts
│   ├── voice-command-interpreter.ts        # domain service (pure)
│   ├── intent-patterns.ts                   # per-language regex tables
│   ├── voice.types.ts                       # enums: SupportedLanguageCode, TemplateType, VoiceIntentAction, BillLanguagePolicyValue
│   ├── voice.errors.ts
│   └── value-objects/
│       ├── supported-language.vo.ts
│       ├── bill-language-policy.vo.ts
│       ├── template-type.vo.ts
│       ├── template-body.vo.ts
│       ├── voice-intent.vo.ts
│       └── confidence-score.vo.ts
├── commands/
│   ├── upsert-language-preference/upsert-language-preference.command.ts
│   ├── upsert-message-template/upsert-message-template.command.ts
│   ├── transcribe-voice-command/transcribe-voice-command.command.ts
│   └── execute-voice-command/execute-voice-command.command.ts
├── queries/
│   ├── get-language-preference/get-language-preference.query.ts
│   ├── list-message-templates/list-message-templates.query.ts
│   ├── get-message-template/get-message-template.query.ts
│   └── preview-message-template/preview-message-template.query.ts
├── database/
│   ├── language-preference.repository.port.ts
│   ├── language-preference.repository.ts
│   ├── message-template.repository.port.ts
│   ├── message-template.repository.ts
│   ├── voice-command-log.repository.port.ts
│   └── voice-command-log.repository.ts
├── ports/
│   ├── speech-to-text.port.ts
│   ├── customer-lookup.port.ts
│   └── delivery-action.port.ts
├── adapters/
│   ├── google-speech.adapter.ts
│   ├── bhashini-speech.adapter.ts
│   ├── stub-speech.adapter.ts
│   ├── customer-lookup.adapter.ts
│   └── delivery-action.adapter.ts
├── language-preference.mapper.ts
├── message-template.mapper.ts
├── voice-command-log.mapper.ts
├── voice.renderer.ts                        # public MessageTemplateRenderer facade
├── voice.types.ts                           # shared DTOs
├── voice.validator.ts                       # Zod schemas
├── voice.controller.ts
├── voice.routes.ts                          # composition root
└── __tests__/
```
