# API Specification — Credit Control & Outstanding Management
> Slug: us-012-credit-control | Generated: 2026-06-14

## Base URL
All endpoints are relative to: `/api/v1`

## Authentication
Bearer JWT required on **all** endpoints. All endpoints are **owner-only**
(vendor business owner). Staff tokens receive `403 FORBIDDEN`.
Permissions (RBAC enforced server-side):
- Read endpoints: `credit:read`
- Write endpoints: `credit:write`

## Conventions
- IDs are strings (e.g. `"10"`).
- Money values are numbers (rupees, 2-decimal precision).
- Dates are `YYYY-MM-DD` strings; months are `YYYY-MM` strings.
- A positive `currentBalance`/`outstanding` means the customer **owes** the vendor;
  a negative balance means the customer is **in advance/credit**.
- `creditType`: `"normal" | "prepaid" | "unlimited"`.
- `actionOnBreach`: `"warn" | "pause" | "block"`.

---

## Endpoints

### GET /api/v1/vendors/{vendorId}/collections/dashboard
**Purpose**: Outstanding overview, advance credit, net receivable, this-month progress, and customers at/near their credit limit.
**Auth**: required
**Permissions**: `credit:read`

**Response 200**:
```json
{
  "success": true,
  "data": {
    "outstandingOverview": {
      "totalOutstanding": "number",
      "fresh_0_30": { "amount": "number", "customerCount": "number" },
      "overdue_30_60": { "amount": "number", "customerCount": "number" },
      "critical_60_plus": { "amount": "number", "customerCount": "number" }
    },
    "advanceCredit": { "totalAmount": "number", "customerCount": "number" },
    "netReceivable": "number",
    "thisMonthProgress": {
      "totalBilled": "number",
      "collected": "number",
      "percentage": "number",
      "target": "number",
      "gap": "number"
    },
    "customersAtLimit": [
      { "customerId": "string", "name": "string", "utilizationPercentage": "number" }
    ]
  }
}
```

**Error responses**:
| Status | Code | When |
|--------|------|------|
| 401 | UNAUTHORIZED | Missing/invalid token |
| 403 | FORBIDDEN | Not the vendor owner |
| 404 | NOT_FOUND | Vendor not found / not yours |

---

### GET /api/v1/vendors/{vendorId}/collections/priority-list
**Purpose**: Customers grouped by collection priority, plus a separate advance-credit group.
**Auth**: required
**Permissions**: `credit:read`

**Query params**:
- `sort` (optional): one of `oldest_first` (default) | `amount_desc` | `utilization_desc` | `score_asc`.

**Response 200**:
```json
{
  "success": true,
  "data": {
    "highPriority": [
      {
        "customerId": "string",
        "customerName": "string",
        "phoneNumber": "string",
        "outstanding": "number",
        "daysOverdue": "number",
        "creditLimit": "number",
        "utilizationPercentage": "number",
        "lastPaymentDate": "string | null",
        "paymentScore": "number",
        "creditType": "string"
      }
    ],
    "mediumPriority": [],
    "lowPriority": [],
    "advanceCredit": [
      {
        "customerId": "string",
        "customerName": "string",
        "creditBalance": "number",
        "monthsCovered": "number"
      }
    ]
  }
}
```
> `daysOverdue` is a true integer (may exceed 365; the UI may display "365+").

**Error responses**:
| Status | Code | When |
|--------|------|------|
| 400 | VALIDATION_ERROR | Invalid `sort` value |
| 403 | FORBIDDEN | Not the vendor owner |
| 404 | NOT_FOUND | Vendor not found / not yours |

---

### GET /api/v1/vendors/{vendorId}/collections/analytics
**Purpose**: Monthly collection analytics: summary, payment-mode breakdown, 6-month trend, top payers, defaulters.
**Auth**: required
**Permissions**: `credit:read`

**Query params**:
- `month` (optional, default = current month): `YYYY-MM`.

**Response 200**:
```json
{
  "success": true,
  "data": {
    "month": "string",
    "monthlySummary": {
      "totalBilled": "number",
      "collected": "number",
      "outstanding": "number",
      "collectionPercentage": "number",
      "target": "number"
    },
    "paymentModeBreakdown": {
      "upi": { "amount": "number", "percentage": "number" },
      "cash": { "amount": "number", "percentage": "number" },
      "bank": { "amount": "number", "percentage": "number" },
      "online": { "amount": "number", "percentage": "number" },
      "other": { "amount": "number", "percentage": "number" }
    },
    "collectionTrend": [
      { "month": "string", "percentage": "number" }
    ],
    "topPayers": [
      { "customerId": "string", "customerName": "string", "amount": "number" }
    ],
    "defaulters": [
      { "customerId": "string", "customerName": "string", "amount": "number", "daysOverdue": "number" }
    ]
  }
}
```

**Error responses**:
| Status | Code | When |
|--------|------|------|
| 400 | VALIDATION_ERROR | `month` not `YYYY-MM` |
| 403 | FORBIDDEN | Not the vendor owner |
| 404 | NOT_FOUND | Vendor not found / not yours |

