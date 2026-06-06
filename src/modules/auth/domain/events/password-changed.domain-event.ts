export class PasswordChangedEvent {
  readonly type = 'PasswordChangedEvent';

  constructor(
    public readonly userId: bigint,
    public readonly correlationId: string,
    public readonly timestamp: Date = new Date()
  ) {}
}
