/**
 * DeliveryControlPort — ACL to pause/resume customer deliveries.
 * The adapter sets vendor_customers.status = PAUSED (idempotent).
 */

export interface IDeliveryControlPort {
  pauseCustomer(customerId: bigint, vendorId: bigint): Promise<void>;
}
