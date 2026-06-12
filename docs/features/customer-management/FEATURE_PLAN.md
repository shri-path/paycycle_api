# Feature Plan: US-008 Customer Management

## 1. User Story ID & Title

**US-008 — Customer Management**

Owner can manage the customer database: create, edit, deactivate customers; add them to supply lists; record payments; set credit limits; view monthly bills and delivery calendar.

Staff can view customers from their assigned lists (read-only, no financials).

---

## 2. Summary

This feature extends the existing `Customer` model (minimally seeded in US-005) into a full management module. Key areas:

- **Customer CRUD**: Create customers, set profile, manage contact, deactivate (soft delete)
- **Subscription management**: Attach/detach customers to supply lists with custom rate/quantity overrides
- **Billing**: Monthly bill computed from `DailySupply` records + extra charges + previous dues (balance roll-over)
- **Payments**: Record payments; each payment reduces the running balance
- **Credit management**: Credit limit per customer; credit utilization percentage computed from balance
- **Calendar**: Per-customer delivery calendar for any month
- **Staff view**: Read-only access scoped to assigned lists, no financials

**Key boundaries:**
- This module **owns** customer profile, credit limit, payment history, and balance calculation
- `SupplyListCustomer` (subscription) lives in the supply-list aggregate; this module *writes* subscriptions as a side-effect of customer creation or subscription commands
- `DailySupply` data is **read** via the delivery module's repository port (no delivery domain objects are reconstituted here — raw Prisma reads suffice for billing queries)
- WhatsApp invite is **not** in scope for this iteration — the `sendInvite` field is accepted and logged, but no external API call is made (OQ-1)

---

## 3. Complexity Assessment

**Level: Complex**

**Rationale:**
- Two domain entities with business rules: `CustomerEntity` (balance, credit-limit invariants, status lifecycle) and `PaymentEntity` (amount > 0 invariant, immutable after creation)
- Balance calculation is a domain-level derived concept crossing multiple aggregates (DailySupply, SupplyExtraCharge, Payment)
- Multi-tenant access control: owner sees all, staff sees only subscription-scoped customers
- Financial data field-level gate: credit limit, balance, payment history visible to owner only
- Monthly bill generation query aggregates data from three tables (daily_supplies, supply_extra_charges, payments)
- Cross-module read dependency on delivery module (DailySupply data) — resolved via a repository port so the customer module never imports delivery internals

**Architecture depth: Full DDD** — domain entities with behavior, value objects, repository ports, command/query separation, mapper

---

## 4. Domain Model

### Aggregates

#### CustomerAggregate
- **Root**: `CustomerEntity`
- **Invariants**:
  1. `name` must be 1–100 characters
  2. `phone` must be a valid phone number (E.164 format, normalized with country code)
  3. `(vendorId, phone)` unique among non-deleted customers (enforced at DB + service layer)
  4. `creditLimit >= 0`
  5. `paymentScore` is in range [0, 100]
  6. Status transitions: ACTIVE → INACTIVE (deactivate); INACTIVE → ACTIVE (reactivate)
- **Lifecycle**: ACTIVE → INACTIVE (soft deactivate); INACTIVE → ACTIVE (reactivate)
- **Commands**: CreateCustomer, UpdateCustomer, DeactivateCustomer, ReactivateCustomer, UpdateCreditLimit
- **Queries**: GetCustomer, ListCustomers (with filters), GetCustomerBill, GetCustomerCalendar

#### PaymentAggregate
- **Root**: `PaymentEntity`
- **Invariants**:
  1. `amount > 0` (payments are always positive; credits via overpayment allowed — balance can go negative)
  2. `paymentDate` must be a valid date (not in the future by more than 1 day — tolerance for timezone)
  3. Payments are **immutable** — no update or delete
- **Commands**: RecordPayment
- **Queries**: ListPayments (per customer)

### Value Objects

| VO | Purpose | Validation |
|----|---------|-----------|
| `CustomerPhoneVO` | Normalized phone + country code | E.164 format; strips spaces/dashes; default `+91` country code |
| `CreditLimitVO` | Non-negative credit limit (INR paise-level precision) | `>= 0`; max `9999999.99` |
| `PaymentScoreVO` | 0–100 score | `[0, 100]` inclusive |
| `CustomerNameVO` | Trimmed, non-empty name | 1–100 chars after trim |

