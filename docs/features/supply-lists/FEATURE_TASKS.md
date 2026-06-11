# Feature Tasks: Supply Lists Management (US-005)

## Complexity: Complex — Skills to follow
`ddd-module-design.md`, `domain-modeling.md`, `prisma-schema-design.md`, `validation-schemas.md`, `repository-implementation.md`, `service-implementation.md`, `module-scaffold.md`, `error-handling.md`, `testing-strategy.md`.

## Parallel Workstream Plan

> Each Phase starts only after all streams in the prior phase complete.
> Streams within a phase own non-overlapping files and run simultaneously.
> Module root: `src/modules/supply-list/`.

---

### Phase 1 (parallel — no cross-stream dependencies)

#### Stream A: Data Foundation
**Files owned**: `prisma/schema.prisma`, `prisma/migrations/`, `prisma/seeds/index.ts`
**Skills**: `prisma-schema-design.md`
- **Task A1**: Add Prisma models matching db-design exactly: `Customer`→`customers`, `VendorCustomer`→`vendor_customers` (enums `VendorCustomerStatus`, `AcquisitionSource`), `SupplyList`→`supply_lists` (enum `SupplyFrequency`), `SupplyListStaff`→`supply_list_staff`, `SupplyListSchedule`→`supply_list_schedule`, `SupplyListCustomer`→`supply_list_customers`. Add back-relations + index on `VendorUser` for `supply_list_staff`. Mandatory indexes: `deletedAt`, FKs, `vendorId`, plus composites `supply_lists(vendor_id,is_active)` and `supply_list_customers(supply_list_id,is_active)`. FK policies per db-design (RESTRICT cross-aggregate, CASCADE owned children, SetNull audit refs).
- **Task A2**: Create migration `add_supply_lists_and_customers` (tables ordered customers → vendor_customers → supply_lists → staff/schedule → supply_list_customers). Run `db:generate`.
- **Task A3**: Seed permissions — add `list:read`, `list:delete`, `list:assign_staff`, `subscription:read`, `subscription:write` (reuse existing `list:create`/`list:edit`); assign read-side to `vendor_staff`, all to `vendor_owner`. Add faker dev data: customers + vendor_customers, supply lists (DAILY + WEEKLY), staff assignments (1 primary each), subscriptions with default + custom-override mix. Idempotent upserts.

#### Stream B: Domain Core
**Files owned**: `src/modules/supply-list/domain/**`, `src/modules/supply-list/supply-list.types.ts`
**Skills**: `domain-modeling.md`
- **Task B1**: Value objects — `SupplyUnit`, `SupplyFrequency` (+ schedule rules, discriminated), `Quantity`, `RateMoney`, `TimeOfDay`, `DateRange`, `SubscriptionStatus` (transition guard). Guard clauses per DOMAIN_MODEL.md.
- **Task B2**: `SupplyListEntity` (root) — factory `create`/`reconstitute`, behaviors `updateDetails/archive/assignStaff/unassignStaff/setPrimary`, invariants in `validate()` (≤1 primary, primary∈assigned, unit/frequency/schedule). Owns `SupplyListStaff`/`SupplyListSchedule` props.
- **Task B3**: `SubscriptionEntity` (root) — factory, behaviors `updatePricing/pause/resume/end`, `effectiveQuantity/effectiveRate/amount` helpers, invariants.
- **Task B4**: Domain events (9) + `supply-list.errors.ts` (extend `ExceptionBase`); shared types/DTO shapes (`SupplyListDto`, `SupplyListListDto`, `SubscriptionDto` whitelists).

#### Stream C: Validation Layer
**Files owned**: `src/modules/supply-list/supply-list.validator.ts`
**Skills**: `validation-schemas.md`
- **Task C1**: Zod schemas — **strict** mutation bodies (create/update list as discriminated union on `frequency`; assign-staff; add-customers with qty/rate refine; update/end subscription), **passthrough** query schemas (list, customers, available-customers), param schemas (`vendorIdParam`, `listIdParam`, `subscriptionIdParam`, `staffIdParam`). Use `z.nativeEnum` for `SupplyFrequency`/status; `primaryStaffId ∈ staffIds` refine; ≥1-field refine on PATCH.

---

### Phase 2 (parallel — after Phase 1)

