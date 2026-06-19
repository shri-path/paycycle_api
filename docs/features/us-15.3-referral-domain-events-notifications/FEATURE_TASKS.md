# Feature Tasks: US-15.3 — Referral Domain Events & Referrer Notifications

## Complexity: Moderate — Skills: `service-implementation.md` (Strategy/port + event handler), `ddd-module-design.md`, `testing-strategy.md`

> Additive wiring on the existing US-014 referral context. No schema, no endpoint. Phase 1 builds
> the port/dispatcher/adapter/handler; Phase 2 wires publish calls into existing paths + composition
> root; Phase 3 tests. Streams within a phase own non-overlapping files.

---

### Phase 1 — New seams (parallel; all new files)

#### Stream A: Notification Port + Adapter
**Files owned**: `src/modules/referral/ports/referral-notification.port.ts`,
`src/modules/referral/database/referral-notification.adapter.ts`
**Skills**: `service-implementation.md §Strategy Pattern for External Services`
- **Task A1**: Define `IReferralNotificationPort` + `ReferrerRewardNotification` input type in
  `ports/referral-notification.port.ts` (framework-free; mirror `ports/invite-message.port.ts`).
  Method: `notifyRewardEarned(input: ReferrerRewardNotification): Promise<void>`; `id: string`.
- **Task A2**: Implement `LogReferralNotificationAdapter` in
  `database/referral-notification.adapter.ts` (mirror `database/invite-message.adapter.ts`):
  structured per-tenant log line including `referrerVendorId`, `amount`, `rewardKind`,
  `referralId`, `correlationId`; `id = 'referral-notify-log-stub'`. Document deferred real transport
  in the file header.

#### Stream B: In-process Dispatcher + Handler
**Files owned**: `src/modules/referral/domain/events/referral-event-dispatcher.ts`,
`src/modules/referral/application/event-handlers/notify-referrer-on-reward.handler.ts`
**Skills**: `service-implementation.md §Cross-Module Event Handling`
- **Task B1**: `ReferralEventDispatcher` in `domain/events/referral-event-dispatcher.ts`
  (pure; import only the event classes + a `Logger` type via injection — no Prisma/Express).
  API: `register(eventName: string, handler: ReferralEventHandler)`, `publish(event): Promise<void>`.
  `publish` awaits each registered handler inside try/catch → log+swallow (best-effort). Export a
  `ReferralEventHandler = (event: DomainEvent) => Promise<void>` type.
- **Task B2**: `NotifyReferrerOnRewardHandler` in
  `application/event-handlers/notify-referrer-on-reward.handler.ts`: ctor injects
  `IReferralNotificationPort` + `Logger`; `handle(event: ReferralRewardEarnedEvent)` maps the event
  to `notifyRewardEarned({ referrerVendorId: event.vendorId, amount, rewardKind, referralId:
  BigInt(event.aggregateId) or null, correlationId: event.metadata.correlationId })`. Guard against
  wrong event type.

---

### Phase 2 — Wire publish calls + composition root (after Phase 1)

#### Stream C: Shared dispatcher instance (composition glue)
**Files owned**: `src/modules/referral/database/referral-events.instance.ts`
**Skills**: mirror `database/dashboard-cache.instance.ts`
**Depends on**: A, B
- **Task C1**: Construct `LogReferralNotificationAdapter`, a `ReferralEventDispatcher`, register
  `NotifyReferrerOnRewardHandler` for `ReferralRewardEarnedEvent.name`, and export the wired
  `referralEvents` singleton. Lives in its own module to avoid the routes/facade/cron import cycle
  (same rationale as `dashboard-cache.instance.ts`).

#### Stream D: Publish from facade + redeem command
**Files owned**: `src/modules/referral/referral.facade.ts`,
`src/modules/referral/commands/redeem-credit/redeem-credit.command.ts`
**Depends on**: C (but inject the dispatcher via ctor, NOT import the singleton, to keep these
classes testable — singleton is passed in at the composition root)
- **Task D1**: `ReferralFacade` — add an injected `ReferralEventDispatcher` ctor param; after the
  existing signup-bonus audit call, publish `ReferralRewardEarnedEvent` (vendorId=referrer,
  amount=SIGNUP_BONUS, rewardKind=SIGNUP_BONUS, aggregateId=referralId, correlationId=existing one).
  Keep it inside the outer try/catch (signup never fails).
- **Task D2**: `RedeemCreditCommand` — add an injected `ReferralEventDispatcher` ctor param; after
  the existing audit call, publish `CreditRedeemedEvent` (vendorId, amount, redemptionType,
  aggregateId=transactionId or vendorId, correlationId=existing one). Best-effort.

#### Stream E: Publish from cron paths + composition roots
**Files owned**: `src/modules/referral/referral.cron.ts`, `src/modules/referral/referral.routes.ts`
**Depends on**: C, D (ctor signatures)
- **Task E1**: `referral.cron.ts` — construct/import the `referralEvents` singleton; after each
  existing reward audit (`auditRewardEarned`) for milestone10/50 + revenue-share, publish
  `ReferralRewardEarnedEvent`; in the qualify branch publish `VendorReferralQualifiedEvent`; in the
  clawback branch (after the clawback audit) publish `ReferralRewardClawedBackEvent`. Reuse each
  path's existing `runCorrelationId`.
- **Task E2**: `referral.routes.ts` (composition root) — import the `referralEvents` singleton; pass
  it into the `RedeemCreditCommand` and the exported `ReferralFacade` constructors. (Cron constructs
  its own composition as today.)

---

### Phase 3 — Tests (after Phase 2)

#### Stream F: Unit tests
**Files owned**:
`src/modules/referral/__tests__/events/referral-event-dispatcher.test.ts`,
`src/modules/referral/__tests__/events/notify-referrer-on-reward.handler.test.ts`,
`src/modules/referral/__tests__/database/referral-notification.adapter.test.ts`,
and additions to `referral-facade.audit.test.ts` / `redeem-credit.command.test.ts`
**Skills**: `testing-strategy.md`
- **Task F1**: Dispatcher — registers + invokes handler on matching event; multiple handlers; a
  throwing handler is swallowed (publish resolves) and does not block other handlers.
- **Task F2**: Handler — invokes `notifyRewardEarned` with referrer vendorId + amount + rewardKind;
  ignores non-reward events; swallows port failure.
- **Task F3**: Adapter — `notifyRewardEarned` resolves and logs (no throw).
- **Task F4**: Facade — publishes `ReferralRewardEarnedEvent` on signup bonus (referrer + amount);
  does NOT publish when no PENDING referral; publish failure stays swallowed.
- **Task F5**: Redeem command — publishes `CreditRedeemedEvent` on successful redeem; publish
  failure does not fail the redemption result.

> Idempotency is asserted indirectly: facade/cron only publish inside the existing reward-write
> guards (covered by the "no PENDING referral → no publish" case + existing US-014/US-15.2 guard
> tests). No new dedup store to test.
