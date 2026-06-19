# QA Report — US-15.4 Customer Invite Auto-Resend Cron

**Verdict: PASS**

## Gates
- `npm run lint`: **0 errors** (only pre-existing repo-wide `explicit-function-return-type`
  warnings; none are regressions from this change).
- `npm run build` (`tsc`): **clean**.
- `npx jest` (full suite): **1480 passed**, 118 failed across **5 failed suites** — all five are
  the DB-dependent `tests/integration/*` suites (`customer`, `supply-list`, `subscription`,
  `delivery`, `staff-edge`) that fail identically on base `main` (no live Postgres in this env).
  Zero referral/cron failures; zero new regressions.
- Referral subset (`npx jest src/modules/referral`): **157 passed, 16 suites** (incl. the 11 new
  tests below).

## Acceptance criteria coverage
| AC | Covered by |
|----|-----------|
| Resend after 7 days, no response | `find-invites-due-for-resend.test.ts` (7-day `lastAttemptAt` window predicate) |
| Stop at `max_attempts` → mark FAILED | `invite-resend-sweep.test.ts` "marks FAILED when the resend reaches max_attempts" |
| Each resend bumps attempt + last_attempt_at | `invite-resend-sweep.test.ts` "resends a due invite and increments the attempt" + adapter `incrementInviteAttempt` |
| Signed-up / failed excluded | `find-invites-due-for-resend.test.ts` (status `IN (SENT, DELIVERED)` predicate) + in-memory `attempt < max` filter |
| Runs only when `ENABLE_CRON=true` | registration unchanged (existing `ENABLE_CRON` guard) |
| Logs start/processed/failed + correlationId | sweep emits `logger.child({ correlationId })` start/complete with counts |
| Bounded batches | `invite-resend-sweep.test.ts` "passes the configured batch size to the bounded query" + adapter `take: limit` |

## Edge cases tested
- Transport failure still increments the attempt (anti-spam termination) — PASS.
- One invite throwing does not abort the batch — PASS.
- Vendor with no referral code skipped without mutation — PASS.
- Bounded-query failure swallowed (sweep never throws) — PASS.
- Per-vendor referral-code lookup cached within a run — PASS.

## New tests (11)
- `__tests__/cron/invite-resend-sweep.test.ts` (8) — resend orchestration via the injectable
  `runInviteResendSweep(deps)` seam.
- `__tests__/database/find-invites-due-for-resend.test.ts` (3) — bounded due-for-resend SELECT
  predicates, ordering, limit, and in-memory max-attempts filter (prisma client mocked).

## Notes
Full HTTP integration (seed overdue invites → run sweep → observe attempt advance until FAILED)
requires a live Postgres, which is unavailable in this environment. The run-by-run progression
is verified deterministically at the unit level (the `attemptCount: 2 / max: 3` case proves the
final attempt transitions the invite to FAILED).
