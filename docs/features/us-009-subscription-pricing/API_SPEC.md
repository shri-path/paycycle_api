# API Specification — Subscription & Pricing Management
> Slug: us-009-subscription-pricing | US-009 | Generated: 2026-06-12

Authoritative REST contract for the frontend. Self-contained — plain JSON types only.

## Base URL
All endpoints are relative to: `/api/v1`

Two mount shapes:
- **Plan catalog** (not vendor-scoped): `/api/v1/subscription-plans`
- **Vendor subscription** (nested): `/api/v1/vendors/:vendorId/subscription/...`

`vendorId` is verified against the caller's JWT membership. A vendor the caller has no active
membership in returns **404 NOT_FOUND** (existence is never revealed — not 403).

## Conventions
- **All IDs are strings** in requests and responses (BigInt serialized as string).
- All money/price/amount fields are plain `number` (INR, 2-decimal precision).
- Dates are `ISO8601`: `date` fields are `YYYY-MM-DD`; timestamps are full ISO datetimes.
- **`0` means "unlimited"** for any `max*` limit field (`maxCustomers`, `maxStaff`,
  `maxSupplyLists`). When rendering, treat `0` as "Unlimited".
- Enums are **UPPERCASE** unless noted.

## Authentication
Bearer JWT required on **every** endpoint. RBAC enforced server-side.

- **Owner** — full access to all endpoints.
- **Staff** — may call only **GET `/subscription-plans`** and **GET
  `/vendors/:vendorId/subscription`** (read the current plan + usage). All manage actions
  (upgrade, renew, cancel, auto-renewal) and the invoices/history lists are **owner-only** → staff
  receives **403 FORBIDDEN**.

| Action | Permission |
|--------|-----------|
| List plans | authenticated (any active member) |
| View current subscription + usage | `subscription:read` |
| Upgrade / renew / cancel / toggle auto-renewal | `subscription:manage` (Owner only) |
| List invoices / history | `subscription:read` (Owner only) |

---

## Endpoints

### 1. GET /api/v1/subscription-plans
**Purpose**: List all active subscription plans (for the upgrade screen / pricing display).
**Auth**: required (Owner or Staff)
**Permissions**: authenticated

**Response 200**:
```json
{
  "success": true,
  "data": {
    "plans": [
      {
        "id": "1",
        "planCode": "STARTER",
        "planName": "Starter",
        "maxCustomers": 20,
        "maxStaff": 1,
        "maxSupplyLists": 5,
        "priceMonthly": 0,
        "priceYearly": null,
        "features": {
          "basic_delivery_tracking": true,
          "customer_management": true
        }
      },
      {
        "id": "2",
        "planCode": "GROWTH",
        "planName": "Growth",
        "maxCustomers": 150,
        "maxStaff": 3,
        "maxSupplyLists": 10,
        "priceMonthly": 499,
        "priceYearly": 4990,
        "features": {
          "basic_delivery_tracking": true,
          "customer_management": true,
          "staff_management": true,
          "analytics": true,
          "whatsapp_notifications": true,
          "credit_control": true
        }
      },
      {
        "id": "3",
        "planCode": "PRO",
        "planName": "Pro",
        "maxCustomers": 0,
        "maxStaff": 0,
        "maxSupplyLists": 0,
        "priceMonthly": 999,
        "priceYearly": 9990,
        "features": {
          "basic_delivery_tracking": true,
          "customer_management": true,
          "staff_management": true,
          "analytics": true,
          "whatsapp_notifications": true,
          "credit_control": true,
          "advanced_reports": true,
          "api_access": true,
          "priority_support": true
        }
      }
    ]
  }
}
```
> `maxCustomers/maxStaff/maxSupplyLists = 0` → render "Unlimited". Plans are returned ordered by
> tier ascending (Starter → Growth → Pro).

**Error responses**:
| Status | Code | When |
|--------|------|------|
| 401 | UNAUTHORIZED | Missing/invalid token |

---

### 2. GET /api/v1/vendors/:vendorId/subscription
**Purpose**: Current plan + live usage + utilization% + can-add-more flags.
**Auth**: required (Owner or Staff)
**Permissions**: `subscription:read`