---

### GET /api/v1/vendors/{vendorId}/collections/aging
**Purpose**: Standalone outstanding aging breakdown (same buckets as the dashboard overview).
**Auth**: required
**Permissions**: `credit:read`

**Response 200**:
```json
{
  "success": true,
  "data": {
    "totalOutstanding": "number",
    "fresh_0_30": { "amount": "number", "customerCount": "number" },
    "overdue_30_60": { "amount": "number", "customerCount": "number" },
    "critical_60_plus": { "amount": "number", "customerCount": "number" }
  }
}
```

**Error responses**:
| Status | Code | When |
|--------|------|------|
| 403 | FORBIDDEN | Not the vendor owner |
| 404 | NOT_FOUND | Vendor not found / not yours |

---

### PATCH /api/v1/vendors/{vendorId}/customers/{customerId}/credit-settings
**Purpose**: Set a customer's credit policy (type, limit amount, warning threshold, breach action).
**Auth**: required
**Permissions**: `credit:write`

**Request body** (all fields optional; at least one required):
```json
{
  "creditType": "string",
  "creditLimit": "number",
  "warningThreshold": "number",
  "actionOnBreach": "string",
  "minimumBalanceWarning": "number"
}
```
- `creditType`: `"normal" | "prepaid" | "unlimited"`.
- `warningThreshold`: integer 0–100.
- `actionOnBreach`: `"warn" | "pause" | "block"`. Forced to `"warn"` when `creditType="unlimited"`.
- `minimumBalanceWarning`: only meaningful for `prepaid`.

**Response 200**:
```json
{
  "success": true,
  "data": {
    "customerId": "string",
    "creditType": "string",
    "creditLimit": "number",
    "warningThreshold": "number",
    "actionOnBreach": "string",
    "minimumBalanceWarning": "number | null",
    "currentBalance": "number",
    "creditUtilization": "number",
    "breached": "boolean",
    "deliveriesPaused": "boolean",
    "warning": "string | null"
  }
}
```
> `warning` is `"limit_below_outstanding"` when the new limit is below the current
> outstanding (the change is still applied). `deliveriesPaused` is `true` when a breach with
> `actionOnBreach="pause"|"block"` triggered an automatic pause.

**Error responses**:
| Status | Code | When |
|--------|------|------|
| 400 | VALIDATION_ERROR | Invalid input |
| 400 | ARGUMENT_INVALID | Threshold out of range / illegal combination |
| 403 | FORBIDDEN | Not the vendor owner |
| 404 | NOT_FOUND | Customer not found / not this vendor's |

---

### POST /api/v1/vendors/{vendorId}/customers/{customerId}/enable-prepaid
**Purpose**: Switch a customer to prepaid mode, optionally requiring outstanding to be cleared first.
**Auth**: required
**Permissions**: `credit:write`

**Request body**:
```json
{
  "clearOutstandingFirst": "boolean",
  "minimumBalanceWarning": "number",
  "message": "string"
}
```
- `clearOutstandingFirst` (default `true`).
- `minimumBalanceWarning` (optional): low-balance alert threshold.
- `message` (optional): custom note sent to the customer.

**Response 200 — switched**:
```json
{
  "success": true,
  "data": {
    "customerId": "string",
    "creditType": "prepaid",
    "minimumBalanceWarning": "number | null",
    "clearOutstandingRequired": false
  }
}
```

**Response 200 — payment required first**:
```json
{
  "success": true,
  "data": {
    "customerId": "string",
    "creditType": "normal",
    "clearOutstandingRequired": true,
    "outstanding": "number"
  }
}
```
> When `clearOutstandingFirst=true` and the customer still owes money, the switch is **not**
> applied; collect payment, then call again.

**Error responses**:
| Status | Code | When |
|--------|------|------|
| 400 | VALIDATION_ERROR | Invalid input |
| 403 | FORBIDDEN | Not the vendor owner |
| 404 | NOT_FOUND | Customer not found / not this vendor's |
| 409 | CONFLICT | Customer is already prepaid |

---

### POST /api/v1/vendors/{vendorId}/customers/{customerId}/reminders
**Purpose**: Send a single payment reminder to one customer (the priority-list "Remind" action).
**Auth**: required
**Permissions**: `credit:write`

**Request body**:
```json
{ "customMessage": "string" }
```
- `customMessage` (optional).

**Response 201**:
```json
{
  "success": true,
  "data": {
    "reminderId": "string",
    "customerId": "string",
    "amountDue": "number",
    "sentVia": "string",
    "status": "string",
    "reminderDate": "string",
    "skipped": "boolean",
    "skipReason": "string | null"
  }
}
```
> `skipped=true` (with `skipReason` e.g. `"already_paid"` or `"duplicate_today"`) when the
> reminder was not sent; `status` is `"sent" | "delivered" | "failed"` otherwise.

