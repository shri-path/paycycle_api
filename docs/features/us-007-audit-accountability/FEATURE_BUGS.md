# Feature Bugs — Audit & Accountability (US-007)

## Bug Template
### BUG-[number]: [Short title]
- **Severity**: Critical / High / Medium / Low
- **Endpoint**: `METHOD /path`
- **Steps to Reproduce**: ...
- **Expected**: ...
- **Actual**: ...
- **Root Cause**: Architecture / Implementation / Missing validation
- **Status**: Open / Fixed / Verified / Won't Fix

---

## Summary

QA found **no functional bugs** in the audit feature. 16/16 unit + 14/14 live-DB
integration tests pass; build + lint (src) clean.

### Review-phase finding (fixed before QA)

### BUG-001: Contradictory where-clause when `customerId` + `entityType` combined
- **Severity**: Low
- **Endpoint**: `GET /vendors/:vendorId/audit-logs`
- **Steps to Reproduce**: Call with both `customerId=X` and `entityType=daily_supply`.
- **Expected**: Filters are consistent (customer scoping wins).
- **Actual**: `entityType` overwrote the customer filter's `entityType=customer` while
  `entityId` stayed pinned to the customer id → query silently matched nothing.
- **Root Cause**: Implementation (`buildWhere` ordering in `audit.repository.ts`).
- **Status**: Fixed (customer scoping now takes precedence; standalone `entityType`
  applies only when `customerId` absent — `else if`).

## Out-of-scope (pre-existing, not US-007)
Pre-existing `tests/integration/{customer,staff-edge,delivery,...}.test.ts` failures are
caused by drifted request fixtures against tightened schemas from earlier stories — they
fail before any audit code runs. Tracked for a separate fixture-refresh task.
