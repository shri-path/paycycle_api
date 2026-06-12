export interface SubscriptionUpgradedPayload {
  vendorSubscriptionId: bigint;
  vendorId: bigint;
  oldPlanId: bigint;
  newPlanId: bigint;
  performedByUserId?: bigint | null;
  occurredAt: Date;
}

export class SubscriptionUpgradedEvent {
  readonly eventType = 'UPGRADED' as const;
  constructor(public readonly payload: SubscriptionUpgradedPayload) {}
}
