# QA Report — US-15.3 Referral Domain Events & Referrer Notifications

**Verdict: PASS** — 0 bugs. All acceptance criteria and the story testing checklist covered.

## Test execution
- `npm run build`: clean.
- `npm run lint`: 0 errors (86 pre-existing repo-wide warnings; none in new files).
- Unit suite: **1124/1124 pass, 80 suites**. Referral subset: **146/146, 14 suites**
  (2 new event suites + adapter suite + augmented facade/redeem suites). Golden dashboard
  snapshot still green (no contract change).
- Integration suite: 5 DB-dependent suites (customer, supply-list, staff-edge, delivery,
  subscription) fail at Prisma connect — identical to base `main` (no live Postgres in env).
  None are referral; none are touched by US-15.3. **Not a regression** (same posture as US-15.2 QA).

## Story testing checklist
### Unit
- [x] Each reward path publishes the correct event with correct payload
  — facade signup → `ReferralRewardEarned` (vendorId=referrer, amount=SIGNUP_BONUS, rewardKind,
    aggregateId=referralId); redeem → `CreditRedeemed`; handler maps referrer payload.
- [x] Notification handler invoked with referrer + amount
  — `notify-referrer-on-reward.handler.test.ts`.
- [x] Idempotent reward does not re-notify
  — publish occurs only inside existing reward-write guards; "no PENDING referral → no publish"
    (facade) and "no publish on failed redemption" (redeem) assert the guard boundary.
- [x] Notification failure does not throw out of the command
  — dispatcher swallow test + "a failing notification handler does not fail the redemption".

### Integration (milestone→notification, redeem→CreditRedeemed)
- [~] Deferred to unit coverage against the real dispatcher. A live-DB HTTP test would fail at
  Prisma connect identically to the 5 baseline suites; referral has no passing live-DB integration
  suite on base. The redeem command, facade, and cron publish paths are exercised by unit tests
  with the real `ReferralEventDispatcher` (not a mock), so the publish → handler → port chain is
  proven to run. Documented deviation, consistent with US-15.1/US-15.2 QA.

## Edge cases (from story)
1. Transport unavailable → log + continue, never fail the ledger — PASS (dispatcher swallow;
   publish is post-commit).
2. Idempotent reward re-processed by cron → not re-published — PASS (reward-write guards gate publish).
3. Referrer churned/disabled → skip gracefully — PASS (dispatcher swallows any handler error; v1
   log adapter always resolves; real-transport recipient check is the documented future seam).
4. Multiple rewards in one cron run → one notification per distinct reward — PASS (one publish per
   committed reward row).

## Bugs
None. See FEATURE_BUGS.md.
