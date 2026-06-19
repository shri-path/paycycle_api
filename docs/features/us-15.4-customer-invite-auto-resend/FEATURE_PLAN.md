# Feature: Customer Invite Auto-Resend Cron (US-15.4)

> One of six follow-ups (US-15.1 … US-15.6) from the US-014 Referral Engine NFR audit.
> Backend-only. No frontend component, no API contract change, no schema migration.

## Complexity Assessment
- **Tier**: Simple (surgical change to the existing Complex `referral` bounded context).
- **Justification**: Implements one previously no-op cron body (`InviteResendSweep`) plus one
  new bounded repository read method. No new aggregate, entity, value object, endpoint, or
  table. Reuses the existing `IInviteMessagePort` (stub adapter) and existing invite columns
  (`attempt_count` / `max_attempts` / `last_attempt_at`).
- **Directory**: existing `src/modules/referral/` — `referral.cron.ts`,
  `database/referral.repository.ts`, `database/referral.repository.port.ts`.

## Background
The US-014 audit found `InviteResendSweep` (`referral.cron.ts`) was a logged no-op stub, so the
US-014 ACs "Auto-resend after 7 days if no response" and "Stop after 3 attempts (avoid spam)"
were unmet. The data model and per-vendor repo helpers existed but were never wired into a sweep.

## What changed
1. **`IReferralRepository.findInvitesDueForResendBatch(limit)`** (new port method + Prisma adapter)
   — global (all vendors), bounded, oldest-first due-for-resend query:
   - `status IN (SENT, DELIVERED)` → excludes `SIGNED_UP` / `FAILED`
   - `autoResend = true`
   - `lastAttemptAt <= now - 7d` (UTC, consistent with sibling sweeps)
   - `attemptCount < maxAttempts` (applied in memory — Prisma cannot compare two columns)
   - `deletedAt = null`
   - `take: limit` after `orderBy lastAttemptAt asc`
   The existing per-vendor `findInvitesDueForResend(vendorId)` is left untouched (back-compat).
2. **`runInviteResendSweep`** body implemented (was a no-op). Mirrors `runMilestoneSweep` /
   `runClawbackSweep`: per-run `crypto.randomUUID()` correlationId, `logger.child`, outer
   try/catch (never throws), structured `start` / `complete` logs with
   `processed / resent / failedOut / errored / batchSize`. Made injectable
   (`InviteResendSweepDeps`) for unit testing; production registration uses the module
   singletons via defaults.
3. Per-invite logic (each in its own try/catch so one failure never aborts the batch):
   - Resolve the vendor's referral code (cached per vendor per run); skip with a warning if absent.
   - Send via `IInviteMessagePort` (stub transport) with a reminder body + join link.
   - In one transaction: `incrementInviteAttempt` (bumps `attempt_count` + `last_attempt_at`);
     if the new attempt count `>= maxAttempts`, `updateInviteStatus(..., 'FAILED')` (anti-spam stop).
   - Increment happens **regardless of transport success** (edge case #3) so a permanently
     failing transport still terminates at max attempts.
4. **Batch cap** `INVITE_RESEND_BATCH_SIZE = 100` — bounds the per-run scan/send; large backlogs
   drain across successive daily runs. Deliberately compatible with US-15.5's future ≤50/min pacing.
5. Registration unchanged: daily 09:00 IST, gated behind `ENABLE_CRON=true`.

## Business Rules / ACs satisfied
- Resends invites with no response after 7 days.
- Stops (marks `FAILED`) once `attempt_count` reaches `max_attempts` (default 3).
- Each resend bumps `attempt_count` and `last_attempt_at`.
- `SIGNED_UP` / `FAILED` invites excluded.
- Runs only when `ENABLE_CRON=true`.
- Logs start/processed/failed with a per-run correlationId.
- Bounded batch per run (no unbounded scan/send).

## Idempotency
The 7-day `lastAttemptAt` window + the attempt-count guard make repeated daily runs safe: an
invite is resent at most once per 7-day window because `incrementInviteAttempt` also updates
`lastAttemptAt`, pushing it out of the next run's window.

## Edge Cases
1. Invite signed up between sweeps → excluded by status filter.
2. `attempt_count` already at max → excluded by the in-memory cap filter; marked FAILED on the
   run where it reaches max.
3. Transport failure on resend → logged, attempt still incremented, sweep continues.
4. Large backlog → bounded batch; remainder next run.
5. Clock/timezone → 7-day window in UTC, consistent with other crons.

## Security / Performance
- No new endpoint or external input; nothing user-facing.
- Bounded query (`take`) + per-vendor referral-code cache avoids N duplicate lookups.

## Coordination with US-15.5
Only a fixed batch cap is implemented here. The ≤50/min rate limiter is US-15.5's responsibility;
the batch-size seam and the port-based send keep that change drop-in.

## Open Questions
None. All behavior is fully specified by the story ACs and the existing US-014 data model;
defaults (batch size, FAILED-on-max, increment-on-transport-failure) follow the story's stated
anti-spam intent and edge-case guidance.