#### Stream D: Data Access Layer
**Files owned**: `src/modules/supply-list/database/**`
**Skills**: `repository-implementation.md`
**Depends on**: A (schema), B (domain types)
- **Task D1**: Ports — `supply-list.repository.port.ts`, `subscription.repository.port.ts` (method signatures incl. tenant-scoped `findById(id, vendorId)`, `insert` with nested staff/schedule in tx, `insertMany` subscriptions, `findActiveSubscriptionCustomerIds`, count/projection queries).
- **Task D2**: Prisma adapters — soft-delete filters (`deletedAt: null`), P2002 → `ConflictError`, focused updates, transactional create (list+staff+schedule), batched loads for `assignedStaff` and `otherLists` (no N+1).
- **Task D3**: Mappers — `supply-list.mapper.ts` + `subscription.mapper.ts` (`toDomain`/`toPersistence`/`toResponse` with field whitelist; `status` derivation; `amount` via domain helper; BigInt→string).

#### Stream E: Ports, Adapters & Application Services
**Files owned**: `src/modules/supply-list/ports/**`, `src/modules/supply-list/adapters/**`, `src/modules/supply-list/commands/**`, `src/modules/supply-list/queries/**`
**Skills**: `service-implementation.md`
**Depends on**: B (domain), port interfaces from DOMAIN_MODEL.md (available now)
- **Task E1**: Owned ports — `StaffDirectoryPort`, `CustomerDirectoryPort`, `DeliveryStatsPort`; adapters — `staff-directory.adapter.ts` (reads `vendor_users`/`users`), `customer-directory.adapter.ts` (reads `customers`/`vendor_customers`), `delivery-stats-zero-stub.adapter.ts`.
- **Task E2**: ACL adapters implementing **staff** ports — `supply-list-assignment-read.adapter.ts` (`ListAssignmentPort`), `supply-list-assignment-write.adapter.ts` (`ListAssignmentWritePort`) over `supply_list_staff` (assign/unassign/setPrimary/countAssignedLists/getAssignedListIds/isAssignedToList/isCustomerInAssignedList/unassignAll), mapping P2002→ConflictError.
- **Task E3**: Command services — create/update/archive list, assign/unassign staff, add-customers, update/end subscription. CQS, entity factories, mapper calls, multi-tenant guard, StaffDirectory/CustomerDirectory validation, `AuditLogger`, domain-event publication.
- **Task E4**: Query services — list-supply-lists (owner-all / staff-assigned), get-supply-list, list-list-customers, list-available-customers; batched projections; DeliveryStatsPort for stats.

---

### Phase 3 (parallel — after Phase 2)

#### Stream F: Interface Layer + cross-module wiring
**Files owned**: `src/modules/supply-list/supply-list.controller.ts`, `src/modules/supply-list/supply-list.routes.ts`, `src/app.ts`, `src/modules/staff/staff.routes.ts`
**Skills**: `module-scaffold.md` (Steps 5–9)
**Depends on**: C (validators), D (repos/mappers), E (services/adapters)
- **Task F1**: Controller — arrow methods, try/catch → `next(error)`, `vendorId`/`actorUserId` from JWT role context, correlationId propagation.
- **Task F2**: Routes (composition root) — wire repos, ports, stub + real adapters, services, controller. Middleware chain `authenticate → validate → identifyUserRole → requireOwnerRole|canViewSupplyList → controller`. Mount on `/api/v1/vendors`. Per-vendor rate limiting consistent with staff routes.
- **Task F3**: Register module in `src/app.ts`; Swagger annotations for all 12 endpoints. **Rewire `staff.routes.ts`**: replace `ListAssignmentStubAdapter`/`ListAssignmentWriteStubAdapter` with the US-005 real adapters (OQ-6). Confirm staff `assign-list`/`unassign-list` no longer 503.

#### Stream G: Tests
**Files owned**: `src/modules/supply-list/__tests__/**`, `tests/integration/supply-list.test.ts`
**Skills**: `testing-strategy.md`
**Depends on**: all prior streams
- **Task G1**: Unit — VOs (guards, transitions, discriminated frequency), entity factories/invariants (≤1 primary, primary∈assigned, amount override-first, status transitions), mapper whitelist (no `deletedAt` leak, status derivation), services with mocked ports (StaffDirectory 422, CustomerDirectory 422, dedupe 409, tenant 404-mask).
- **Task G2**: Integration — full HTTP lifecycle for all 12 endpoints; auth/RBAC (owner vs assigned-staff vs unassigned-staff 404-mask); multi-tenant isolation; correlationId in errors; bulk add (added/skipped); archive vs delete; edge cases #1–#10.
- **Task G3**: Regression — run staff suite with real adapters wired; assert `assign-list`/`unassign-list` now perform real writes and `StaffRemoved`→`unassignAll` clears `supply_list_staff`.

---

## Scaling notes
- Phase 2 Stream E is large; if needed split E2 (ACL adapters) and E3/E4 (services) into two agents — they own disjoint files (`adapters/` vs `commands/` + `queries/`).
- Stream F owns the only cross-module edit (`staff.routes.ts`) — keep it single-agent to avoid conflicts with the staff module.
</content>
