# API Spec: US-010 Dashboard (Owner & Staff)

Authoritative REST contract for the frontend. Self-contained — all types are plain JSON.
Base URL: `/api/v1`. All responses are JSON. All IDs are **strings** (serialized BigInt).
All money amounts are **whole-rupee integers** (INR). All dates are ISO strings unless noted.

## Conventions

- **Auth**: every endpoint requires `Authorization: Bearer <accessToken>`.
- **Success envelope**: `{ "success": true, "data": <payload>, "meta"?: <pagination> }`.
- **Error envelope**:
  ```json
  { "success": false,
    "error": { "code": "STRING", "message": "STRING", "correlationId": "STRING", "details": null } }
  ```
- **Common error codes**: `UNAUTHORIZED` (401, missing/invalid token), `FORBIDDEN` (403, wrong role),
  `NOT_FOUND` (404, not a member of this vendor / resource absent), `VALIDATION_ERROR` (400),
  `TOO_MANY_REQUESTS` (429).
- **Roles**: `owner` and `staff`. Endpoints marked **Owner only** return `403 FORBIDDEN` to staff.
- **Tenant isolation**: if the caller is not an active member of `:vendorId`, every endpoint returns
  `404 NOT_FOUND` (existence is never revealed).
- **Permissions** (server-enforced): `dashboard:read`, `vendor-settings:read`, `vendor-settings:update`,
  `staff-dashboard:read`.

---

## 1. GET `/api/v1/vendors/{vendorId}/dashboard/owner`  — Owner only

Aggregated home screen for the vendor owner.

**Permission**: `dashboard:read` · **Role**: owner

**Path params**: `vendorId` (string, numeric)
**Query params**:
| Name | Type | Required | Default | Notes |
|------|------|----------|---------|-------|
| `month` | string `YYYY-MM` | no | current month | financial window |

**200 Response** (`data`):
```json
{
  "currentMonth": "2026-04",
  "financial": {
    "totalRevenue": 78600,
    "collected": 65200,
    "pending": 13400,
    "collectionPercentage": 83,
    "outstandingAging": {
      "fresh_0_30":      { "amount": 8400, "customerCount": 12 },
      "overdue_30_60":   { "amount": 3800, "customerCount": 5 },
      "critical_60_plus":{ "amount": 1200, "customerCount": 2 }
    },
    "advanceCredit": 12500,
    "netReceivable": 32700
  },
  "quickStats": {
    "supplyListsCount": 5,
    "totalCustomers": 127,
    "activeStaff": 3,
    "conflictsToday": 2
  },
  "autoMarkStatus": "on",
  "supplyForecast": {
    "tomorrow": [
      { "listName": "Morning Milk", "quantity": 85, "unit": "ltr", "customerCount": 45 }
    ],
    "next7Days": {
      "totalBySupplyType": {
        "milk":  { "quantity": 850, "unit": "ltr" },
        "bread": { "quantity": 420, "unit": "pieces" }
      }
    }
  },
  "todaySupplyLists": [
    {
      "id": "10",
      "name": "Morning Milk",
      "startTime": "06:00",
      "staffName": "Raju",
      "progress": { "completed": 45, "total": 52, "percentage": 87 },
      "status": "in_progress"
    }
  ]
}
```

**Field notes**
- `autoMarkStatus`: `"on"` | `"off"` (mirrors vendor settings `autoMarkEnabled`).
- `todaySupplyLists[].status`: `"not_started"` | `"in_progress"` | `"completed"`.
- `todaySupplyLists[].staffName`: string or `null` (primary assigned staff).
- `collectionPercentage`: integer 0–100; `0` when `totalRevenue` is 0.

**Errors**: 401, 403 (staff), 404 (not a member), 400 (bad `month`).

---

## 2. GET `/api/v1/vendors/{vendorId}/dashboard/staff/{staffId}`

Staff member's daily work view. **Contains NO financial data.**

**Permission**: `staff-dashboard:read` · **Role**: owner (any staff) OR the staff member (self only)

**Path params**: `vendorId` (string), `staffId` (string) — `staffId` is the staff membership id.
**Authorization**: a `staff` caller may only request **their own** `staffId`; requesting another
staff's id returns `403 FORBIDDEN`. An owner may request any `staffId` in the vendor. A `staffId`
that does not belong to the vendor returns `404 NOT_FOUND`.

**200 Response** (`data`):
```json
{
  "date": "2026-04-12",
  "staffName": "Raju",
  "todayProgress": { "totalDeliveries": 82, "completed": 73, "percentage": 89 },
  "assignedLists": [
    {
      "id": "10",
      "name": "Morning Milk",
      "startTime": "06:00",
      "progress": { "completed": 45, "total": 52, "percentage": 87 },
      "status": "in_progress"
    }
  ],
  "pendingCount": 9
}
```

**Field notes**
- `date`: server date `YYYY-MM-DD`.
- `assignedLists[].status`: `"not_started"` | `"in_progress"` | `"completed"`.
- No revenue, amounts, rates, or pricing fields are ever present.

**Errors**: 401, 403 (staff viewing another staff), 404 (not a member / unknown staffId).

---

## 3. GET `/api/v1/vendors/{vendorId}/supply-forecast`  — Owner only

Procurement-planning forecast.

**Permission**: `dashboard:read` · **Role**: owner

**Query params**:
| Name | Type | Required | Default | Notes |
|------|------|----------|---------|-------|
| `date` | string `YYYY-MM-DD` | no | tomorrow | primary forecast date |
| `days` | integer 1–30 | no | 7 | window size for `nextNDays` |
| `supplyType` | string | no | — | filter to one supply type |

