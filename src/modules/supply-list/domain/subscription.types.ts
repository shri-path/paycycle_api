/** Internal aggregate state for a Subscription (SupplyListCustomer). */
export interface SubscriptionProps {
  vendorId: bigint;
  supplyListId: bigint;
  customerId: bigint;
  customQuantity: number | null;
  customRatePerUnit: number | null;
  startDate: Date;
  endDate: Date | null;
  isActive: boolean;
  deletedAt: Date | null;
}

/** Factory input for creating a new subscription. */
export interface CreateSubscriptionProps {
  vendorId: bigint;
  supplyListId: bigint;
  customerId: bigint;
  customQuantity: number | null;
  customRatePerUnit: number | null;
  startDate: Date;
  correlationId: string;
}

/** Reconstitution input from persistence. */
export interface ReconstituteSubscriptionData {
  id: bigint;
  createdAt: Date;
  updatedAt: Date;
  props: SubscriptionProps;
}

/** List-level defaults used to resolve effective pricing / amount. */
export interface ListDefaults {
  defaultQuantity: number | null;
  ratePerUnit: number | null;
}