**Response 200**:
```json
{
  "success": true,
  "data": {
    "currentPlan": {
      "subscriptionId": "10",
      "planId": "2",
      "planCode": "GROWTH",
      "planName": "Growth",
      "status": "ACTIVE",
      "billingCycle": "MONTHLY",
      "startDate": "2026-04-01",
      "endDate": null,
      "nextBillingDate": "2026-05-01",
      "autoRenewal": true,
      "isTrial": false,
      "limits": {
        "maxCustomers": 150,
        "maxStaff": 3,
        "maxSupplyLists": 10
      }
    },
    "usage": {
      "customers": 127,
      "staff": 3,
      "supplyLists": 5
    },
    "utilizationPercentage": {
      "customers": 85,
      "staff": 100,
      "supplyLists": 50
    },
    "canAddMore": {
      "customers": true,
      "staff": false,
      "supplyLists": true
    }
  }
}
```
Notes:
- `endDate: null` means the subscription is **currently active** (no scheduled end).
- `status` ∈ `TRIAL` | `ACTIVE` | `PAST_DUE` | `CANCELLED` | `EXPIRED`. A `CANCELLED` subscription
  is still usable until `nextBillingDate`.
- `utilizationPercentage` is `round((usage / max) * 100)`; for **unlimited** limits (`max = 0`) it is
  always `0`. UI color: green `< 80`, orange `80–94`, red `>= 95`.
- `canAddMore[resource]` is `true` when the limit is unlimited or `usage < max`.

**Error responses**:
| Status | Code | When |
|--------|------|------|
| 401 | UNAUTHORIZED | Missing/invalid token |
| 404 | NOT_FOUND | Wrong tenant, or vendor has no subscription record |

---

### 3. POST /api/v1/vendors/:vendorId/subscription/upgrade
**Purpose**: Upgrade to a strictly higher-tier plan; pro-rata charge for mid-cycle.
**Auth**: required (Owner only)
**Permissions**: `subscription:manage`

**Request body**:
```json
{
  "newPlanId": "3",
  "billingCycle": "MONTHLY"
}
```
Validation: `newPlanId` required (numeric string, must resolve to an active plan **strictly higher**
than the current tier). `billingCycle` required, one of `MONTHLY` | `YEARLY`.

**Response 200**:
```json
{
  "success": true,
  "data": {
    "subscription": {
      "subscriptionId": "11",
      "planId": "3",
      "planCode": "PRO",
      "planName": "Pro",
      "status": "ACTIVE",
      "billingCycle": "MONTHLY",
      "startDate": "2026-04-15",
      "endDate": null,
      "nextBillingDate": "2026-05-15",
      "autoRenewal": true
    },
    "invoice": {
      "id": "55",
      "invoiceNumber": "INV-2026-04-001",
      "amount": 250,
      "tax": 0,
      "totalAmount": 250,
      "invoiceDate": "2026-04-15",
      "dueDate": "2026-04-20",
      "paymentStatus": "PENDING",
      "paymentUrl": "https://payment.paycycle.app/invoice/55"
    }
  }
}
```
> **`paymentUrl` is a stub this iteration** — no real payment is processed. The FE may open it but
> must not assume a completed transaction. `amount` is the pro-rated difference (may be `0` when no
> days remain in the current cycle; in that case `paymentStatus` may be `PAID`).

**Error responses**:
| Status | Code | When |
|--------|------|------|
| 400 | VALIDATION_ERROR | Missing/invalid `newPlanId` or `billingCycle` |
| 401 | UNAUTHORIZED | Missing/invalid token |
| 403 | FORBIDDEN | Not owner |
| 404 | NOT_FOUND | Wrong tenant / no current subscription / plan not found |
| 422 | UNPROCESSABLE_ENTITY | Target plan is same or lower tier than current |

---

### 4. POST /api/v1/vendors/:vendorId/subscription/renew
**Purpose**: Manually renew (extend) the subscription for another billing period.
**Auth**: required (Owner only)
**Permissions**: `subscription:manage`

**Request body**:
```json
{ "billingCycle": "MONTHLY" }
```
Validation: `billingCycle` required, `MONTHLY` | `YEARLY`. Renewing an `EXPIRED` subscription
re-activates it with a fresh period.

