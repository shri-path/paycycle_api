# API Spec: US-013 — Multi-Language & Voice Interface

> Authoritative REST contract for the **Vendor** frontend. Self-contained: all types are plain JSON.
> Base URL: `/api/v1`. All responses use the common envelope below.

## Conventions

### Auth
- Every endpoint requires `Authorization: Bearer <accessToken>`.
- **Self-scoped** endpoints (language preferences) require the path `:userId` to equal the authenticated user.
- **Owner-only** endpoints (message templates) require the caller to be the vendor **owner** of `:vendorId`.
- **Voice** endpoints require an authenticated vendor user (owner or staff) with delivery-marking access on the target supply list (the existing list permission `mark_deliveries` / `mark_leaves` is enforced server-side).

### Success envelope
```json
{ "success": true, "data": { /* endpoint payload */ }, "meta": { "correlationId": "uuid" } }
```

### Error envelope
```json
{
  "success": false,
  "error": { "code": "STRING_CODE", "message": "Human readable", "details": [] },
  "meta": { "correlationId": "uuid" }
}
```

### Common status codes
| Status | When |
|--------|------|
| 200 | Successful read / update |
| 201 | Resource created (first-time upsert) |
| 400 | Validation error (`VALIDATION_ERROR`) |
| 401 | Missing/invalid token (`UNAUTHORIZED`) |
| 403 | Authenticated but not allowed (`FORBIDDEN`) |
| 404 | Resource not found / wrong tenant (`NOT_FOUND`) |
| 409 | Conflict, e.g. duplicate template, illegal state (`CONFLICT`) |
| 422 | Voice command could not be interpreted/executed (`UNPROCESSABLE`) |
| 429 | Rate limited (`TOO_MANY_REQUESTS`) |
| 502 | Speech provider failure (`SPEECH_PROVIDER_ERROR`) |

### Enumerations
- `languageCode` (and `appLanguage`, `secondaryLanguage`): `"en" | "hi" | "ta" | "te" | "mr" | "bn" | "kn" | "ml" | "gu"`.
- `billLanguageDefault`: `"customer" | "my_language" | "english"`.
- `templateType`: `"payment_reminder" | "monthly_bill" | "delivery_confirmation" | "leave_confirmation"`.
- `voiceAction`: `"mark_delivered" | "mark_leave" | "mark_all" | "adjust_quantity" | "unknown"`.

---

## 1. Language Preferences

### 1.1 GET `/users/{userId}/language-preferences`
Get the caller's language/voice settings. Returns defaults if the user has never saved any.

- **Auth**: self only.
- **200 Response `data`**:
```json
{
  "appLanguage": "hi",
  "secondaryLanguage": null,
  "voiceCommandsEnabled": true,
  "voiceResponsesEnabled": false,
  "transliterationEnabled": true,
  "billLanguageDefault": "customer",
  "preferredVoiceAccent": null
}
```
- **Errors**: 401, 403 (userId ≠ self).

### 1.2 PATCH `/users/{userId}/language-preferences`
Create or update (upsert) the caller's preferences. All body fields optional; only supplied fields change.

- **Auth**: self only.
- **Request body**:
```json
{
  "appLanguage": "hi",
  "secondaryLanguage": "en",
  "voiceCommandsEnabled": true,
  "voiceResponsesEnabled": false,
  "transliterationEnabled": true,
  "billLanguageDefault": "my_language",
  "preferredVoiceAccent": "IN-HI"
}
```
- **Rules**:
  - `secondaryLanguage` must differ from `appLanguage` (else 400).
  - If `appLanguage` is `"en"`, the server forces `transliterationEnabled` to `false` (English has no separate script).
- **200 Response `data`**: the full preferences object (same shape as 1.1).
- **Errors**: 400 (`VALIDATION_ERROR`), 401, 403.

---

## 2. Message Templates  (owner only)

### 2.1 GET `/vendors/{vendorId}/message-templates`
List the vendor's saved templates, optionally filtered.

