# API Specification — Referral Engine & Network Growth

> Slug: `us-014-referral-engine` | Generated: 2026-06-15
> Status: FROZEN CONTRACT for the frontend. Provisional items (geo distance, withdrawal payout, permission strings) are marked — see notes; they will not change request/response *shapes*, only semantics.

## Base URL
All endpoints are relative to: `/api/v1`

## Authentication
Bearer JWT required on **all** endpoints. All endpoints are **owner-only** and **vendor-scoped**.
- The path `:vendorId` MUST equal the vendor in the caller's JWT. Any mismatch returns **404 NOT_FOUND** (existence is masked — never 403).
- Permissions (RBAC, enforced server-side):
  - `referral:create` — create vendor referral
  - `referral:read` — read dashboards, lists, leaderboard, nearby vendors, customer referrals
  - `referral:invite` — send bulk customer invites
  - `vendor_credit:read` — read credit balance & ledger
  - `vendor_credit:redeem` — redeem credits

## Global Envelope
Success (single):
```json
{ "success": true, "data": { } }
```
Success (list):
```json
{ "success": true, "data": [], "meta": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 } }
```
Error:
```json
{ "success": false, "error": { "code": "SNAKE_CASE_CODE", "message": "Human-readable message", "correlationId": "uuid" } }
```
> Log `correlationId` on every error.

## Common types
- `id`: string (numeric id serialized as string)
- money: number (rupees, 2-decimal)
- dates: `ISO8601` (date or datetime as noted)
- All list endpoints accept `?page=1&limit=20`.

---

### POST /api/v1/vendors/:vendorId/referrals/vendor
**Purpose**: Create a vendor-to-vendor referral and return the shareable code + WhatsApp message.
**Auth**: required
**Permissions**: `referral:create`

**Request body**:
```json
{
  "vendorName": "string",
  "phoneNumber": "string"
}
```
- `vendorName`: optional, string, max 100
- `phoneNumber`: required, string, 10–15 digits (E.164 or local)

**Response 201**:
```json
{
  "success": true,
  "data": {
    "referralId": "string",
    "referralCode": "string",
    "referralLink": "string",
    "message": "string",
    "status": "PENDING",
    "createdAt": "ISO8601"
  }
}
```

**Error responses**:
| Status | Code | When |
|--------|------|------|
| 400 | VALIDATION_ERROR | Missing/invalid phone |
| 403 | SELF_REFERRAL_BLOCKED | Phone belongs to the calling owner |
| 404 | NOT_FOUND | vendorId not owned by caller |
| 409 | DUPLICATE_REFERRAL | An open referral to this phone already exists |
| 429 | RATE_LIMITED | More than 10 referrals created today |

---

### GET /api/v1/vendors/:vendorId/referrals/dashboard
**Purpose**: Full referral dashboard — earnings, each vendor referral with milestone progress, and customer-growth summary.
**Auth**: required
**Permissions**: `referral:read`

**Response 200**:
```json
{
  "success": true,
  "data": {
    "totalEarnings": { "credits": 0, "revenueShare": 0, "total": 0 },
    "availableBalance": 0,
    "vendorReferrals": [
      {
        "id": "string",
        "referredVendorName": "string",
        "referredDate": "ISO8601",
        "status": "PENDING|SIGNED_UP|QUALIFIED|REWARDED",
        "customerCount": 0,
        "earned": {
          "signup": 0,
          "milestone10": 0,
          "milestone50": 0,
          "revenueShare": 0,
          "total": 0
        },
        "nextMilestone": {
          "type": "10_customers|50_customers|null",
          "reward": 0,
          "progress": 0,
          "target": 0
        }
      }
    ],
    "customerGrowthFromReferrals": {
      "newCustomersThisMonth": 0,
      "totalFromReferrals": 0,
      "additionalMonthlyRevenue": 0,
      "topReferrer": { "customerName": "string", "referralCount": 0 }
    }
  }
}
```
- `nextMilestone` is `null` when all milestones achieved.

**Error responses**:
| Status | Code | When |
|--------|------|------|
| 404 | NOT_FOUND | vendorId not owned by caller |

---

### GET /api/v1/vendors/:vendorId/referrals/vendor
**Purpose**: Paginated list of this vendor's vendor referrals.
**Auth**: required
**Permissions**: `referral:read`

**Query params**: `?page=1&limit=20&status=PENDING|SIGNED_UP|QUALIFIED|REWARDED` (status optional)

