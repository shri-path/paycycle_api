export interface SubscriptionRenewedPayload {
  vendorSubscriptionId: bigint;
  vendorId: bigint;
  planId: bigint;
  performedByUserId?: bigint | null;
  occurredAt: Date;
}

export class SubscriptionRenewedEvent {
  readonly eventType = 'RENEWED' as const;
  constructor(public readonly payload: SubscriptionRenewedPayload) {}
}