### Domain Enums

```typescript
enum CustomerStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE'
}

enum PaymentMethod {
  CASH = 'CASH',
  ONLINE = 'ONLINE',
  UPI = 'UPI',
  OTHER = 'OTHER'
}
```

### Derived Concepts (not entities, computed at query time)

- **currentBalance**: `Σ(finalAmount for delivered DailySupply) + Σ(extraCharges) - Σ(payments)` scoped to all time for the customer under this vendor
- **creditUtilization**: `(currentBalance / creditLimit) * 100` — 0 when creditLimit = 0
- **paymentStatus**: derived from balance — `PAID` (balance ≤ 0), `PENDING` (0 < balance ≤ creditLimit), `OVERDUE` (balance > creditLimit)
- **monthlyBill**: per-month aggregation of deliveries + extra charges + previous balance

---

## 5. Prisma Schema Changes

### New Enums

```prisma
enum CustomerStatus {
  ACTIVE
  INACTIVE

  @@map("customer_status")
}

enum PaymentMethod {
  CASH
  ONLINE
  UPI
  OTHER

  @@map("payment_method")
}
```

### Modified Model: `Customer`

The existing `Customer` model (US-005 stub) gains new columns. Existing columns (`id`, `userId`, `name`, `phone`, `email`, `address`, `locality`, `autoMarkEnabled`, `lastLoginAt`, `createdAt`, `updatedAt`, `deletedAt`) are preserved.

```prisma
model Customer {
  id BigInt @id @default(autoincrement())

  // Existing fields preserved from US-005
  userId   BigInt? @map("user_id")
  name     String? @db.VarChar(100)
  phone    String  @unique @db.VarChar(15)
  email    String? @db.VarChar(100)
  address  String? @db.Text
  locality String? @db.VarChar(100)

  autoMarkEnabled Boolean   @default(true) @map("auto_mark_enabled")
  lastLoginAt     DateTime? @map("last_login_at")

  // US-008: New vendor-scoped fields
  // NOTE: vendor ownership is expressed via VendorCustomer join table (US-005 design).
  // The new fields below are added as nullable to preserve existing rows.
  phoneCountryCode    String         @default("+91") @map("phone_country_code") @db.VarChar(5)
  area                String?        @db.VarChar(100)
  languagePreference  String         @default("en") @map("language_preference") @db.VarChar(10)
  creditLimit         Decimal        @default(0) @map("credit_limit") @db.Decimal(10, 2)
  paymentScore        Decimal        @default(100) @map("payment_score") @db.Decimal(5, 2)
  customerSince       DateTime?      @map("customer_since") @db.Date
  status              CustomerStatus @default(ACTIVE)
  createdByUserId     BigInt?        @map("created_by_user_id")

  createdAt DateTime  @default(now()) @map("created_at")
  updatedAt DateTime  @updatedAt @map("updated_at")
  deletedAt DateTime? @map("deleted_at")

  user                User?                @relation(fields: [userId], references: [id], onDelete: SetNull)
  createdByUser       User?                @relation("CustomerCreatedBy", fields: [createdByUserId], references: [id], onDelete: SetNull)
  vendorCustomers     VendorCustomer[]
  referredVendorLinks VendorCustomer[]     @relation("VendorCustomerReferrer")
  supplyListCustomers SupplyListCustomer[]
  payments            Payment[]

  @@index([userId])
  @@index([phone])
  @@index([email])
  @@index([locality])
  @@index([status])
  @@index([deletedAt])
  @@map("customers")
}
```

### New Model: `Payment`

```prisma
model Payment {
  id BigInt @id @default(autoincrement())

  customerId        BigInt        @map("customer_id")
  vendorId          BigInt        @map("vendor_id")
  amount            Decimal       @db.Decimal(10, 2)
  paymentDate       DateTime      @map("payment_date") @db.Date
  paymentMethod     PaymentMethod @default(CASH) @map("payment_method")
  referenceNumber   String?       @map("reference_number") @db.VarChar(100)
  recordedByUserId  BigInt?       @map("recorded_by_user_id")

  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  customer       Customer @relation(fields: [customerId], references: [id], onDelete: Restrict)
  recordedByUser User?    @relation("PaymentRecordedBy", fields: [recordedByUserId], references: [id], onDelete: SetNull)

  @@index([customerId])
  @@index([vendorId])
  @@index([paymentDate])
  @@index([customerId, paymentDate])
  @@index([vendorId, customerId])
  @@map("payments")
}
```

