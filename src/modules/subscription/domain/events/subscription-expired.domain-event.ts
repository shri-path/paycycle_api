export interface SubscriptionExpiredPayload {
  vendorSubscriptionId: bigint;
  vendorId: bigint;
  planId: bigint;
  occurredAt: Date;
}

export class SubscriptionExpiredEvent {
  readonly eventType = 'EXPIRED' as const;
  constructor(public readonly payload: SubscriptionExpiredPayload) {}
}
