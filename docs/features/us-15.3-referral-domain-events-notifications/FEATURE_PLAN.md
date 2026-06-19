# Feature: US-15.3 — Referral Domain Events & Referrer Notifications

> Backend-only NFR follow-up to US-014 (one of US-15.1 … US-15.6). No API contract change,
> no schema migration. Branch: `feat/us-15.3-referral-domain-events-notifications`.

## Complexity Assessment
- **Tier**: Moderate (additive cross-cutting wiring; no new aggregate, no schema, no endpoint).
- **Justification**: The referral bounded context, its aggregates, ledger, crons, facade, and
  the declared domain events already exist (US-014). This story adds (a) a notification **port +
  adapter**, (b) a lightweight in-process **event dispatcher** with one subscribed handler, and
  (c) **publish calls** wired into the existing reward / redeem / clawback / qualify paths. It
  touches multiple existing files but introduces no new domain modelling and no persistence.
- **Directory Structure** (new files only):
  - `src/modules/referral/ports/referral-notification.port.ts` — framework-free port
  - `src/modules/referral/domain/events/referral-event-dispatcher.ts` — pure in-process dispatcher
  - `src/modules/referral/application/event-handlers/notify-referrer-on-reward.handler.ts` — handler
  - `src/modules/referral/database/referral-notification.adapter.ts` — log/stub adapter
  - `src/modules/referral/database/referral-events.instance.ts` — shared singleton (composition glue)

## Domain Model

No new aggregates, entities, or value objects. Reuses the **already-declared** events in
`src/modules/referral/domain/events/vendor-referral.domain-events.ts`:

| Event | Published when | Carries | Consumed by (v1) |
|---|---|---|---|
| `ReferralRewardEarnedEvent` | signup bonus (facade), milestone 10/50 (cron), revenue share (cron) | `vendorId` (=referrer), `amount`, `rewardKind`, `aggregateId` (=referralId), `metadata.correlationId` | **NotifyReferrerOnReward** → notification port |
| `VendorReferralQualifiedEvent` | referral transitions SIGNED_UP→QUALIFIED (milestone cron) | `referrerVendorId`, `refereeVendorId`, `aggregateId` (=referralId) | dispatched; no v1 handler (no-op sink — logged) |
| `CreditRedeemedEvent` | `RedeemCreditCommand.execute` (subscription/upgrade) | `vendorId`, `amount`, `redemptionType`, `aggregateId` | dispatched; no v1 handler (no-op sink — logged) |
| `ReferralRewardClawedBackEvent` | clawback cron (referee churned) | `vendorId` (=referrer), `referralId`, `amount`, `aggregateId` | dispatched; no v1 handler (no-op sink — logged) |

> **Why only `ReferralRewardEarned` drives a notification**: US-014's AC (lines 258-263) and
> this story's title scope the *referrer notification* to the reward-earned case only ("I want to
> be notified when I earn a referral reward"). The other three events are **published** to satisfy
> the explicit acceptance criteria and to give future handlers (real notifications, projections,
> analytics) a seam, but they have no notification side-effect in v1. The dispatcher logs every
> published event at `debug`, so "publish + handler invocation actually runs" is verifiable.

### Dispatcher design (lightweight, in-process, synchronous)
The project has **no event bus** (US-15.2 deliberately wrote audits directly). We add a minimal,
typed, synchronous dispatcher rather than a generic framework:

```
ReferralEventDispatcher
  .register(eventName, handler)         // wire at composition root
  .publish(event): Promise<void>        // await all handlers; never throws to caller
```

- **Pure** (`domain/events/`): no framework imports; depends only on the event classes and a
  `ReferralEventHandler` function type.
