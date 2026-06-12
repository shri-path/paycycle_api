/**
 * IUsageCounter port — implemented by UsageQueryService.
 */
export interface UsageAllResult {
  customers: number;
  staff: number;
  supplyLists: number;
}

export interface IUsageCounter {
  countCustomers(vendorId: bigint): Promise<number>;
  countStaff(vendorId: bigint): Promise<number>;
  countSupplyLists(vendorId: bigint): Promise<number>;
  countAll(vendorId: bigint): Promise<UsageAllResult>;
}