- **Auth**: owner of `vendorId`.
- **Query params**: `templateType` (optional enum), `languageCode` (optional enum).
- **200 Response `data`**:
```json
{
  "templates": [
    {
      "id": "10",
      "templateType": "payment_reminder",
      "languageCode": "hi",
      "content": "नमस्ते {{customer_name}}, आपका {{month}} का बिल ₹{{amount}} बाकी है।",
      "placeholders": ["customer_name", "month", "amount"],
      "isActive": true,
      "createdAt": "2026-06-14T10:00:00.000Z",
      "updatedAt": "2026-06-14T10:00:00.000Z"
    }
  ]
}
```
- **Notes**: `id` is a string. Placeholders use `{{token}}` syntax. If no template exists for a (type, language), it simply isn't returned — the frontend should fall back to a built-in default and let the owner create one via 2.2.
- **Errors**: 401, 403, 404 (wrong tenant).

### 2.2 PUT `/vendors/{vendorId}/message-templates`
Create or update the template for a `(templateType, languageCode)` pair (upsert).

- **Auth**: owner of `vendorId`.
- **Request body**:
```json
{
  "templateType": "payment_reminder",
  "languageCode": "hi",
  "content": "नमस्ते {{customer_name}}, आपका {{month}} का बिल ₹{{amount}} बाकी है। - {{vendor_name}}"
}
```
- **Rules**:
  - `content`: 1–2000 chars.
  - Every `{{placeholder}}` must be allowed for the `templateType` (see allowed list below) — unknown placeholder → 400 `INVALID_PLACEHOLDER` with the offending token in `details`.
- **Allowed placeholders per type**:
  | templateType | allowed placeholders |
  |--------------|----------------------|
  | payment_reminder | customer_name, month, amount, upi_id, phone, vendor_name, due_date |
  | monthly_bill | customer_name, month, total_due, items, upi_id, phone, vendor_name |
  | delivery_confirmation | customer_name, item, quantity, date, vendor_name |
  | leave_confirmation | customer_name, from_date, to_date, vendor_name |
- **Responses**: `201` on first create, `200` on update; `data` = the saved template object (same shape as 2.1 list item).
- **Errors**: 400 (`VALIDATION_ERROR`/`INVALID_PLACEHOLDER`), 401, 403, 404.

### 2.3 POST `/vendors/{vendorId}/message-templates/preview`
Render a template with sample or supplied data without saving. Used by the editor's "Preview".

- **Auth**: owner of `vendorId`.
- **Request body**:
```json
{
  "templateType": "payment_reminder",
  "languageCode": "hi",
  "content": "नमस्ते {{customer_name}}, ₹{{amount}} बाकी है।",
  "sampleData": { "customer_name": "शर्मा परिवार", "amount": "1200" }
}
```
- **Notes**: `content` optional — if omitted, the saved template for `(type, language)` is used (404 if none). `sampleData` optional — missing placeholders render as empty and are listed in `unresolved`.
- **200 Response `data`**:
```json
{ "preview": "नमस्ते शर्मा परिवार, ₹1200 बाकी है।", "unresolved": [] }
```
- **Errors**: 400, 401, 403, 404.

---

## 3. Voice Commands

### 3.1 POST `/voice/transcribe`
Send recorded audio; receive the transcription **and** the interpreted command. Does **not** change delivery state. A voice-command log row is written.