**Response 200**:
```json
{
  "success": true,
  "data": [
    {
      "id": "string",
      "refereeName": "string",
      "refereePhone": "string",
      "referralCode": "string",
      "status": "PENDING|SIGNED_UP|QUALIFIED|REWARDED",
      "signupDate": "ISO8601|null",
      "customerCount": 0,
      "totalEarned": 0,
      "createdAt": "ISO8601"
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 }
}
```

**Error responses**:
| Status | Code | When |
|--------|------|------|
| 404 | NOT_FOUND | vendorId not owned by caller |

---

### GET /api/v1/vendors/:vendorId/customer-referrals
**Purpose**: Customer-to-customer referral summary, top referrers, and recent additions.
**Auth**: required
**Permissions**: `referral:read`

**Query params**: `?page=1&limit=20` (applies to `recentAdditions`)

**Response 200**:
```json
{
  "success": true,
  "data": {
    "summary": { "newThisMonth": 0, "totalFromReferrals": 0, "percentageOfBase": 0 },
    "topReferrers": [
      { "customerId": "string", "customerName": "string", "referralCount": 0 }
    ],
    "recentAdditions": [
      { "referredCustomerName": "string", "referrerCustomerName": "string", "joinedDate": "ISO8601" }
    ]
  },
  "meta": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 }
}
```

**Error responses**:
| Status | Code | When |
|--------|------|------|
| 404 | NOT_FOUND | vendorId not owned by caller |

---

