# Review Report — Audit & Accountability (US-007)

> Reviewer pass over the implementation on `feat/us-007-audit-accountability`.
> Verdict: **APPROVE** (after fixing MINOR-1).

## Scope reviewed
`src/modules/audit/` (types, shared, validator, repository.port, repository, reader,
4 queries, 1 command, controller, routes), `src/app.ts` registration, `prisma/seeds`
`audit:read` addition, unit tests, integration tests.

## Architecture compliance
- **Dependency rule** ✓ — `audit.repository.port.ts` and all query/command/type files are
  framework-free (plain types). Only `audit.repository.ts` (adapter) and `audit.reader.ts`
  import Prisma — correct (infrastructure layer).
- **commands/ + queries/ split** ✓ — mandatory per MEMORY.md; present.
- **CQS** ✓ — 4 read-only queries; export is the only Command (produces a CSV payload).
- **Multi-tenant isolation** ✓ — every repository method scoped by `vendorId`;
  wrong-tenant masked as 404 by `identifyUserRole`.
- **No new write path to audit_logs** ✓ — immutability preserved (acceptance 1.5).
- **N+1-free enrichment** ✓ — batched Map-keyed reads in `AuditReader`, mirroring
  `DeliveryReader`.
- **Response envelope** ✓ — `sendSuccess`; CSV export sets explicit headers.
- **Validation at boundary** ✓ — Zod (`passthrough` queries, `strict` export body,
  `format` literal `'csv'`).

## Findings

### MINOR-1 (FIXED): contradictory where-clause when `customerId` + `entityType` combined
`buildWhere` set `entityType='customer'`+`entityId=<customerId>` for the customer filter,
then an explicit `entityType` filter overwrote `entityType` while `entityId` stayed pinned
to the customer id — yielding a query that silently matches nothing.
**Fix**: customer scoping now wins; the standalone `entityType` filter only applies when
`customerEntityId` is unset (`else if`). Comment added.

### MINOR-2 (Accepted / by design): system rows with null role
`distinctStaff` excludes `performedByRole = 'vendor_owner'` and null `performedByUserId`.
A hypothetical system action with a null role but non-null user could appear in the staff
facet. No such writer exists today (system writes use null user); left as-is.

### INFO-1: read-time conflict derivation (OQ-1)
Conflicts are derived live from `supply_overrides` (cap 100, `take cap*4` headroom) instead
of a materialized view. Bounded and indexed; meets the <2s criterion. Documented in
FEATURE_PLAN OQ-1.

### INFO-2: inline Map type in `list-audit-logs.query.ts toView`
`toView` parameter types the `deliveryRefs` Map inline rather than reusing
`DeliveryEntityRefs`. Cosmetic; not changed to keep the diff minimal.

## Tests
- 16 unit tests pass (helpers, all 4 queries, export command; owner/staff scoping,
  ipAddress masking, conflict mapping, summary aggregation, my-activity counts).
- Integration suite (`tests/integration/audit.test.ts`) covers auth/RBAC/multi-tenant/
  CSV/validation; DB-gated (skips cleanly when DB unavailable).
- Full unit suite: **449/449 pass**, build + lint (src) clean.

## Verdict
**APPROVE** — proceed to QA.