- **Best-effort**: `publish` wraps each handler in try/catch and **logs+swallows** — a handler
  failure (e.g. notification transport down) must NEVER fail or roll back the already-committed
  reward/ledger transaction (edge case #1).
- **Async-ready**: the `publish`/handler signatures return `Promise<void>`, so an async queue
  transport can replace the synchronous in-process dispatch without touching call sites.

### Notification port & adapter (Ports & Adapters)
```ts
// ports/referral-notification.port.ts  (framework-free)
export interface ReferrerRewardNotification {
  referrerVendorId: bigint;   // tenant + recipient
  amount: number;
  rewardKind: string;
  referralId: bigint | null;
  correlationId: string;
}
export interface IReferralNotificationPort {
  id: string;
  notifyRewardEarned(input: ReferrerRewardNotification): Promise<void>;
}
```
`LogReferralNotificationAdapter` (`database/referral-notification.adapter.ts`) implements it by
logging a structured, per-tenant line. **This is not a no-op** — it runs on every reward and emits
an observable record. Real WhatsApp/push transport is **explicitly deferred** (see Deferred
Transport below).

## API Endpoints
**None.** No route, controller, validator, or response-contract change. The dashboard / redeem /
list endpoints are untouched. `API_SPEC.md` is intentionally a no-change notice (frontend-only doc;
this is a backend-only story with no frontend track).

## Data Model Changes
**None.** No Prisma model, no migration, no seed change. Notifications are dispatched in-process
and logged; nothing is persisted in v1 (documented limitation — a future `referral_notifications`
table or platform notification service is the path to durable/auditable delivery).

## Business Rules & Idempotency
- **Idempotency is inherited from the reward write itself.** Events publish only *after* a reward
  row is actually written, inside the existing dedup guards:
  - Signup bonus: first-wins attribution (`findActiveReferralsByReferee` guard) + PENDING→SIGNED_UP
    transition; a re-run finds no PENDING referral and never re-earns → never re-publishes.
  - Milestone 10/50: `!row.milestone10At` / `!row.milestone50At` guards; once stamped, no re-earn.
  - Revenue share: `hasRevenueShareForMonth` guard; one reward (and one event) per referrer/referee/month.
  - Clawback: `findReferralsForClawbackSweep` excludes already-clawed rows.
  No separate notification-dedup store is needed; the reward guard *is* the idempotency key
  (edge case #2 + #4: one notification per distinct reward, cron re-run does not re-notify).
- **Per-tenant**: every notification carries `referrerVendorId` and the adapter logs it as the
  tenant key. The recipient is always the referrer (the vendor whose balance was credited).
- **Transport failure never breaks the transaction** (edge case #1): publish is post-commit and
  best-effort; the dispatcher swallows handler errors.
- **Referrer churned/disabled** (edge case #3): v1 log adapter always "succeeds"; when a real
  transport lands it resolves recipient state and skips gracefully — the dispatcher swallowing
  errors already guarantees a missing recipient can't break the flow. Documented as a v1 limitation.

## Coordination with US-15.2 (Audit Trail) — DECISION
US-15.2 (already merged) writes audits **directly** in the redeem / reward (facade + cron) /
clawback / create paths — it did **not** use an event bus.

**Decision: leave US-15.2's direct audit writes exactly as-is; add notifications independently
through the new dispatcher.** Rationale:
- Zero risk of double-writing audits (audit stays a direct call; the dispatcher only fans out to
  the notification handler, never to audit).
- The event payloads are designed to be audit-compatible (system-actor reward-earned with
  amount/rewardKind/referralId), so a *future* story could migrate audit onto the dispatcher — but
  that migration is explicitly **out of scope** here to avoid touching working audit code.
- Each publish call sits next to (immediately after) the existing audit call in the same path,
  reusing the same `correlationId` already generated for that path/cron run, so audit and
  notification share a trace id.

## Sequence (reward-earned, milestone cron path)
```
MilestoneSweep (cron)
  └─ tx: updateVendorReferral(milestone10) + earnCredit(EARNED row)   [committed]
  └─ dashboardCache.invalidate(referrer)                              [US-15.1, unchanged]
  └─ auditLogger.log(REFERRAL_REWARD_EARNED, system)                  [US-15.2, unchanged]
  └─ referralEvents.publish(new ReferralRewardEarnedEvent({           [US-15.3, NEW]
        aggregateId: referralId, vendorId: referrer,
        amount, rewardKind, metadata:{correlationId: runCorrelationId} }))
        └─ NotifyReferrerOnReward.handle(event)
             └─ notificationPort.notifyRewardEarned({ referrerVendorId, amount, rewardKind, referralId, correlationId })
                  └─ LogReferralNotificationAdapter → structured log line (per-tenant)
```
The same publish call is added to: facade signup-bonus path, cron revenue-share path. The
`VendorReferralQualified` publish is added to the cron qualify branch; `CreditRedeemed` to the
redeem command; `CreditClawedBack` to the clawback cron branch.

## Error Handling Strategy
- Dispatcher `publish` and every handler are best-effort: try/catch → `logger.error` → swallow.
- No new error classes. No throw reaches the reward/redeem/clawback callers from the event path.

## Security Considerations
- No new endpoint / RBAC surface. Notifications are server-internal.
- The log adapter logs `referrerVendorId`, `amount`, `rewardKind`, `correlationId` — no PII
  (no phone/name). Consistent with US-15.2's masking discipline.

## Performance Considerations
- Synchronous in-process dispatch adds one awaited handler call per reward — negligible (crons
  already do per-row DB writes). No new queries. Dashboard cache invalidation (US-15.1) is unchanged.

## Deferred Transport (explicit — no silent no-op)
- **v1 transport = `LogReferralNotificationAdapter`** (structured log). The publish + handler +
  port invocation genuinely execute and are observable/testable.
- **Deferred**: real WhatsApp/SMS/push delivery and durable persistence of notifications. The
  port is the seam; a `WhatsAppReferralNotificationAdapter` (reusing the platform messaging service
  used by `StubInviteMessageAdapter`) or a queue-backed dispatcher drops in without call-site change.
  Tracked as a follow-up (US-15.x), same posture as the existing invite-message stub.

## Open Questions
_None._ All decisions follow directly from the story, US-014 ACs, the existing US-15.1/US-15.2
patterns, and standing memory (notification behind a port; events from domain/application;
delivery by an infra adapter; best-effort/idempotent). The notification-vs-audit reconciliation and
the v1 log-transport deferral are recorded as decisions above rather than open questions because the
story text prescribes both ("stub/queue acceptable", "keep audit as-is … default").