**Error responses**:
| Status | Code | When |
|--------|------|------|
| 400 | VALIDATION_ERROR | Invalid input |
| 403 | FORBIDDEN | Not the vendor owner |
| 404 | NOT_FOUND | Customer not found / not this vendor's |
| 429 | TOO_MANY_REQUESTS | Rate limit exceeded |

---

### GET /api/v1/vendors/{vendorId}/customers/{customerId}/reminders
**Purpose**: Reminder history for one customer.
**Auth**: required
**Permissions**: `credit:read`

**Query params**: `?page=1&limit=20` (optional).

**Response 200**:
```json
{
  "success": true,
  "data": {
    "totalReminders": "number",
    "successRate": "number",
    "reminders": [
      {
        "id": "string",
        "amountDue": "number",
        "reminderDate": "string",
        "sentVia": "string",
        "status": "string",
        "responseType": "string | null",
        "responseAmount": "number | null"
      }
    ]
  },
  "meta": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 }
}
```

**Error responses**:
| Status | Code | When |
|--------|------|------|
| 403 | FORBIDDEN | Not the vendor owner |
| 404 | NOT_FOUND | Customer not found / not this vendor's |

---

### POST /api/v1/vendors/{vendorId}/reminders/send-bulk
**Purpose**: Send reminders to many customers at once.
**Auth**: required
**Permissions**: `credit:write`

**Request body**:
```json
{
  "target": "string",
  "customerIds": ["string"],
  "customMessage": "string"
}
```
- `target`: `"all_overdue"` to send to every customer with outstanding > 0, or `"selected"`
  to use `customerIds`.
- `customerIds`: required when `target="selected"`; ignored otherwise.
- `customMessage` (optional).

**Response 200**:
```json
{
  "success": true,
  "data": { "sent": "number", "skipped": "number", "failed": "number" }
}
```
> Customers already paid (balance ≤ 0), excluded in reminder config, inactive, or already
> reminded today are counted in `skipped`.

**Error responses**:
| Status | Code | When |
|--------|------|------|
| 400 | VALIDATION_ERROR | Invalid target / missing customerIds |
| 403 | FORBIDDEN | Not the vendor owner |
| 404 | NOT_FOUND | Vendor not found / not yours |
| 429 | TOO_MANY_REQUESTS | Rate limit exceeded |

---

### GET /api/v1/vendors/{vendorId}/reminder-config
**Purpose**: Get the vendor's automated-reminder configuration.
**Auth**: required
**Permissions**: `credit:read`

**Response 200**:
```json
{
  "success": true,
  "data": {
    "autoRemindersEnabled": "boolean",
    "schedule3Days": "boolean",
    "schedule15Days": "boolean",
    "schedule30Days": "boolean",
    "reminderTemplate": "string | null",
    "excludedCustomerIds": ["string"]
  }
}
```
> When no config has been saved yet, system defaults are returned
> (`autoRemindersEnabled=false`, all schedules `true`, `reminderTemplate=null`, empty exclusions).

**Error responses**:
| Status | Code | When |
|--------|------|------|
| 403 | FORBIDDEN | Not the vendor owner |
| 404 | NOT_FOUND | Vendor not found / not yours |

---

### PATCH /api/v1/vendors/{vendorId}/reminder-config
**Purpose**: Update the vendor's automated-reminder configuration.
**Auth**: required
**Permissions**: `credit:write`

**Request body** (all fields optional; at least one required):
```json
{
  "autoRemindersEnabled": "boolean",
  "schedule3Days": "boolean",
  "schedule15Days": "boolean",
  "schedule30Days": "boolean",
  "reminderTemplate": "string",
  "excludedCustomerIds": ["string"]
}
```
- `reminderTemplate` may use placeholders: `{customer_name}`, `{month}`, `{amount}`,
  `{upi_id}`, `{phone}`, `{vendor_name}`. Unknown placeholders are rejected.
- If `autoRemindersEnabled=true`, at least one `scheduleNDays` must be `true`.

**Response 200**:
```json
{
  "success": true,
  "data": {
    "autoRemindersEnabled": "boolean",
    "schedule3Days": "boolean",
    "schedule15Days": "boolean",
    "schedule30Days": "boolean",
    "reminderTemplate": "string | null",
    "excludedCustomerIds": ["string"]
  }
}
```

**Error responses**:
| Status | Code | When |
|--------|------|------|
| 400 | VALIDATION_ERROR | Invalid input |
| 400 | ARGUMENT_INVALID | Unknown template placeholder / auto on with no schedule |
| 403 | FORBIDDEN | Not the vendor owner |
| 404 | NOT_FOUND | Vendor not found / not yours |

---

## List / Pagination
List endpoints (reminder history) accept `?page=1&limit=20` and return a `meta` envelope:
```json
{ "success": true, "data": [], "meta": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 } }
```

## Error Envelope
All errors return:
```json
{
  "success": false,
  "error": {
    "code": "SNAKE_CASE_CODE",
    "message": "Human-readable message",
    "correlationId": "uuid"
  }
}
```
> Log `correlationId` on every error for debugging.