### Back-relations on `User` (addition)

```prisma
// Add to User model:
customersCreated    Customer[]  @relation("CustomerCreatedBy")
paymentsRecorded    Payment[]   @relation("PaymentRecordedBy")
```

### Back-relation on `Vendor` (addition)

```prisma
// Add to Vendor model:
payments            Payment[]
```

---

## 6. API Endpoints

All endpoints are under `/api/v1/vendors/:vendorId/...`. Auth via JWT (`authenticate` middleware). `vendorId` sourced from JWT `roleContext` — URL param verified against it.

### EP-1: GET `/api/v1/vendors/:vendorId/customers`
- **CQS**: Query
- **Auth**: Owner or Staff
- **Description**: List customers with search, filter, pagination
- **Query Params**:
  - `search` (string, optional): search by name or phone (contains, case-insensitive)
  - `listId` (BigInt string, optional): filter by supply list membership
  - `status` (enum: `all|paid|pending|overdue`, optional, default `all`): filter by payment status
  - `page` (int, optional, default 1)
  - `limit` (int, optional, default 20, max 50)
- **Staff scope**: Only customers subscribed to staff's assigned lists
- **Response 200**:
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
  - **Note**: `monthlyTotal`, `paymentStatus`, `currentBalance`, `paymentScore` are **owner-only** — staff receives `null` for these fields
- **Errors**: 401, 403

### EP-2: POST `/api/v1/vendors/:vendorId/customers`
- **CQS**: Command
- **Auth**: Owner only
- **Description**: Create a new customer, optionally enroll in supply lists
- **Request Body**:
  ```json
  {
    "name": "Anil Kumar",
    "phone": "9876543210",
    "phoneCountryCode": "+91",
    "email": "anil@example.com",
    "address": "Flat 402, Tower B",
    "area": "Sector 15",
    "language": "hi",
    "supplyListIds": ["10", "11"],
    "startDate": "2026-04-12",
    "creditLimit": 5000,
    "sendInvite": false
  }
  ```
- **Validation**: `name` required (1–100), `phone` required (digits, 10 chars after stripping), `email` optional email, `supplyListIds` array of valid BigInt strings
- **Flow**: Create customer → Create `VendorCustomer` → Create `SupplyListCustomer` per listId → return DTO
- **Response 201**:
  ```json
  {
    "success": true,
    "data": { /* CustomerDetailDto */ }
  }
  ```
- **Errors**: 400, 401, 403, 409 (duplicate phone within vendor)

### EP-3: GET `/api/v1/vendors/:vendorId/customers/:customerId`
- **CQS**: Query
- **Auth**: Owner or Staff (staff: only if customer in assigned list)
- **Description**: Get full customer profile with subscriptions, current bill, payment history
- **Response 200**: `CustomerDetailDto` (see Section 8)
- **Errors**: 401, 403, 404

### EP-4: PATCH `/api/v1/vendors/:vendorId/customers/:customerId`
- **CQS**: Command
- **Auth**: Owner only
- **Description**: Update customer profile fields
- **Request Body** (all optional):
  ```json
  {
    "name": "Anil Kumar",
    "phone": "9876543210",
    "email": "...",
    "address": "...",
    "area": "...",
    "language": "hi",
    "status": "ACTIVE"
  }
  ```
- **Response 200**: Updated `CustomerDetailDto`
- **Errors**: 400, 401, 403, 404, 409

### EP-5: DELETE `/api/v1/vendors/:vendorId/customers/:customerId`
- **CQS**: Command
- **Auth**: Owner only
- **Description**: Soft-deactivate customer (status → INACTIVE, set `deletedAt`, end all active subscriptions)
- **Response 200**: `{ "success": true }`
- **Errors**: 401, 403, 404, 422 (already inactive)