- **Auth**: authenticated vendor user with marking access on `supplyListId`.
- **Content type**: `application/json` (audio sent as base64). *(Multipart is not used to keep the contract uniform with the rest of the API; the frontend already reads the file as base64 — see US-013 FE notes.)*
- **Request body**:
```json
{
  "audioData": "<base64 LINEAR16/WAV audio>",
  "languageCode": "hi",
  "supplyListId": "10",
  "serviceDate": "2026-06-14"
}
```
- **Field rules**: `audioData` required non-empty; `languageCode` required enum; `supplyListId` required string id; `serviceDate` optional `YYYY-MM-DD`, defaults to today (server timezone).
- **200 Response `data`**:
```json
{
  "logId": "55",
  "transcription": "शर्मा जी को दूध दे दिया",
  "confidence": 95,
  "interpretation": {
    "action": "mark_delivered",
    "customerId": "10",
    "customerName": "Sharma Family",
    "quantity": null,
    "confidence": 95,
    "autoExecute": true,
    "candidates": []
  }
}
```
- **Interpretation semantics**:
  - `confidence` is 0–100. `autoExecute` is `true` when `confidence > 80`.
  - `action: "mark_all"` → no `customerId`.
  - Ambiguous name → `action` may still be set but `customerId` is `null` and `candidates` lists `{ "id": "12", "name": "Anil Kumar" }` objects for a disambiguation UI; `autoExecute` is `false`.
  - Unrecognised → `action: "unknown"`, `confidence: 0`, `customerId: null`.
- **Errors**: 400 (`VALIDATION_ERROR`), 401, 403, 404 (supply list not in tenant), 429, 502 (`SPEECH_PROVIDER_ERROR`).
- **Note**: A `502` still attempts to write a failed log row; the frontend should fall back to manual entry (Edge case 1 & 9).

### 3.2 POST `/voice/execute-command`
Execute a previously interpreted command (delegates to the delivery-marking logic). Use this when `autoExecute` was `false` (after user confirmation/disambiguation) or to re-run a stored interpretation.

- **Auth**: authenticated vendor user with marking access on `supplyListId`.
- **Request body**:
```json
{
  "interpretation": {
    "action": "mark_delivered",
    "customerId": "10",
    "quantity": null
  },
  "supplyListId": "10",
  "serviceDate": "2026-06-14",
  "logId": "55"
}
```
- **Field rules**:
  - `action` required enum (not `"unknown"`).
  - `customerId` required for `mark_delivered` / `mark_leave` / `adjust_quantity`; omitted for `mark_all`.
  - `quantity` required (> 0) for `adjust_quantity`; ignored otherwise.
  - `logId` optional — if supplied, that voice-command log row is updated with the execution result; otherwise a new one is written.
- **200 Response `data`** (single-customer actions):
```json
{
  "executed": true,
  "action": "mark_delivered",
  "customerId": "10",
  "customerName": "Sharma Family",
  "deliveryId": "987",
  "status": "DELIVERED"
}
```
- **200 Response `data`** (`mark_all`):
```json
{ "executed": true, "action": "mark_all", "markedCount": 7 }
```
- **Errors**:
  - 400 (`VALIDATION_ERROR`) — malformed interpretation.
  - 401 / 403 (no marking permission on the list).
  - 404 (`NOT_FOUND`) — customer not on this list for the date, or no pending delivery to mark.
  - 409 (`CONFLICT`) — delivery already in the requested state.
  - 422 (`UNPROCESSABLE`) — `action: "unknown"` or unresolved customer.
  - 429.

---

## 4. Bill / message language resolution (informational, no new endpoint)

Bill and reminder generation (US-009/US-012 endpoints) will pick the language using the owner's `billLanguageDefault`:
- `customer` → the customer's `languagePreference`.
- `my_language` → the owner's `appLanguage`.
- `english` → always `en`.

No frontend change is required beyond letting the owner set the policy (endpoint 1.2). The rendered bill text is returned by the existing billing/reminder endpoints; this story only supplies the templates + resolution.

---

## Notes for the Frontend Architect
- UI string `.json` bundles (en/hi/ta/…) live in the **frontend** repo; the backend does **not** serve them. Only the user's chosen `appLanguage` is persisted via §1.
- The mic flow is: record → §3.1 transcribe → if `interpretation.autoExecute` then it is **not** auto-run server-side; the client decides. Recommended client logic: if `autoExecute === true` call §3.2 immediately; else show the confirmation/disambiguation dialog, then call §3.2.
- All IDs in requests and responses are **strings** (BigInt-safe).
