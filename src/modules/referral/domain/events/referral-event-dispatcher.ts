/**
 * ReferralEventDispatcher — a lightweight, in-process, synchronous domain-event
 * dispatcher for the referral module (US-15.3).
 *
 * The project has no shared event bus (US-15.2 wrote audits directly). This is a
 * minimal, typed fan-out so the declared referral domain events are actually
 * published and their handlers invoked, without pulling in a framework.
 *
 * Design notes:
 * - Best-effort: every handler runs inside try/catch and failures are logged and
 *   swallowed. A handler failure (e.g. notification transport down) must NEVER
 *   fail or roll back the already-committed reward/ledger transaction.
 * - Async-ready: `publish` and handlers return Promise<void>, so a queue-backed
 *   transport can replace synchronous in-process dispatch without touching call sites.
 * - Pure-ish: imports only the framework-free DomainEvent type and a pino Logger
 *   interface (injected) — no Express/Prisma.
 */
import { Logger } from 'pino';
import { DomainEvent } from './vendor-referral.domain-events';

export type ReferralEventHandler<E extends DomainEvent = DomainEvent> = (event: E) => Promise<void>;

export class ReferralEventDispatcher {
  private readonly handlers = new Map<string, ReferralEventHandler[]>();

  constructor(private readonly logger: Logger) {}

  /** Register a handler for an event name (use `SomeEvent.name`). */
  register<E extends DomainEvent>(eventName: string, handler: ReferralEventHandler<E>): this {
    const existing = this.handlers.get(eventName) ?? [];
    existing.push(handler as ReferralEventHandler);
    this.handlers.set(eventName, existing);
    return this;
  }

  /**
   * Publish an event to all registered handlers. Awaits each handler but never
   * throws to the caller — handler errors are logged and swallowed (best-effort).
   */
  async publish(event: DomainEvent): Promise<void> {
    const eventName = event.constructor.name;
    const handlers = this.handlers.get(eventName) ?? [];

    this.logger.debug(
      {
        event: eventName,
        aggregateId: event.aggregateId,
        correlationId: event.metadata.correlationId,
        handlerCount: handlers.length,
      },
      'ReferralEventDispatcher: publishing event'
    );

    for (const handler of handlers) {
      try {
        await handler(event);
      } catch (err) {
        this.logger.error(
          { err, event: eventName, correlationId: event.metadata.correlationId },
          'ReferralEventDispatcher: handler failed (swallowed)'
        );
      }
    }
  }
}