### EP-6: GET `/api/v1/vendors/:vendorId/customers/:customerId/bill/:month`
- **CQS**: Query
- **Auth**: Owner only
- **Description**: Get monthly bill breakdown for a customer
- **Path Params**: `month` format `YYYY-MM`
- **Response 200**: `CustomerBillDto`
- **Errors**: 400 (invalid month format), 401, 403, 404

### EP-7: POST `/api/v1/vendors/:vendorId/customers/:customerId/payments`
- **CQS**: Command
- **Auth**: Owner only
- **Description**: Record a payment; reduces customer balance
- **Request Body**:
  ```json
  {
    "amount": 4350,
    "paymentDate": "2026-04-15",
    "paymentMethod": "UPI",
    "referenceNumber": "UPI123456"
  }
  ```
- **Validation**: `amount > 0`, `paymentDate` valid date (not future > 1 day), `paymentMethod` enum
- **Response 201**: `PaymentDto`
- **Errors**: 400, 401, 403, 404

### EP-8: GET `/api/v1/vendors/:vendorId/customers/:customerId/payments`
- **CQS**: Query
- **Auth**: Owner only
- **Description**: List all payments for a customer (reverse chronological)
- **Query Params**: `page`, `limit`
- **Response 200**: Paginated list of `PaymentDto`
- **Errors**: 401, 403, 404

### EP-9: PATCH `/api/v1/vendors/:vendorId/customers/:customerId/credit-limit`
- **CQS**: Command
- **Auth**: Owner only
- **Description**: Update credit limit for a customer
- **Request Body**: `{ "creditLimit": 6000 }`
- **Validation**: `creditLimit >= 0`
- **Response 200**: `{ "success": true, "data": { "creditLimit": 6000, "creditUtilization": 72 } }`
- **Errors**: 400, 401, 403, 404

### EP-10: GET `/api/v1/vendors/:vendorId/customers/:customerId/calendar/:month`
- **CQS**: Query
- **Auth**: Owner or Staff (staff: only if customer in assigned list)
- **Description**: Get delivery calendar for customer for the given month
- **Path Params**: `month` format `YYYY-MM`
- **Response 200**: `CustomerCalendarDto`
- **Errors**: 400, 401, 403, 404

### EP-11: POST `/api/v1/vendors/:vendorId/customers/:customerId/subscriptions`
- **CQS**: Command
- **Auth**: Owner only
- **Description**: Add customer to an additional supply list
- **Request Body**: `{ "supplyListId": "15", "startDate": "2026-05-01", "customQuantity": null, "customRatePerUnit": null }`
- **Response 201**: `SubscriptionDto`
- **Errors**: 400, 401, 403, 404, 409 (already subscribed)

### EP-12: DELETE `/api/v1/vendors/:vendorId/customers/:customerId/subscriptions/:subscriptionId`
- **CQS**: Command
- **Auth**: Owner only
- **Description**: Remove customer from supply list (sets `endDate = today`, `isActive = false`)
- **Response 200**: `{ "success": true }`
- **Errors**: 401, 403, 404, 422 (already ended)

---

## 7. Module Structure

