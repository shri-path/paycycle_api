export interface SubscriptionCreatedPayload {
  vendorSubscriptionId: bigint;
  vendorId: bigint;
  newPlanId: bigint;
  performedByUserId?: bigint | null;
  occurredAt: Date;
}

export class SubscriptionCreatedEvent {
  readonly eventType = 'CREATED' as const;
  constructor(public readonly payload: SubscriptionCreatedPayload) {}
}
