# API Specification — Customer Management
> Slug: customer-management | US-008 | Generated: 2026-06-12

This spec is the authoritative contract for the frontend. It reflects the **shipped**
backend (`paycycle_api/src/modules/customer/`, PR #10), reconciled against
`FEATURE_PLAN.md` and the actual `customer.types.ts` DTOs.

## Base URL
All endpoints are relative to: `/api/v1`

All customer endpoints are nested under a vendor:
`/api/v1/vendors/:vendorId/customers/...`

`vendorId` is sourced from the JWT `roleContext`; the URL param is verified against it.
A mismatch returns `403 FORBIDDEN`.

## Conventions
- **All IDs are strings** in requests and responses (BigInt serialized as string).
- All money/amount fields are plain `number` (INR, 2-decimal precision).
- Dates are `ISO8601` — `date` fields are `YYYY-MM-DD`, timestamps are full ISO datetimes.
- `month` path params use the format `YYYY-MM`.

## Authentication
Bearer JWT required on **all** endpoints. RBAC is enforced server-side.

- **Owner** — full access to every endpoint and every field.
- **Staff** — read-only, scoped to customers in their assigned supply lists. Staff can call
  only the list, detail, and calendar endpoints. **All financial fields are returned as `null`
  for staff** (`monthlyTotal`, `paymentStatus`, `currentBalance`, `paymentScore`, credit info,
  bill, payment history). All write endpoints and all money endpoints (bill, payments,
  credit-limit) are **Owner-only** → staff receives `403 FORBIDDEN`.

| Action | Permission |
|--------|------------|
| Read customers | `customer:read` |
| Create / update / deactivate customers, subscriptions | `customer:write` |
| Record payments, read bill/payments, set credit limit | `customer:write` (Owner only) |

---

## Endpoints

### GET /api/v1/vendors/:vendorId/customers
**Purpose**: List customers for the vendor with search, filter, and pagination.
**Auth**: required (Owner or Staff)
**Permissions**: `customer:read`

**Query params**:
| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `search` | string | — | Matches name or phone (contains, case-insensitive) |
| `listId` | string | — | Filter by supply-list membership |
| `status` | string | `all` | One of `all` \| `paid` \| `pending` \| `overdue` (payment status) |
| `page` | number | 1 | ≥ 1 |
| `limit` | number | 20 | 1–50 |

**Staff scope**: only customers subscribed to the staff member's assigned lists are returned.

**Response 200**:
```json
{
  "success": true,
  "data": {
    "total": 127,
    "customers": [
      {
        "id": "10",
        "name": "Anil Kumar",
        "phoneNumber": "+919876543210",
        "address": "Flat 402, Tower B",
        "area": "Sector 15",
        "customerSince": "2026-01-15",
        "status": "ACTIVE",
        "supplyLists": ["Morning Milk", "Evening Milk"],
        "monthlyTotal": 3550,
        "paymentStatus": "pending",
        "currentBalance": 4350,
        "paymentScore": 95
      }
    ]
  }
}
```
> `monthlyTotal`, `paymentStatus`, `currentBalance`, `paymentScore` are **owner-only** —
> staff receives `null` for each. `status` is uppercase (`ACTIVE` | `INACTIVE`);
> `paymentStatus` is lowercase (`paid` | `pending` | `overdue`).

**Error responses**:
| Status | Code | When |
|--------|------|------|
| 401 | UNAUTHORIZED | Missing/invalid token |
| 403 | FORBIDDEN | vendorId mismatch or missing permission |

---

### POST /api/v1/vendors/:vendorId/customers
**Purpose**: Create a customer and optionally enroll in supply lists.
**Auth**: required (Owner only)
**Permissions**: `customer:write`

**Request body**:
```json
{
  "name": "string",
  "phone": "string",
  "phoneCountryCode": "string",
  "email": "string",
  "address": "string",
  "area": "string",
  "language": "string",
  "supplyListIds": ["string"],
  "startDate": "YYYY-MM-DD",
  "creditLimit": "number",
  "sendInvite": "boolean"
}
```
Validation: `name` required (1–100 chars). `phone` required, exactly 10 digits (country code
separate, defaults `+91`). `email` optional, valid email. `supplyListIds` array of numeric-string
ids (optional, default `[]`). `creditLimit` ≥ 0, ≤ 9999999.99 (optional, default 0).
`sendInvite` optional (default false) — intent is logged only; **no WhatsApp invite is actually
sent** this iteration, so the frontend must not show an "invite sent" confirmation.

**Response 201**:
```json
{
  "success": true,
  "data": { "...": "CustomerDetailDto (see schema below)" }
}
```

**Error responses**:
| Status | Code | When |
|--------|------|------|
| 400 | VALIDATION_ERROR | Invalid input |
| 401 | UNAUTHORIZED | Missing/invalid token |
| 403 | FORBIDDEN | Not owner / vendor mismatch |
| 409 | CONFLICT | Duplicate phone within vendor |

---

### GET /api/v1/vendors/:vendorId/customers/:customerId
**Purpose**: Get full customer profile with subscriptions, current-month bill summary, and payment history.
**Auth**: required (Owner or Staff — staff only if customer is in an assigned list)
**Permissions**: `customer:read`

**Response 200**:
```json
{
  "success": true,
  "data": { "...": "CustomerDetailDto (see schema below)" }
}
```
> For staff, financial fields in `CustomerDetailDto` (`currentBalance`, `creditUtilization`,
> `currentMonthBill`, `paymentHistory`) are `null`/empty.

**Error responses**:
| Status | Code | When |
|--------|------|------|
| 401 | UNAUTHORIZED | Missing/invalid token |
| 403 | FORBIDDEN | Staff not assigned to this customer's list |
| 404 | NOT_FOUND | Customer not found for this vendor |

---

### PATCH /api/v1/vendors/:vendorId/customers/:customerId
**Purpose**: Update customer profile fields.
**Auth**: required (Owner only)
**Permissions**: `customer:write`

**Request body** (all fields optional):
```json
{
  "name": "string",
  "phone": "string",
  "email": "string",
  "address": "string",
  "area": "string",
  "language": "string",
  "status": "string"
}
```
`status` accepts `ACTIVE` | `INACTIVE`. Same per-field rules as create. Phone uniqueness is
re-checked if `phone` changes.

**Response 200**:
```json
{
  "success": true,
  "data": { "...": "CustomerDetailDto" }
}
```

**Error responses**:
| Status | Code | When |
|--------|------|------|
| 400 | VALIDATION_ERROR | Invalid input |
| 401 | UNAUTHORIZED | Missing/invalid token |
| 403 | FORBIDDEN | Not owner / vendor mismatch |
| 404 | NOT_FOUND | Customer not found |
| 409 | CONFLICT | Duplicate phone within vendor |

---

### DELETE /api/v1/vendors/:vendorId/customers/:customerId
**Purpose**: Soft-deactivate a customer (status → INACTIVE, deletedAt set, all active subscriptions ended).
**Auth**: required (Owner only)
**Permissions**: `customer:write`

**Response 200**:
```json
{ "success": true }
```

**Error responses**:
| Status | Code | When |
|--------|------|------|
| 401 | UNAUTHORIZED | Missing/invalid token |
| 403 | FORBIDDEN | Not owner / vendor mismatch |
| 404 | NOT_FOUND | Customer not found |
| 422 | UNPROCESSABLE_ENTITY | Customer already inactive |

---

### GET /api/v1/vendors/:vendorId/customers/:customerId/bill/:month
**Purpose**: Monthly bill breakdown for a customer.
**Auth**: required (Owner only)
**Permissions**: `customer:write`

**Path params**: `month` = `YYYY-MM`.

**Response 200**:
```json
{
  "success": true,
  "data": {
    "customerId": "10",
    "customerName": "Anil Kumar",
    "month": "2026-04",
    "billDetails": {
      "byList": [
        {
          "listName": "Morning Milk",
          "deliveries": 28,
          "leaves": 2,
          "quantity": 1,
          "unit": "litre",
          "ratePerUnit": 60,
          "subtotal": 1680
        }
      ],
      "extraCharges": [
        { "date": "2026-04-10", "amount": 50, "reason": "Festival sweets", "listName": "Morning Milk" }
      ],
      "subtotal": 3550,
      "previousDue": 800,
      "totalDue": 4350
    },
    "paymentStatus": "pending"
  }
}
```

**Error responses**:
| Status | Code | When |
|--------|------|------|
| 400 | VALIDATION_ERROR | Invalid month format |
| 401 | UNAUTHORIZED | Missing/invalid token |
| 403 | FORBIDDEN | Not owner / vendor mismatch |
| 404 | NOT_FOUND | Customer not found |

---

### POST /api/v1/vendors/:vendorId/customers/:customerId/payments
**Purpose**: Record a payment; reduces the customer's running balance.
**Auth**: required (Owner only)
**Permissions**: `customer:write`

**Request body**:
```json
{
  "amount": "number",
  "paymentDate": "YYYY-MM-DD",
  "paymentMethod": "string",
  "referenceNumber": "string"
}
```
Validation: `amount` > 0. `paymentDate` valid date, not in the future by more than 1 day.
`paymentMethod` one of `CASH` | `ONLINE` | `UPI` | `OTHER`. `referenceNumber` optional (≤ 100 chars).

**Response 201**:
```json
{
  "success": true,
  "data": {
    "id": "55",
    "amount": 4350,
    "date": "2026-04-15",
    "method": "UPI",
    "reference": "UPI123456",
    "createdAt": "2026-04-15T08:30:00.000Z"
  }
}
```

**Error responses**:
| Status | Code | When |
|--------|------|------|
| 400 | VALIDATION_ERROR | Invalid input (amount ≤ 0, bad date/method) |
| 401 | UNAUTHORIZED | Missing/invalid token |
| 403 | FORBIDDEN | Not owner / vendor mismatch |
| 404 | NOT_FOUND | Customer not found |

---

### GET /api/v1/vendors/:vendorId/customers/:customerId/payments
**Purpose**: List a customer's payments (reverse chronological), paginated.
**Auth**: required (Owner only)
**Permissions**: `customer:write`

**Query params**: `page` (≥1, default 1), `limit` (1–50, default 20).

**Response 200**: paginated list of `PaymentDto` (envelope per List/Pagination section).
```json
{
  "success": true,
  "data": [
    { "id": "55", "amount": 4350, "date": "2026-04-15", "method": "UPI", "reference": "UPI123456", "createdAt": "2026-04-15T08:30:00.000Z" }
  ],
  "meta": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

**Error responses**:
| Status | Code | When |
|--------|------|------|
| 401 | UNAUTHORIZED | Missing/invalid token |
| 403 | FORBIDDEN | Not owner / vendor mismatch |
| 404 | NOT_FOUND | Customer not found |

---

### PATCH /api/v1/vendors/:vendorId/customers/:customerId/credit-limit
**Purpose**: Update a customer's credit limit.
**Auth**: required (Owner only)
**Permissions**: `customer:write`

**Request body**:
```json
{ "creditLimit": "number" }
```
Validation: `creditLimit` ≥ 0, ≤ 9999999.99.

**Response 200**:
```json
{
  "success": true,
  "data": { "creditLimit": 6000, "creditUtilization": 72 }
}
```
> `creditUtilization` is `(currentBalance / creditLimit) * 100`, rounded; `0` when creditLimit is 0.

**Error responses**:
| Status | Code | When |
|--------|------|------|
| 400 | VALIDATION_ERROR | Invalid creditLimit |
| 401 | UNAUTHORIZED | Missing/invalid token |
| 403 | FORBIDDEN | Not owner / vendor mismatch |
| 404 | NOT_FOUND | Customer not found |

---

### GET /api/v1/vendors/:vendorId/customers/:customerId/calendar/:month
**Purpose**: Delivery calendar for a customer for the given month.
**Auth**: required (Owner or Staff — staff only if customer is in an assigned list)
**Permissions**: `customer:read`

**Path params**: `month` = `YYYY-MM`.

**Response 200**:
```json
{
  "success": true,
  "data": {
    "month": "2026-04",
    "days": {
      "2026-04-01": {
        "deliveries": [
          { "listName": "Morning Milk", "quantity": 1, "unit": "litre", "status": "DELIVERED", "amount": 60 }
        ]
      }
    }
  }
}
```
> `days` is keyed by `YYYY-MM-DD`. Only days that have deliveries are present. `status` is
> uppercase (e.g. `DELIVERED`, `LEAVE`). For staff, `amount` is `null`.

**Error responses**:
| Status | Code | When |
|--------|------|------|
| 400 | VALIDATION_ERROR | Invalid month format |
| 401 | UNAUTHORIZED | Missing/invalid token |
| 403 | FORBIDDEN | Staff not assigned to this customer's list |
| 404 | NOT_FOUND | Customer not found |

---

### POST /api/v1/vendors/:vendorId/customers/:customerId/subscriptions
**Purpose**: Add the customer to an additional supply list.
**Auth**: required (Owner only)
**Permissions**: `customer:write`

**Request body**:
```json
{
  "supplyListId": "string",
  "startDate": "YYYY-MM-DD",
  "customQuantity": "number",
  "customRatePerUnit": "number"
}
```
`supplyListId` required (numeric string). `startDate` optional. `customQuantity` /
`customRatePerUnit` optional and nullable (override the list defaults when provided).

**Response 201**:
```json
{
  "success": true,
  "data": {
    "subscriptionId": "30",
    "listId": "15",
    "listName": "Evening Milk",
    "startTime": "18:00",
    "quantity": 1,
    "unit": "litre",
    "ratePerUnit": 60,
    "frequency": "DAILY",
    "startDate": "2026-05-01",
    "endDate": null,
    "isActive": true,
    "isCustomRate": false,
    "isCustomQuantity": false
  }
}
```

**Error responses**:
| Status | Code | When |
|--------|------|------|
| 400 | VALIDATION_ERROR | Invalid input |
| 401 | UNAUTHORIZED | Missing/invalid token |
| 403 | FORBIDDEN | Not owner / vendor mismatch |
| 404 | NOT_FOUND | Customer or supply list not found |
| 409 | CONFLICT | Customer already subscribed to this list |

---

### DELETE /api/v1/vendors/:vendorId/customers/:customerId/subscriptions/:subscriptionId
**Purpose**: Remove the customer from a supply list (sets `endDate = today`, `isActive = false`).
**Auth**: required (Owner only)
**Permissions**: `customer:write`

**Response 200**:
```json
{ "success": true }
```

**Error responses**:
| Status | Code | When |
|--------|------|------|
| 401 | UNAUTHORIZED | Missing/invalid token |
| 403 | FORBIDDEN | Not owner / vendor mismatch |
| 404 | NOT_FOUND | Subscription not found |
| 422 | UNPROCESSABLE_ENTITY | Subscription already ended |

---

## Shared Response Schemas

### CustomerDetailDto
Returned by create (201), get-detail (200), and update (200).
```json
{
  "id": "10",
  "name": "Anil Kumar",
  "phoneNumber": "+919876543210",
  "email": "anil@example.com",
  "address": "Flat 402, Tower B",
  "area": "Sector 15",
  "language": "hi",
  "customerSince": "2026-01-15",
  "status": "ACTIVE",
  "creditLimit": 5000,
  "currentBalance": 4350,
  "paymentScore": 95,
  "creditUtilization": 87,
  "subscriptions": [ "...SubscriptionDto" ],
  "currentMonthBill": {
    "month": "2026-04",
    "subtotal": 3550,
    "previousDue": 800,
    "totalDue": 4350,
    "status": "pending"
  },
  "paymentHistory": [ "...PaymentDto (last 12)" ],
  "createdAt": "2026-01-15T06:00:00.000Z",
  "updatedAt": "2026-04-15T08:30:00.000Z"
}
```
Field types: `id` string; money fields `number`; `status` uppercase enum
(`ACTIVE`|`INACTIVE`); `currentMonthBill.status` lowercase (`paid`|`pending`|`overdue`).
**Owner-only / staff-null**: `currentBalance`, `creditUtilization`, `currentMonthBill`,
`paymentHistory` (staff receives `null` / empty).

### SubscriptionDto
```json
{
  "subscriptionId": "30",
  "listId": "15",
  "listName": "Evening Milk",
  "startTime": "18:00",
  "quantity": 1,
  "unit": "litre",
  "ratePerUnit": 60,
  "frequency": "DAILY",
  "startDate": "2026-05-01",
  "endDate": null,
  "isActive": true,
  "isCustomRate": false,
  "isCustomQuantity": false
}
```

### PaymentDto
```json
{
  "id": "55",
  "amount": 4350,
  "date": "2026-04-15",
  "method": "UPI",
  "reference": "UPI123456",
  "createdAt": "2026-04-15T08:30:00.000Z"
}
```

## List / Pagination
List endpoints that use the global envelope (e.g. `GET .../payments`) accept `?page=1&limit=20`
and return:
```json
{
  "success": true,
  "data": [],
  "meta": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 }
}
```
> Note: `GET .../customers` returns a non-standard shape — `data: { total, customers: [] }` —
> not the `meta` envelope. Handle it specifically.

## Enums (frontend reference)
- `CustomerStatus`: `ACTIVE` | `INACTIVE`
- `PaymentMethod`: `CASH` | `ONLINE` | `UPI` | `OTHER`
- `paymentStatus` (derived, lowercase): `paid` | `pending` | `overdue`

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
> `correlationId` must be logged by the frontend on every error for debugging.
