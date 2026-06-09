export interface AssignListRequestDto {
  vendorId: bigint;
  staffId: bigint;
  supplyListId: bigint;
  isPrimary: boolean;
  performedByUserId: bigint;
}