**Response 200**:
```json
{
  "success": true,
  "data": {
    "subscription": {
      "subscriptionId": "10",
      "planId": "2",
      "planCode": "GROWTH",
      "planName": "Growth",
      "status": "ACTIVE",
      "billingCycle": "MONTHLY",
      "startDate": "2026-05-01",
      "endDate": null,
      "nextBillingDate": "2026-06-01",
      "autoRenewal": true
    },
    "invoice": {
      "id": "56",
      "invoiceNumber": "INV-2026-05-001",
      "amount": 499,
      "tax": 0,
      "totalAmount": 499,
      "invoiceDate": "2026-05-01",
      "dueDate": "2026-05-06",
      "paymentStatus": "PENDING",
      "paymentUrl": "https://payment.paycycle.app/invoice/56"
    }
  }
}
```

**Error responses**:
| Status | Code | When |
|--------|------|------|
| 400 | VALIDATION_ERROR | Invalid `billingCycle` |
| 401 | UNAUTHORIZED | Missing/invalid token |
| 403 | FORBIDDEN | Not owner |
| 404 | NOT_FOUND | Wrong tenant / no subscription to renew |

---

### 5. POST /api/v1/vendors/:vendorId/subscription/cancel
**Purpose**: Cancel the subscription. It stays active until `nextBillingDate`; auto-renewal is
turned off.
**Auth**: required (Owner only)
**Permissions**: `subscription:manage`

**Request body**: none (empty `{}` accepted).

**Response 200**:
```json
{
  "success": true,
  "data": {
    "subscriptionId": "10",
    "status": "CANCELLED",
    "autoRenewal": false,
    "activeUntil": "2026-05-01"
  }
}
```
> `activeUntil` = `nextBillingDate`; the vendor keeps full access until that date.

**Error responses**:
| Status | Code | When |
|--------|------|------|
| 401 | UNAUTHORIZED | Missing/invalid token |
| 403 | FORBIDDEN | Not owner |
| 404 | NOT_FOUND | Wrong tenant / no current subscription |
| 422 | UNPROCESSABLE_ENTITY | Subscription is already cancelled |

---

### 6. PATCH /api/v1/vendors/:vendorId/subscription/auto-renewal
**Purpose**: Toggle auto-renewal on the current subscription.
**Auth**: required (Owner only)
**Permissions**: `subscription:manage`

**Request body**:
```json
{ "autoRenewal": true }
```
Validation: `autoRenewal` required boolean.

**Response 200**:
```json
{
  "success": true,
  "data": { "subscriptionId": "10", "autoRenewal": true }
}
```

**Error responses**:
| Status | Code | When |
|--------|------|------|
| 400 | VALIDATION_ERROR | `autoRenewal` missing/not boolean |
| 401 | UNAUTHORIZED | Missing/invalid token |
| 403 | FORBIDDEN | Not owner |
| 404 | NOT_FOUND | Wrong tenant / no current subscription |

---

### 7. GET /api/v1/vendors/:vendorId/subscription/invoices
**Purpose**: Billing history (paginated, reverse chronological).
**Auth**: required (Owner only)
**Permissions**: `subscription:read`

**Query params**: `page` (≥1, default 1), `limit` (1–50, default 20).

**Response 200**:
```json
{
  "success": true,
  "data": [
    {
      "id": "55",
      "invoiceNumber": "INV-2026-04-001",
      "amount": 499,
      "tax": 0,
      "totalAmount": 499,
      "invoiceDate": "2026-04-01",
      "dueDate": "2026-04-06",
      "paymentStatus": "PAID",
      "paymentDate": "2026-04-02",
      "paymentMethod": "UPI",
      "paymentReference": "UPI123456"
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```
> `paymentStatus` ∈ `PAID` | `PENDING` | `OVERDUE`. `paymentDate`/`paymentMethod`/`paymentReference`
> are `null` until paid (real payments stubbed this iteration). PDF download is **not** available
> yet — do not show a working "Download PDF" action.

**Error responses**:
| Status | Code | When |
|--------|------|------|
| 401 | UNAUTHORIZED | Missing/invalid token |
| 403 | FORBIDDEN | Not owner |
| 404 | NOT_FOUND | Wrong tenant |

---

### 8. GET /api/v1/vendors/:vendorId/subscription/history
**Purpose**: Subscription event history (plan changes, renewals, cancellations).
**Auth**: required (Owner only)
**Permissions**: `subscription:read`

**Query params**: `page` (≥1, default 1), `limit` (1–50, default 20).

