# QA Report — Audit & Accountability (US-007)

> Verdict: **PASS** — feature endpoints fully green on unit + live-DB integration.

## Test execution

| Suite | Result |
|-------|--------|
| `src/modules/audit/__tests__/audit.query.test.ts` (unit) | **16/16 pass** |
| `tests/integration/audit.test.ts` (live DB) | **14/14 pass** |
| Full unit suite (excl. integration) | **449/449 pass** |
| `npm run build` | clean (exit 0) |
| `npm run lint` (src) | 0 errors (29 pre-existing warnings in untouched files) |

## Acceptance criteria coverage

1. **Audit logging** — writes already exist (US-002..US-008); US-007 surfaces them.
   - Timeline shows every logged action with user/timestamp/details ✓
   - Immutability preserved — no write/update/delete path added ✓ (verified by absence;
     module exposes only read queries + a CSV export Command)
2. **Activity timeline** — owner view with filters (staff/customer/action/entity/date) ✓
   - timestamp, user name, action label, customer/supply-list resolved ✓
   - staff vs owner role label ✓
3. **Conflict detection** — `GET /audit-logs/conflicts` derives staff-vs-override
   contradictions from `supply_overrides`, with `by` (owner/customer) and
   `timeDiffMinutes` ✓ (unit-tested mapping; integration returns the array shape)
4. **Export** — `POST /audit-logs/export` returns CSV (`text/csv`, attachment), ≤10k rows,
   only `format:csv` accepted (`pdf` → 400) ✓
5. **Performance** — all reads on existing indexes; batched (N+1-free) enrichment;
   pagination clamps limit ≤100; conflicts/my-activity capped ✓

## Security / RBAC (verified by integration tests)

- 401 + correlationId without/with bad token ✓
- 404 mask for wrong-tenant access ✓
- 403 for staff on owner-only endpoints (conflicts / staff-summary / export) ✓
- Staff `audit-logs` self-scoped (only own `user.id`); `ipAddress` hidden from staff ✓

## Findings

No bugs found in the audit feature. See FEATURE_BUGS.md.

### Out-of-scope note (NOT US-007 regressions)
Running the full `tests/integration/` set shows pre-existing failures in
`customer.test.ts`, `staff-edge.test.ts`, `delivery.test.ts` (and related). Root cause:
those suites send outdated request payloads (e.g. `ratePerUnit` instead of the
strict-schema `defaultRatePerUnit`, and the old accept-invite shape) that earlier merged
stories' schemas have since tightened. These fail at signup / supply-list creation —
before any audit code runs — and are unaffected by US-007 (which only adds the `audit`
module, an idempotent `audit:read` seed row, and one `app.ts` route registration).
The new `audit.test.ts` was written against the current schemas and passes. Recommend a
separate housekeeping task to refresh the drifted integration fixtures.

## Verdict
**PASS — ready to commit and open PR.**
