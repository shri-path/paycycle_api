export interface ICustomerLookupPort {
  listRosterForList(
    vendorId: bigint,
    supplyListId: bigint,
    serviceDate: Date
  ): Promise<{ id: bigint; name: string }[]>;

  getCustomer(customerId: bigint, vendorId: bigint): Promise<{ id: bigint; name: string } | null>;
}