### POST /api/v1/vendors/:vendorId/customers/bulk-invite
**Purpose**: Send WhatsApp invites to customers not yet on PayCycle (carrying the vendor's referral code).
**Auth**: required
**Permissions**: `referral:invite`

**Request body**:
```json
{
  "targetType": "all_not_on_paycycle | specific",
  "customerIds": ["string"],
  "messageLanguage": "string",
  "customMessage": "string",
  "autoResend": true,
  "maxAttempts": 3
}
```
- `targetType`: required, one of `all_not_on_paycycle`, `specific`
- `customerIds`: required only when `targetType=specific`; array of string ids
- `messageLanguage`: optional, default `"hi"`
- `customMessage`: optional, max 1000
- `autoResend`: optional boolean, default `true`
- `maxAttempts`: optional integer 1–3, default `3`

**Response 200**:
```json
{
  "success": true,
  "data": { "totalSent": 0, "delivered": 0, "failed": 0, "skippedAlreadyOnPaycycle": 0 }
}
```
> Sending to zero eligible customers is a success with `totalSent: 0` — not an error.

**Error responses**:
| Status | Code | When |
|--------|------|------|
| 400 | VALIDATION_ERROR | Invalid targetType / missing customerIds for specific |
| 404 | NOT_FOUND | vendorId not owned by caller |

---

### GET /api/v1/vendors/:vendorId/credits
**Purpose**: Credit balance summary.
**Auth**: required
**Permissions**: `vendor_credit:read`

**Response 200**:
```json
{
  "success": true,
  "data": {
    "availableCredits": 0,
    "lifetimeEarned": 0,
    "lifetimeUsed": 0,
    "withdrawalEligible": false,
    "withdrawalMinimum": 2000
  }
}
```
- `withdrawalEligible` is `true` when `availableCredits >= withdrawalMinimum`.

**Error responses**:
| Status | Code | When |
|--------|------|------|
| 404 | NOT_FOUND | vendorId not owned by caller |

---

### GET /api/v1/vendors/:vendorId/credits/transactions
**Purpose**: Paginated immutable credit ledger.
**Auth**: required
**Permissions**: `vendor_credit:read`

**Query params**: `?page=1&limit=20&type=EARNED|USED|EXPIRED|ADJUSTMENT` (type optional)

**Response 200**:
```json
{
  "success": true,
  "data": [
    {
      "id": "string",
      "transactionType": "EARNED|USED|EXPIRED|ADJUSTMENT",
      "rewardKind": "SIGNUP_BONUS|MILESTONE_10|MILESTONE_50|REVENUE_SHARE|CUSTOMER_REFERRAL|null",
      "amount": 0,
      "balanceAfter": 0,
      "sourceType": "VENDOR_REFERRAL|CUSTOMER_REFERRAL|SUBSCRIPTION_PAYMENT|MANUAL|null",
      "description": "string",
      "createdAt": "ISO8601"
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 }
}
```

**Error responses**:
| Status | Code | When |
|--------|------|------|
| 404 | NOT_FOUND | vendorId not owned by caller |

---

### POST /api/v1/vendors/:vendorId/credits/redeem
**Purpose**: Redeem available credits toward subscription, plan upgrade, or cash withdrawal.
**Auth**: required
**Permissions**: `vendor_credit:redeem`

**Request body**:
```json
{
  "redemptionType": "subscription | upgrade | withdraw",
  "amount": 0
}
```
- `redemptionType`: required, one of `subscription`, `upgrade`, `withdraw`
- `amount`: required, number > 0, ≤ availableCredits

**Response 200**:
```json
{
  "success": true,
  "data": {
    "redemptionType": "subscription|upgrade|withdraw",
    "amountApplied": 0,
    "feeCharged": 0,
    "newBalance": 0,
    "status": "APPLIED | PENDING_PAYOUT"
  }
}
```
- `withdraw`: `feeCharged` = 10% of `amount`; `status` = `PENDING_PAYOUT` (no live bank transfer in v1 — provisional).
- `subscription`/`upgrade`: `feeCharged` = 0; `status` = `APPLIED`.

**Error responses**:
| Status | Code | When |
|--------|------|------|
| 400 | VALIDATION_ERROR | Invalid redemptionType / amount ≤ 0 |
| 400 | WITHDRAWAL_THRESHOLD | `withdraw` with availableCredits < 2000 |
| 404 | NOT_FOUND | vendorId not owned by caller |
| 409 | INSUFFICIENT_CREDITS | amount > availableCredits |

---

### GET /api/v1/vendors/:vendorId/nearby-vendors
**Purpose**: Vendors in the same area using PayCycle, grouped by category, with your rank.
**Auth**: required
**Permissions**: `referral:read`

**Query params**: `?radius=2`
> PROVISIONAL: v1 groups by locality/area text match + category. `radius` is accepted and echoed but not yet a true geo radius (no PostGIS). `distance` is `null` until geo lands.

**Response 200**:
```json
{
  "success": true,
  "data": {
    "yourBusiness": { "name": "string", "customersOnPaycycle": 0, "rankInArea": 0 },
    "byCategory": {
      "milk": [
        { "name": "string", "customersOnPaycycle": 0, "distance": null, "yourReferral": false }
      ]
    },
    "totalVendorsInRadius": 0,
    "totalCustomersInRadius": 0,
    "radius": 2
  }
}
```
- `byCategory` keys are dynamic category strings (e.g. `milk`, `newspaper`, `bread`, `water`).
- Empty area returns empty `byCategory` `{}` with zero totals.

**Error responses**:
| Status | Code | When |
|--------|------|------|
| 404 | NOT_FOUND | vendorId not owned by caller |

---

### GET /api/v1/vendors/:vendorId/referrals/leaderboard
**Purpose**: Pre-computed referral leaderboard for a period.
**Auth**: required
**Permissions**: `referral:read`

**Query params**: `?period=WEEKLY|MONTHLY|ALL_TIME` (default `MONTHLY`), `?page=1&limit=20`

**Response 200**:
```json
{
  "success": true,
  "data": [
    {
      "vendorId": "string",
      "vendorName": "string",
      "totalReferrals": 0,
      "qualifiedReferrals": 0,
      "rankPosition": 0,
      "rewardEarned": 0,
      "isYou": false
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 }
}
```

**Error responses**:
| Status | Code | When |
|--------|------|------|
| 400 | VALIDATION_ERROR | Invalid period |
| 404 | NOT_FOUND | vendorId not owned by caller |

---

## Error Code Reference (all endpoints)
| Code | HTTP | Meaning |
|------|------|---------|
| VALIDATION_ERROR | 400 | Request body/query failed validation |
| WITHDRAWAL_THRESHOLD | 400 | Withdrawal below ₹2000 minimum |
| UNAUTHORIZED | 401 | Missing/invalid JWT |
| SELF_REFERRAL_BLOCKED | 403 | Referring own phone number |
| FORBIDDEN | 403 | Authenticated but lacks the required permission |
| NOT_FOUND | 404 | Resource not found OR vendor not owned by caller (tenant mask) |
| DUPLICATE_REFERRAL | 409 | Open referral to this phone already exists |
| INSUFFICIENT_CREDITS | 409 | Redemption amount exceeds available balance |
| RATE_LIMITED | 429 | Referral creation rate limit (10/day) exceeded |

## Notes for Frontend
- All money values are rupees as plain numbers (2-decimal precision).
- Credit `transactionType=ADJUSTMENT` represents a clawback (a *decrease*); render `balanceAfter` as the authority for current balance.
- `nearby-vendors` `distance` will be `null` in v1 — hide distance UI or show "nearby" without a number until geo support ships.
- Withdrawal returns `PENDING_PAYOUT`; show a "processing 2–3 business days" message; no synchronous bank confirmation.
- The vendor's `referralCode` is also returned by endpoint #1; the dashboard does not separately return it — call #1 (or read the vendor profile) for the shareable code/link.
