export class UserRegisteredEvent {
  readonly type = 'UserRegisteredEvent';

  constructor(
    public readonly userId: bigint,
    public readonly phone: string,
    public readonly vendorId: bigint,
    public readonly correlationId: string,
    public readonly timestamp: Date = new Date()
  ) {}
}
