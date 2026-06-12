export interface SubscriptionCancelledPayload {
  vendorSubscriptionId: bigint;
  vendorId: bigint;
  planId: bigint;
  performedByUserId?: bigint | null;
  occurredAt: Date;
}

export class SubscriptionCancelledEvent {
  readonly eventType = 'CANCELLED' as const;
  constructor(public readonly payload: SubscriptionCancelledPayload) {}
}
