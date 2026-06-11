/**
 * ACL port (owned by Supply Lists) over the Customer context (US-008). Read-only
 * for US-005 — validates customer↔vendor membership and fetches display fields.
 */
export interface CustomerInfo {
  customerId: bigint;
  name: string | null;
  phone: string | null;
  address: string | null;
}

export interface ListVendorCustomersParams {
  search?: string;
  /** Customer ids to exclude (already subscribed). */
  excludeCustomerIds?: bigint[];
  skip: number;
  take: number;
}

export interface CustomerDirectoryPort {
  /** Returns the customerIds (subset of the input) that do NOT belong to the vendor. */
  findCustomersNotInVendor(vendorId: bigint, customerIds: bigint[]): Promise<bigint[]>;

  /** Batch-load display info for the given customers (only those in the vendor). */
  getCustomerInfo(vendorId: bigint, customerIds: bigint[]): Promise<Map<string, CustomerInfo>>;

  /** Paginated active vendor customers, optionally excluding ids / filtered by search. */
  listVendorCustomers(
    vendorId: bigint,
    params: ListVendorCustomersParams
  ): Promise<{ rows: CustomerInfo[]; total: number }>;
}