**Response 200**:
```json
{
  "success": true,
  "data": [
    {
      "id": "200",
      "eventType": "UPGRADED",
      "oldPlanName": "Growth",
      "newPlanName": "Pro",
      "reason": null,
      "performedByUserId": "5",
      "createdAt": "2026-04-15T10:30:00.000Z"
    },
    {
      "id": "199",
      "eventType": "CREATED",
      "oldPlanName": null,
      "newPlanName": "Starter",
      "reason": null,
      "performedByUserId": null,
      "createdAt": "2026-01-01T06:00:00.000Z"
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 2, "totalPages": 1 }
}
```
> `eventType` ∈ `CREATED` | `UPGRADED` | `DOWNGRADED` | `RENEWED` | `CANCELLED` | `EXPIRED`.
> `performedByUserId` is `null` for system actions (e.g. cron auto-renew/expire, signup).

**Error responses**:
| Status | Code | When |
|--------|------|------|
| 401 | UNAUTHORIZED | Missing/invalid token |
| 403 | FORBIDDEN | Not owner |
| 404 | NOT_FOUND | Wrong tenant |

---

## Limit Enforcement (affects existing endpoints)

The following **existing** write endpoints now enforce the active plan's limits **before** creating
the resource. When the vendor is at their plan limit, the request is rejected with **HTTP 451**:

| Endpoint | Resource enforced |
|----------|-------------------|
| `POST /api/v1/vendors/:vendorId/customers` | customers |
| `POST /api/v1/vendors/:vendorId/staff/invite` | staff |
| `POST /api/v1/vendors/:vendorId/supply-lists` | supplyLists |

**451 response body**:
```json
{
  "success": false,
  "error": {
    "code": "SUBSCRIPTION_LIMIT_REACHED",
    "message": "Your current plan allows up to 20 customers. Please upgrade to add more.",
    "correlationId": "uuid",
    "details": {
      "upgradeUrl": "/subscription/upgrade",
      "limits": { "max": 20, "current": 20 }
    }
  }
}
```
**Frontend handling**: on a `451` from any of these endpoints, show the "Limit Reached" modal using
`error.details.limits.max` / `error.details.limits.current` and route the upgrade CTA to
`error.details.upgradeUrl`. Unlimited plans (Pro) never return 451.

---

## Shared Response Schemas

### PlanDto
```json
{
  "id": "2", "planCode": "GROWTH", "planName": "Growth",
  "maxCustomers": 150, "maxStaff": 3, "maxSupplyLists": 10,
  "priceMonthly": 499, "priceYearly": 4990,
  "features": { "analytics": true }
}
```

### SubscriptionViewDto — see endpoint 2 (`currentPlan` + `usage` + `utilizationPercentage` + `canAddMore`).

### InvoiceDto
```json
{
  "id": "55", "invoiceNumber": "INV-2026-04-001",
  "amount": 499, "tax": 0, "totalAmount": 499,
  "invoiceDate": "2026-04-01", "dueDate": "2026-04-06",
  "paymentStatus": "PAID", "paymentDate": "2026-04-02",
  "paymentMethod": "UPI", "paymentReference": "UPI123456"
}
```

### HistoryEventDto — see endpoint 8.

## Enums (frontend reference)
- `SubscriptionStatus`: `TRIAL` | `ACTIVE` | `PAST_DUE` | `CANCELLED` | `EXPIRED`
- `BillingCycle`: `MONTHLY` | `YEARLY`
- `InvoicePaymentStatus`: `PAID` | `PENDING` | `OVERDUE`
- `SubscriptionEventType`: `CREATED` | `UPGRADED` | `DOWNGRADED` | `RENEWED` | `CANCELLED` | `EXPIRED`
- `PlanCode`: `STARTER` | `GROWTH` | `PRO`

## List / Pagination
Invoices and history use the standard envelope with `?page=1&limit=20`:
```json
{ "success": true, "data": [], "meta": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 } }
```
> Note: `GET /subscription-plans` and `GET .../subscription` return object-shaped `data` (not the
> `meta` envelope) — handle them specifically.

## Error Envelope
All errors:
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
> The `451` limit error additionally includes `error.details` with `upgradeUrl` and `limits`.
> Log `correlationId` on every error.

## Deferred / Not in this iteration (frontend must not rely on)
- Real payment processing — `paymentUrl` is a stub; no webhook/confirmation flow.
- Invoice PDF download.
- Trial-period onboarding (`isTrial`/trial start) — field present, always `false` for now.
- Plan **downgrade** — no endpoint; upgrade is higher-tier only.
- Expiry/renewal push notifications — server logs only (no notifier).