```
src/modules/customer/
├── domain/
│   ├── customer.entity.ts          # CustomerEntity aggregate root
│   ├── customer.errors.ts          # CustomerNotFoundError, CustomerConflictError, etc.
│   ├── customer.types.ts           # CustomerProps, CreateCustomerProps, CustomerStatus
│   ├── value-objects/
│   │   ├── customer-phone.vo.ts    # Normalized phone + country code
│   │   ├── credit-limit.vo.ts      # Non-negative credit limit
│   │   ├── payment-score.vo.ts     # 0-100 score
│   │   └── customer-name.vo.ts     # Trimmed non-empty name
│   └── events/
│       ├── customer-created.domain-event.ts
│       ├── customer-deactivated.domain-event.ts
│       └── payment-recorded.domain-event.ts
│
├── commands/
│   ├── create-customer/
│   │   ├── create-customer.command.ts      # CreateCustomerCommand.execute()
│   │   └── create-customer.request.dto.ts
│   ├── update-customer/
│   │   └── update-customer.command.ts      # UpdateCustomerCommand.execute()
│   ├── deactivate-customer/
│   │   └── deactivate-customer.command.ts  # DeactivateCustomerCommand.execute()
│   ├── update-credit-limit/
│   │   └── update-credit-limit.command.ts  # UpdateCreditLimitCommand.execute()
│   ├── record-payment/
│   │   └── record-payment.command.ts       # RecordPaymentCommand.execute()
│   ├── add-subscription/
│   │   └── add-subscription.command.ts     # AddSubscriptionCommand.execute()
│   └── remove-subscription/
│       └── remove-subscription.command.ts  # RemoveSubscriptionCommand.execute()
│
├── queries/
│   ├── list-customers/
│   │   └── list-customers.query.ts         # ListCustomersQuery.execute()
│   ├── get-customer/
│   │   └── get-customer.query.ts           # GetCustomerQuery.execute()
│   ├── get-customer-bill/
│   │   └── get-customer-bill.query.ts      # GetCustomerBillQuery.execute()
│   ├── get-customer-calendar/
│   │   └── get-customer-calendar.query.ts  # GetCustomerCalendarQuery.execute()
│   └── list-payments/
│       └── list-payments.query.ts          # ListPaymentsQuery.execute()
│
├── database/
│   ├── customer.repository.port.ts         # ICustomerRepository interface
│   └── customer.repository.ts             # PrismaCustomerRepository adapter
│
├── customer.mapper.ts                      # toPersistence / toDomain / toResponse
├── customer.types.ts                       # DTOs: CustomerDto, CustomerDetailDto, PaymentDto, etc.
├── customer.validator.ts                   # Zod schemas for all endpoints
├── customer.controller.ts                  # 12 HTTP handlers (thin)
├── customer.routes.ts                      # Composition root, middleware chain
└── __tests__/
    ├── customer.commands.test.ts           # Unit tests for all commands
    ├── customer.queries.test.ts            # Unit tests for queries
    └── domain/
        ├── customer.entity.test.ts
        └── value-objects.test.ts
```

---

## 8. Service Layer Design

### Commands

**CreateCustomerCommand**
1. Validate phone uniqueness for vendor (via `ICustomerRepository.findByPhone`)
2. `CustomerEntity.create(props)` — constructs VOs, validates invariants
3. In a transaction: insert customer → insert `VendorCustomer` → insert `SupplyListCustomer` rows for each `supplyListId`
4. If `sendInvite = true`: log intent to `AuditLog` (no external call — OQ-1)
5. Return `CustomerDetailDto`

**UpdateCustomerCommand**
1. Load customer, verify `vendorId` ownership (via `VendorCustomer`)
2. Call `entity.update(patch)` — re-validates invariants; phone uniqueness re-checked if phone changed
3. Persist

**DeactivateCustomerCommand**
1. Load customer, verify ownership
2. `entity.deactivate()` — sets `status = INACTIVE`, `deletedAt = now()`
3. End all active subscriptions: `SupplyListCustomer.update({ endDate: today, isActive: false }) WHERE customerId AND isActive = true`
4. All in one transaction

**UpdateCreditLimitCommand**
1. Load customer, verify ownership
2. `entity.updateCreditLimit(newLimit)` — validates `>= 0`
3. Persist, return updated utilization

**RecordPaymentCommand**
1. Verify customer belongs to vendor
2. `PaymentEntity.create({ amount, paymentDate, paymentMethod, referenceNumber, customerId, vendorId, recordedByUserId })`
3. Insert payment row
4. Return `PaymentDto`

**AddSubscriptionCommand**
1. Verify customer + supply list both belong to the same vendor
2. Check no active subscription already exists for (supplyListId, customerId) — if exists throw 409
3. Insert `SupplyListCustomer` row
4. Return `SubscriptionDto`

**RemoveSubscriptionCommand**
1. Load `SupplyListCustomer`, verify it belongs to customer + vendor
2. Check it is currently active — if not throw 422
3. Set `endDate = today`, `isActive = false`

### Queries

