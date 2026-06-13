# API Spec — US-011 Vendor Settings & Automation

> **This document is the authoritative REST contract for the frontend.** It is self-contained:
> plain JSON types only, no internal model/entity names. Field names here win over the wireframe
> sketches (see note in §Request field naming).

## Conventions

- **Base URL**: `/api/v1`
- **Auth**: every endpoint requires `Authorization: Bearer <accessToken>`.
- **Role**: every endpoint below is **owner-only**. A staff member receives `403`.
- **`vendorId`** in the path must match the caller's vendor; mismatch/non-member → `404`.
- **Content type**: `application/json`.
- **IDs** are returned as **strings** (large integers).
- **Timestamps** are ISO-8601 strings (e.g. `"2026-06-13T08:30:00.000Z"`).
- **Dates** (calendar) are `"YYYY-MM-DD"`. Server timezone for "today" is Asia/Kolkata.

### Success envelope
```json
{ "success": true, "data": { /* endpoint-specific */ } }
```

### Error envelope
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable message",
    "correlationId": "req-abc123",
    "details": null
  }
}
```

### Common error codes
| HTTP | code | When |
|------|------|------|
| 400 | `VALIDATION_ERROR` | Bad body/params, empty body, unknown fields, both/neither target mode |
| 401 | `UNAUTHORIZED` | Missing/invalid token |
| 403 | `FORBIDDEN` | Caller is staff, not owner |
| 404 | `NOT_FOUND` | Not a member of this vendor, or resource belongs to another vendor |
| 413 | `PAYLOAD_TOO_LARGE` | Too many target ids in one bulk request (max 500) |
| 422 | `UNPROCESSABLE` | Valid shape but business rule failed (e.g. date in the past) |
| 429 | `TOO_MANY_REQUESTS` | Write rate limit exceeded |

---

## 1. PATCH /vendors/{vendorId}/settings  (extended)

Update automation + default-credit + concurrency settings. Partial update — send only the
fields you want to change. Upserts on first call. At least one field is required.

**Request body** (all optional; `>= 1` required):
```json
{
  "autoMarkEnabled": true,
  "autoSendBillsEnabled": false,
  "autoSendBillsTime": "20:00",
  "defaultCreditLimit": 3000,
  "defaultCreditPeriodDays": 30,
  "bulkOperationConcurrencyLimit": 50,
  "notificationPreferences": { "channels": { "push": true } }
}
```

**Field rules**
| Field | Type | Rule |
|-------|------|------|
| `autoMarkEnabled` | boolean | — |
| `autoSendBillsEnabled` | boolean | — |
| `autoSendBillsTime` | string | `"HH:mm"`, 00:00–23:59 |
| `defaultCreditLimit` | number \| null | `>= 0`, max 2 decimals |
| `defaultCreditPeriodDays` | integer \| null | 1–365 |
| `bulkOperationConcurrencyLimit` | integer | 1–500 |
| `notificationPreferences` | object | plain JSON object, not an array |

> You may also update `notificationPreferences` here, but prefer endpoint **§2** when only
> changing preferences.

**Response 200**
```json
{
  "success": true,
  "data": {
    "id": "12",
    "vendorId": "5",
    "autoMarkEnabled": true,
    "autoSendBillsEnabled": false,
    "autoSendBillsTime": "20:00",
    "defaultCreditLimit": 3000,
    "defaultCreditPeriodDays": 30,
    "bulkOperationConcurrencyLimit": 50,
    "notificationPreferences": { "channels": { "push": true } },
    "createdAt": "2026-06-01T00:00:00.000Z",
    "updatedAt": "2026-06-13T08:30:00.000Z"
  }
}
```
**Errors**: 400 (empty body / unknown key / bad time / limit < 0 / period out of range),
401, 403, 404, 429.

---

## 2. PATCH /vendors/{vendorId}/notification-preferences

Replace the entire notification-preferences object. The object shape is free-form (frontend
owns the schema); the backend only requires a plain JSON object.

**Request body**
```json
{
  "notificationPreferences": {
    "channels": { "push": true, "whatsapp": true, "sms": false },
    "payment": { "paymentReceived": true, "outstandingAlert": true, "creditLimitBreach": true },
    "customer": { "customerMarkedLeave": true, "newCustomerJoined": true },
    "operations": { "lowStockAlert": true, "dailyDigest": false }
  }
}
```
- `notificationPreferences` is **required** and must be a plain object (not an array/primitive).
- The provided object **replaces** the stored one (not a deep merge).

**Response 200**: full settings object (same shape as §1 response).

**Errors**: 400 (missing field / array / primitive), 401, 403, 404, 429.

---

## 3. POST /vendors/{vendorId}/bulk-operations/mark-leave

Mark leave for a set of subscriptions on a given date.

**Request body**
```json
{
  "subscriptionIds": ["10", "11"],
  "all": false,
  "date": "2026-06-20",
  "reason": "Festival holiday"
}
```
| Field | Type | Rule |
|-------|------|------|
| `subscriptionIds` | string[] | 1–500 ids; provide **either** this **or** `all:true` |
| `all` | boolean | `true` = every active subscription for the vendor |
| `date` | string | `"YYYY-MM-DD"`, **today or future** |
| `reason` | string | optional, max 500 chars |

Targeting rule: send exactly one of `subscriptionIds` (non-empty) **or** `all: true`.
Sending both or neither → 400. Subscription ids not belonging to this vendor are silently
skipped (not an error). Subscriptions already on covering leave for `date` are skipped.

**Response 200** (synchronous — completed):
```json
{
  "success": true,
  "data": {
    "operationId": "101",
    "status": "COMPLETED",
    "summary": {
      "customersAffected": 52,
      "days": 1,
      "totalLeaves": 52,
      "skipped": 3,
      "revenueImpact": -2600
    }
  }
}
```
**Response 202** (large set — processing asynchronously):
```json
{
  "success": true,
  "data": { "operationId": "101", "status": "IN_PROGRESS" }
}
```
> When you receive `202`, poll **§6 GET /bulk-operations/{operationId}** until `status` is
> `COMPLETED` or `FAILED`.

**Errors**: 400 (both/neither target, bad date format), 401, 403, 404,
413 (> 500 ids), 422 (date in the past), 429.

---

## 4. POST /vendors/{vendorId}/bulk-operations/adjust-rate

Change the per-unit rate for the chosen subscriptions, effective from a date. Subscriptions
that have a **custom rate** are not changed (and are reported as `skipped`). The change is
forward-only — past deliveries and bills are never rewritten.

**Request body**
```json
{
  "subscriptionIds": ["10", "11"],
  "all": false,
  "newRate": 55,
  "effectiveDate": "2026-07-01",
  "notifyCustomers": true
}
```
| Field | Type | Rule |
|-------|------|------|
| `subscriptionIds` | string[] | 1–500 ids; **either** this **or** `all:true` |
| `all` | boolean | `true` = all of the vendor's subscriptions |
| `newRate` | number | `>= 0` (0 allowed — free supply), max 2 decimals |
| `effectiveDate` | string | `"YYYY-MM-DD"`, today or future |
| `notifyCustomers` | boolean | optional, default `false`; sends a WhatsApp/text notice |

**Response 200**
```json
{
  "success": true,
  "data": {
    "operationId": "102",
    "status": "COMPLETED",
    "summary": {
      "listsAffected": 2,
      "customersAffected": 88,
      "skipped": 2,
      "rateChange": 5,
      "monthlyImpact": 13200,
      "notified": 88
    }
  }
}
```
(`202` async form identical to §3.)

**Errors**: 400 (both/neither target, bad rate/date), 401, 403, 404, 413, 422 (past effectiveDate), 429.

---

## 5. POST /vendors/{vendorId}/bulk-operations/send-reminders

Send payment reminders to customers.

**Request body**
```json
{
  "customerIds": ["10", "11"],
  "all": false,
  "messageTemplate": "Hi {name}, your pending amount is Rs {amount}. Please pay soon."
}
```
| Field | Type | Rule |
|-------|------|------|
| `customerIds` | string[] | 1–500 ids; **either** this **or** `all:true` |
| `all` | boolean | `true` = all customers of the vendor with an outstanding balance |
| `messageTemplate` | string | optional, max 1000 chars; if omitted a default reminder is used |

**Response 200**
```json
{
  "success": true,
  "data": {
    "operationId": "103",
    "status": "COMPLETED",
    "summary": { "totalSent": 25, "delivered": 23, "failed": 2 }
  }
}
```
(`202` async form identical to §3.)

**Errors**: 400 (both/neither target), 401, 403, 404, 413, 429.

---

## 6. GET /vendors/{vendorId}/bulk-operations/{operationId}

Poll the status of a previously triggered bulk operation (use after a `202`, or to show
history). An operation that belongs to a different vendor returns `404`.

**Path params**: `vendorId` (string), `operationId` (string).

**Response 200**
```json
{
  "success": true,
  "data": {
    "operationId": "101",
    "operationType": "MARK_LEAVE",
    "targetType": "SUBSCRIPTION",
    "status": "COMPLETED",
    "affectedCount": 52,
    "summary": {
      "customersAffected": 52,
      "days": 1,
      "totalLeaves": 52,
      "skipped": 3,
      "revenueImpact": -2600
    },
    "errorMessage": null,
    "startedAt": "2026-06-13T08:30:01.000Z",
    "completedAt": "2026-06-13T08:30:03.000Z",
    "createdAt": "2026-06-13T08:30:01.000Z"
  }
}
```
- `operationType`: `"MARK_LEAVE" | "ADJUST_RATE" | "SEND_REMINDERS"`
- `targetType`: `"ALL" | "SUBSCRIPTION" | "CUSTOMER"`
- `status`: `"PENDING" | "IN_PROGRESS" | "COMPLETED" | "FAILED"`
- `summary`: present once work has run; shape depends on `operationType` (see §3/§4/§5).
- `errorMessage`: populated only when `status === "FAILED"`.

**Errors**: 401, 403 (staff), 404 (unknown id or other vendor), 429.

---

## Notes for the frontend architect

- **Request field naming**: this spec uses `subscriptionIds` / `customerIds` / `newRate` /
  `effectiveDate` / `messageTemplate` / `all`. The wireframe sketches (single-list selectors,
  `scope`, `effectiveFrom`, `reason`) are UI conveniences — map them onto the fields above.
  `reason` is supported on mark-leave; richer scope options are not in v1.
- **Async handling**: any bulk endpoint may return `202` instead of `200` for large target
  sets. Treat `202` as "accepted, poll §6". The threshold is the vendor's
  `bulkOperationConcurrencyLimit` setting (default 50).
- **Impact preview**: there is no separate impact-preview endpoint in v1. The impact numbers
  are returned in the `summary` of the completed operation. (A pre-submit preview endpoint may
  be added later — see FEATURE_PLAN OQ-5.)
- **Auto-mark / auto-send-bills** are backend-only behaviors driven by the §1 settings; no
  frontend endpoint beyond the settings PATCH.