**200 Response** (`data`):
```json
{
  "date": "2026-04-13",
  "byList": [
    {
      "listId": "10",
      "listName": "Morning Milk",
      "supplyType": "milk",
      "quantity": 85,
      "unit": "ltr",
      "customerCount": 45,
      "plannedLeaves": 3
    }
  ],
  "aggregatedByType": {
    "milk":  { "totalQuantity": 161, "unit": "ltr",    "lists": ["Morning Milk", "Evening Milk"] },
    "bread": { "totalQuantity": 60,  "unit": "pieces", "lists": ["Morning Bread"] }
  },
  "nextNDays": {
    "days": 7,
    "byType": {
      "milk":  { "totalQuantity": 850, "unit": "ltr",    "dailyAverage": 121 },
      "bread": { "totalQuantity": 420, "unit": "pieces", "dailyAverage": 60 }
    }
  }
}
```

**Field notes**
- `byList` / `aggregatedByType` describe the single `date`. `nextNDays` covers `date` through `date + days - 1`.
- `quantity` already excludes customers on planned leave; `plannedLeaves` is the count of subscribers on leave.
- Empty arrays/objects when there are no active subscriptions (not an error).

**Errors**: 401, 403 (staff), 404, 400 (bad `date`/`days`).

---

## 4. GET `/api/v1/vendors/{vendorId}/outstanding-aging`  — Owner only

Collections / aging analysis.

**Permission**: `dashboard:read` · **Role**: owner

**Query params**:
| Name | Type | Required | Default | Notes |
|------|------|----------|---------|-------|
| `priority` | `high`\|`medium`\|`low`\|`all` | no | `all` | filter priorityCustomers |
| `page` | integer ≥1 | no | 1 | paginate priorityCustomers |
| `limit` | integer 1–100 | no | 20 | page size |

**200 Response** (`data`):
```json
{
  "summary": {
    "totalOutstanding": 45200,
    "fresh_0_30":      { "amount": 28400, "customerCount": 15 },
    "overdue_30_60":   { "amount": 11800, "customerCount": 8 },
    "critical_60_plus":{ "amount": 5000,  "customerCount": 3 }
  },
  "priorityCustomers": {
    "high": [
      {
        "customerId": "10",
        "customerName": "Sharma Family",
        "outstanding": 5000,
        "daysOverdue": 78,
        "creditLimit": 5000,
        "utilizationPercentage": 100,
        "lastPaymentDate": "2025-11-15",
        "paymentScore": 45
      }
    ],
    "medium": [],
    "low": []
  },
  "advanceCredit": {
    "totalAmount": 12500,
    "customerCount": 6,
    "customers": [
      { "customerId": "11", "customerName": "Verma Family", "creditBalance": -2500, "monthsCovered": 2 }
    ]
  }
}
```

**Field notes**
- `lastPaymentDate`: `YYYY-MM-DD` or `null`. `paymentScore`: number 0–100.
- `utilizationPercentage`: integer; `0` when `creditLimit` is 0.
- `creditBalance` in advanceCredit is **negative** (credit held).
- `meta` (pagination) accompanies the response for the `priorityCustomers` grouping.

**Errors**: 401, 403 (staff), 404, 400.

---

## 5. GET `/api/v1/vendors/{vendorId}/settings`  — Owner only

Read vendor automation settings. Returns defaults (lazily) if none saved yet.

**Permission**: `vendor-settings:read` · **Role**: owner

**200 Response** (`data`):
```json
{
  "id": "1",
  "vendorId": "1",
  "autoMarkEnabled": true,
  "autoSendBillsEnabled": false,
  "autoSendBillsTime": "20:00",
  "notificationPreferences": {},
  "createdAt": "2026-04-01T10:00:00.000Z",
  "updatedAt": "2026-04-10T08:30:00.000Z"
}
```
**Errors**: 401, 403 (staff), 404.

---

## 6. PATCH `/api/v1/vendors/{vendorId}/settings`  — Owner only

Update vendor automation settings. Creates the settings row on first write.

**Permission**: `vendor-settings:update` · **Role**: owner

**Request body** (all fields optional; **at least one required**; unknown keys rejected):
```json
{
  "autoMarkEnabled": true,
  "autoSendBillsEnabled": false,
  "autoSendBillsTime": "20:00",
  "notificationPreferences": { "billReminders": true }
}
```
| Field | Type | Rules |
|-------|------|-------|
| `autoMarkEnabled` | boolean | — |
| `autoSendBillsEnabled` | boolean | — |
| `autoSendBillsTime` | string `"HH:mm"` | 24h, `00:00`–`23:59` |
| `notificationPreferences` | object | plain JSON object |

**200 Response** (`data`): same shape as `GET /settings` (the full updated settings object).

**Errors**:
| Status | Code | When |
|--------|------|------|
| 400 | `VALIDATION_ERROR` | empty body, unknown key, bad time format |
| 401 | `UNAUTHORIZED` | missing/invalid token |
| 403 | `FORBIDDEN` | caller is staff |
| 404 | `NOT_FOUND` | not a member of this vendor |

---

## Auto-refresh guidance (client)
- Owner dashboard: poll every 60s. Staff dashboard: poll every 30s.
- No WebSockets in this version; polling is the contract. The toggle in `PATCH /settings` may be applied
  optimistically on the client and reconciled with the 200 response.
