# Review Report — US-15.4 Customer Invite Auto-Resend Cron

**Verdict: APPROVE** (0 blocker / 0 critical / 0 major / 0 minor)

## Scope reviewed
- `src/modules/referral/referral.cron.ts` — `runInviteResendSweep` body + injectable deps,
  registration call (`void` for async), batch constant, port wiring.
- `src/modules/referral/database/referral.repository.port.ts` — `findInvitesDueForResendBatch`.
- `src/modules/referral/database/referral.repository.ts` — adapter implementation.
- New tests: `__tests__/cron/invite-resend-sweep.test.ts`,
  `__tests__/database/find-invites-due-for-resend.test.ts`.

## Findings
- **Dependency Rule**: preserved. The cron (infrastructure) depends on `IReferralRepository`
  and `IInviteMessagePort` (ports). No new domain-layer framework imports.
- **Ports & Adapters**: resend dispatched through `IInviteMessagePort` (stub adapter) per AC;
  transport is swappable without touching the sweep.
- **CQS / atomicity**: the attempt increment and the FAILED status mark commit in one
  `repository.transaction`, so an invite can never be left "incremented but not stopped".
- **Resilience**: per-invite try/catch isolates a single failure; outer try/catch guarantees
  the sweep never throws (matches sibling sweeps). Transport failure still increments the
  attempt (documented anti-spam guarantee, edge case #3).
- **Consistency**: structure mirrors `runMilestoneSweep` / `runClawbackSweep` (per-run
  correlationId, `logger.child`, structured counts). Registration stays gated behind `ENABLE_CRON`.
- **Backward compatibility**: the per-vendor `findInvitesDueForResend` is untouched; a new
  dedicated global+bounded method was added rather than overloading it.
- **US-15.5 compatibility**: only a fixed batch cap is added; no rate limiter — leaves the
  ≤50/min pacing for 15.5.

## Notes (non-blocking)
- `attemptCount < maxAttempts` is filtered in memory because Prisma cannot express a
  column-to-column comparison in `where`; rows at max are excluded here and marked FAILED on the
  run they reach max, so they do not accumulate. Acceptable and documented in the adapter.
