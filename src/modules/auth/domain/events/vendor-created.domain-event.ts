export class VendorCreatedEvent {
  readonly type = 'VendorCreatedEvent';

  constructor(
    public readonly vendorId: bigint,
    public readonly name: string,
    public readonly ownerUserId: bigint,
    public readonly correlationId: string,
    public readonly timestamp: Date = new Date()
  ) {}
}