**ListCustomersQuery**
- Joins: `Customer JOIN VendorCustomer` (scope to vendor) + optional `JOIN SupplyListCustomer JOIN SupplyList` (for list names + listId filter)
- For staff: further filter by `SupplyListCustomer.supplyListId IN (staff's assigned lists)`
- For each customer:
  - Compute `currentBalance` = balance from `DeliveryBillingPort.getCustomerBalance(customerId, vendorId)` — calls raw SQL aggregation
  - Derive `paymentStatus` from balance vs creditLimit
  - Aggregate `monthlyTotal` = sum of `finalAmount` in current month's `DailySupply`
- Owner sees balance/status/monthlyTotal; staff sees nulls for these fields
- `paymentStatus` filter applied post-balance-computation (or as a HAVING clause in SQL)

**GetCustomerQuery**
- Full detail: customer profile + all active subscriptions (with list names, custom rate/qty) + current month bill summary + payment history (last 12 entries)
- staff guard: must have at least one subscription in staff's assigned lists

**GetCustomerBillQuery**
- Parse `YYYY-MM` month param
- Aggregate `DailySupply` for that customer + month: group by supplyListId → count deliveries, sum finalAmount
- Aggregate `SupplyExtraCharge` (via dailySupplyId) for that month
- Compute `previousDue` = balance as of the first day of the given month (sum all delivered supply + extra charges - payments up to the month start)
- Return `CustomerBillDto`

**GetCustomerCalendarQuery**
- Parse `YYYY-MM`
- Query all `DailySupply` rows for customer for that month (across all subscriptions)
- Return per-day map: `{ "2026-04-01": [{ listName, quantity, unit, status, amount }] }`

**ListPaymentsQuery**
- Simple paginated query on `Payment` filtered by `customerId + vendorId`

### Cross-module wiring

**DeliveryBillingPort** (defined in `customer/ports/delivery-billing.port.ts`):
```typescript
export interface IDeliveryBillingPort {
  getCustomerBalance(customerId: bigint, vendorId: bigint): Promise<number>;
  getMonthlyDeliveries(customerId: bigint, vendorId: bigint, month: string): Promise<MonthlyDeliveryRow[]>;
  getCustomerDailySupplies(customerId: bigint, vendorId: bigint, from: Date, to: Date): Promise<DailySupplyRow[]>;
}
```

**DeliveryBillingAdapter** (in `customer/adapters/delivery-billing.adapter.ts`) implements this port using raw Prisma queries — does NOT import delivery module entities.

---

## 9. Validation Rules

### EP-2 Create Customer (`.strict()`)
```typescript
z.object({
  name: z.string().trim().min(1).max(100),
  phone: z.string().regex(/^\d{10}$/, 'Phone must be 10 digits'),
  phoneCountryCode: z.string().regex(/^\+\d{1,4}$/).default('+91'),
  email: z.string().email().optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  area: z.string().max(100).optional().nullable(),
  language: z.string().max(10).optional().default('en'),
  supplyListIds: z.array(z.string().regex(/^\d+$/)).optional().default([]),
  startDate: z.string().date().optional(),
  creditLimit: z.number().min(0).max(9999999.99).optional().default(0),
  sendInvite: z.boolean().optional().default(false),
})
```

### EP-4 Update Customer (`.strict()`)
All fields optional; same rules as create for each field. `status` accepts `z.nativeEnum(CustomerStatus)`.

### EP-7 Record Payment (`.strict()`)
```typescript
z.object({
  amount: z.number().positive('Amount must be positive'),
  paymentDate: z.string().date(),
  paymentMethod: z.nativeEnum(PaymentMethod),
  referenceNumber: z.string().max(100).optional().nullable(),
})
```

### EP-9 Credit Limit (`.strict()`)
```typescript
z.object({
  creditLimit: z.number().min(0).max(9999999.99),
})
```

### EP-11 Add Subscription (`.strict()`)
```typescript
z.object({
  supplyListId: z.string().regex(/^\d+$/),
  startDate: z.string().date().optional(),
  customQuantity: z.number().positive().optional().nullable(),
  customRatePerUnit: z.number().positive().optional().nullable(),
})
```

### Query schemas (`.passthrough()`)
All GET endpoints with query params use `.passthrough()` and validate: `page` (int ≥ 1), `limit` (int 1–50), `search` (string), `listId` (BigInt string), `status` (`all|paid|pending|overdue`), `month` (YYYY-MM pattern).

---

