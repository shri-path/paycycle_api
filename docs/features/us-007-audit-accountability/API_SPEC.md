# API Specification — Audit & Accountability
> Slug: us-007-audit-accountability | Generated: 2026-06-12

## Base URL
All endpoints are relative to: `/api/v1`

## Authentication
Bearer JWT required on all endpoints. The caller's role (owner vs staff) and vendor
membership are re-validated server-side per request. Wrong-tenant access returns 404
(existence is never revealed).

## Endpoints

### GET /api/v1/vendors/{vendorId}/audit-logs
**Purpose**: List audit log entries (activity timeline) with filters and pagination.
**Auth**: required
**Access**: owner sees all entries; staff sees only their own actions (server forces this).

**Query params** (all optional):
| Param | Type | Notes |
|-------|------|-------|
| staffId | string | filter by acting user id (ignored/overridden for staff callers) |
| customerId | string | filter by customer |
| actionType | string | e.g. `delivery_marked`, `payment_marked` |
| entityType | string | e.g. `daily_supply`, `customer` |
| startDate | string (YYYY-MM-DD) | inclusive |
| endDate | string (YYYY-MM-DD) | inclusive (whole day) |
| page | number | default 1 |
| limit | number | default 50, max 100 |

**Response 200**:
```json
{
  "success": true,
  "data": {
    "auditLogs": [
      {
        "id": "string",
        "timestamp": "ISO8601",
        "actionType": "string",
        "actionLabel": "string",
        "entityType": "string",
        "entityId": "string",
        "user": { "id": "string", "name": "string", "role": "owner" },
        "customer": { "id": "string", "name": "string" },
        "supplyList": { "id": "string", "name": "string" },
        "details": { "status": "string" },
        "ipAddress": "string"
      }
    ],
    "pagination": { "page": 1, "limit": 50, "total": 0, "totalPages": 0 },
    "filters": {
      "availableStaff": [ { "id": "string", "name": "string" } ],
      "availableActionTypes": [ "string" ]
    }
  }
}
```
> `customer`, `supplyList`, `entityType`, `entityId`, `ipAddress` may be `null`.
> `ipAddress` is present only for owner callers.

**Error responses**:
| Status | Code | When |
|--------|------|------|
| 400 | VALIDATION_ERROR | bad date format / limit > 100 |
| 401 | UNAUTHORIZED | missing/invalid token |
| 404 | NOT_FOUND | vendor not a membership of caller |

---

### GET /api/v1/vendors/{vendorId}/audit-logs/conflicts
**Purpose**: List deliveries where an owner/customer override contradicts the staff mark.
**Auth**: required
**Access**: owner only.

**Response 200**:
```json
{
  "success": true,
  "data": {
    "conflicts": [
      {
        "id": "string",
        "deliveryDate": "YYYY-MM-DD",
        "customer": { "id": "string", "name": "string" },
        "supplyList": { "id": "string", "name": "string" },
        "staffAction": {
          "timestamp": "ISO8601",
          "staff": { "id": "string", "name": "string" },
          "status": "DELIVERED"
        },
        "overrideAction": {
          "timestamp": "ISO8601",
          "by": "owner",
          "status": "LEAVE",
          "timeDiffMinutes": 15
        }
      }
    ]
  }
}
```

**Error responses**:
| Status | Code | When |
|--------|------|------|
| 401 | UNAUTHORIZED | missing/invalid token |
| 403 | FORBIDDEN | caller is staff |
| 404 | NOT_FOUND | vendor not a membership of caller |

---

### GET /api/v1/vendors/{vendorId}/audit-logs/staff-summary
**Purpose**: Per-staff activity aggregation (counts, active days, first/last action).
**Auth**: required
**Access**: owner only.

**Query params** (optional): `staffId`, `startDate` (YYYY-MM-DD), `endDate` (YYYY-MM-DD).

**Response 200**:
```json
{
  "success": true,
  "data": {
    "summary": [
      {
        "staffId": "string",
        "staffName": "string",
        "byActionType": [
          { "actionType": "string", "actionLabel": "string", "count": 0,
            "firstActionAt": "ISO8601", "lastActionAt": "ISO8601" }
        ],
        "byDate": [
          { "date": "YYYY-MM-DD", "actionCount": 0,
            "firstActionAt": "ISO8601", "lastActionAt": "ISO8601" }
        ],
        "totalActions": 0,
        "activeDays": 0,
        "avgActionsPerDay": 0
      }
    ]
  }
}
```

**Error responses**:
| Status | Code | When |
|--------|------|------|
| 401 | UNAUTHORIZED | missing/invalid token |
| 403 | FORBIDDEN | caller is staff |
| 404 | NOT_FOUND | vendor not a membership of caller |

---

### POST /api/v1/vendors/{vendorId}/audit-logs/export
**Purpose**: Export filtered audit logs as a CSV file (download).
**Auth**: required
**Access**: owner only.

**Request body**:
```json
{
  "format": "csv",
  "staffId": "string",
  "actionType": "string",
  "startDate": "YYYY-MM-DD",
  "endDate": "YYYY-MM-DD"
}
```
> Only `format: "csv"` is accepted. All other fields optional. Max 10,000 rows.

**Response 200**: a CSV file.
- `Content-Type: text/csv; charset=utf-8`
- `Content-Disposition: attachment; filename="audit-logs-<vendorId>-<epoch>.csv"`
- Body columns: `Timestamp,Action,User,Role,Customer,Supply List,Details`

**Error responses**:
| Status | Code | When |
|--------|------|------|
| 400 | VALIDATION_ERROR | `format` not `csv`, bad date |
| 401 | UNAUTHORIZED | missing/invalid token |
| 403 | FORBIDDEN | caller is staff |
| 404 | NOT_FOUND | vendor not a membership of caller |

---

### GET /api/v1/vendors/{vendorId}/audit-logs/my-activity
**Purpose**: The caller's own recent activity + today/week/month counts.
**Auth**: required
**Access**: owner or staff (always self-scoped to caller).

**Response 200**:
```json
{
  "success": true,
  "data": {
    "activity": [
      {
        "id": "string",
        "timestamp": "ISO8601",
        "actionType": "string",
        "actionLabel": "string",
        "customer": { "id": "string", "name": "string" },
        "supplyList": { "id": "string", "name": "string" },
        "details": { "status": "string" }
      }
    ],
    "summary": { "todayActions": 0, "thisWeekActions": 0, "thisMonthActions": 0 }
  }
}
```

**Error responses**:
| Status | Code | When |
|--------|------|------|
| 401 | UNAUTHORIZED | missing/invalid token |
| 404 | NOT_FOUND | vendor not a membership of caller |

---

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
> `correlationId` must be logged by the frontend on every error.
