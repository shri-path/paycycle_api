export class UserLoggedInEvent {
  readonly type = 'UserLoggedInEvent';

  constructor(
    public readonly userId: bigint,
    public readonly phone: string,
    public readonly ip: string | undefined,
    public readonly userAgent: string | undefined,
    public readonly correlationId: string,
    public readonly timestamp: Date = new Date()
  ) {}
}