## 10. Swagger/OpenAPI

**Tag**: `Customers`

| Endpoint | Summary |
|----------|---------|
| GET /vendors/:vendorId/customers | List customers with search, filter, and payment-status |
| POST /vendors/:vendorId/customers | Create a new customer |
| GET /vendors/:vendorId/customers/:customerId | Get customer full detail |
| PATCH /vendors/:vendorId/customers/:customerId | Update customer profile |
| DELETE /vendors/:vendorId/customers/:customerId | Deactivate customer |
| GET /vendors/:vendorId/customers/:customerId/bill/:month | Get monthly bill for customer |
| POST /vendors/:vendorId/customers/:customerId/payments | Record a payment |
| GET /vendors/:vendorId/customers/:customerId/payments | List payment history |
| PATCH /vendors/:vendorId/customers/:customerId/credit-limit | Update credit limit |
| GET /vendors/:vendorId/customers/:customerId/calendar/:month | Get delivery calendar for month |
| POST /vendors/:vendorId/customers/:customerId/subscriptions | Add customer to another supply list |
| DELETE /vendors/:vendorId/customers/:customerId/subscriptions/:subscriptionId | Remove customer from supply list |

---

## 11. Open Questions

### OQ-1: WhatsApp Invite Integration
- **Context**: US-008 specifies `sendInvite: true` should send a WhatsApp invite. No WhatsApp API credentials are configured in this project.
- **Recommendation**: In this iteration, accept `sendInvite` field and log it to `AuditLog` (`action: 'CUSTOMER_INVITE_QUEUED'`). Implement the actual WhatsApp dispatch in a follow-up task once the Twilio/WhatsApp credentials story is defined.
- **Trade-off**: Customer is created successfully in both cases. Invite delivery is deferred. Frontend should not show "invite sent" confirmation — just acknowledge the intent.

### OQ-2: Payment Score Algorithm
- **Context**: The US describes a score based on "late payments, overdue amount, on-time payments" but gives no concrete algorithm.
- **Recommendation**: For this iteration, `paymentScore` is stored but not auto-recalculated on payment recording. It defaults to 100 on creation and can be manually updated via `PATCH /customers/:id` if needed. A proper scoring algorithm can be designed in a follow-up.
- **Trade-off**: Defers complexity; existing schema column is preserved and visible in responses.

### OQ-3: `VendorCustomer` vs direct `vendorId` on `Customer`
- **Context**: The existing schema uses a `VendorCustomer` join table to associate customers with vendors (multi-vendor customer sharing). The US-008 user story treats customers as vendor-owned.
- **Recommendation**: Keep the `VendorCustomer` pattern — it aligns with the multi-vendor architecture. All customer queries will always join through `VendorCustomer` to scope by vendor. The new `Customer` columns (creditLimit, paymentScore, status) are global to the customer, not per-vendor. This is a known limitation.
- **Trade-off**: A customer deactivated by one vendor is deactivated globally. Acceptable for the current single-vendor use case; a per-vendor status field can be added to `VendorCustomer` in a future iteration.

### OQ-4: `currentBalance` query performance
- **Context**: Computing balance for every customer in the list query requires summing DailySupply + extra charges + payments per customer. For 500+ customers this could be slow.
- **Recommendation**: Use a single aggregated SQL query (`GROUP BY customerId`) to fetch all balances for the requested page in one round-trip (not N+1). The `DeliveryBillingAdapter.getBulkBalances(customerIds, vendorId)` method returns a map.
- **Trade-off**: The query is more complex but avoids N+1. Caching can be added later if profiling shows it's slow.

### OQ-5: Phone uniqueness scope
- **Context**: Current `Customer` model has a global `@unique` on `phone`. The US-008 spec says uniqueness should be per-vendor. These conflict.
- **Recommendation**: Keep the global unique constraint for now (removing it would require a migration that drops the existing index). The service layer performs a vendor-scoped uniqueness check before insert and returns 409 if a conflict exists within the vendor. The global DB constraint is stricter than needed but prevents data corruption.
- **Trade-off**: A phone number genuinely used by two different vendor customers (edge case in a shared-customer multi-vendor system) would be rejected. This is acceptable for the current single-vendor per-customer model.
