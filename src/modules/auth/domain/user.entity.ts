import { PhoneNumber } from './value-objects/phone-number.value-object';
import { ArgumentInvalidException } from '@/common/errors/app-error';
import { HashedPassword } from './value-objects/hashed-password.value-object';
import { UserProps, CreateUserProps, ReconstituteUserData } from './user.types';
import { UserRegisteredEvent } from './events/user-registered.domain-event';
import { UserLoggedInEvent } from './events/user-logged-in.domain-event';
import { PasswordChangedEvent } from './events/password-changed.domain-event';

const ALLOWED_LANGUAGES = ['en', 'hi', 'ta', 'te', 'mr', 'bn', 'kn', 'ml', 'gu'] as const;

type DomainEvent = UserRegisteredEvent | UserLoggedInEvent | PasswordChangedEvent;

export class UserEntity {
  private readonly _id: bigint;
  private readonly _createdAt: Date;
  private _updatedAt: Date;
  private _props: UserProps;
  private _domainEvents: DomainEvent[] = [];

  private constructor(id: bigint, createdAt: Date, updatedAt: Date, props: UserProps) {
    this._id = id;
    this._createdAt = createdAt;
    this._updatedAt = updatedAt;
    this._props = props;
  }

  get id(): bigint {
    return this._id;
  }

  get createdAt(): Date {
    return this._createdAt;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  getProps(): Readonly<UserProps & { id: bigint; createdAt: Date; updatedAt: Date }> {
    return Object.freeze({
      id: this._id,
      createdAt: this._createdAt,
      updatedAt: this._updatedAt,
      ...this._props,
    });
  }

  equals(other?: UserEntity): boolean {
    if (!other) return false;
    return this._id === other._id;
  }

  getDomainEvents(): DomainEvent[] {
    return [...this._domainEvents];
  }

  clearDomainEvents(): void {
    this._domainEvents = [];
  }

  private addDomainEvent(event: DomainEvent): void {
    this._domainEvents.push(event);
  }

  static create(props: CreateUserProps): UserEntity {
    const entity = new UserEntity(
      0n, // temporary id — replaced after DB insert
      new Date(),
      new Date(),
      {
        phone: props.phone,
        passwordHash: props.passwordHash,
        name: null,
        email: null,
        profilePhotoUrl: null,
        preferredLanguage: props.preferredLanguage ?? 'en',
        lastLoginAt: null,
        deletedAt: null,
      }
    );
    entity.validate();
    // Domain event added after DB insert with real id (in service)
    return entity;
  }

  static reconstitute(data: ReconstituteUserData): UserEntity {
    const entity = new UserEntity(data.id, data.createdAt, data.updatedAt, data.props);
    entity.validate();
    return entity;
  }

  recordLogin(correlationId: string, ip?: string | null, userAgent?: string | null): void {
    this._props = { ...this._props, lastLoginAt: new Date() };
    this._updatedAt = new Date();
    this.addDomainEvent(
      new UserLoggedInEvent(
        this._id,
        this._props.phone.unpack(),
        ip ?? undefined,
        userAgent ?? undefined,
        correlationId
      )
    );
  }

  changePassword(newHash: HashedPassword, correlationId: string): void {
    this._props = { ...this._props, passwordHash: newHash };
    this._updatedAt = new Date();
    this.addDomainEvent(new PasswordChangedEvent(this._id, correlationId));
  }

  softDelete(): void {
    this._props = { ...this._props, deletedAt: new Date() };
    this._updatedAt = new Date();
  }

  private validate(): void {
    if (!this._props.phone.unpack()) {
      throw new ArgumentInvalidException('Phone must not be empty');
    }

    if (!this._props.passwordHash.unpack()) {
      throw new ArgumentInvalidException('Password hash must not be empty');
    }

    if (!(ALLOWED_LANGUAGES as readonly string[]).includes(this._props.preferredLanguage)) {
      throw new ArgumentInvalidException(
        `preferredLanguage "${this._props.preferredLanguage}" is not in allowed list: ${ALLOWED_LANGUAGES.join(', ')}`
      );
    }
  }

  emitRegisteredEvent(vendorId: bigint, correlationId: string): void {
    this.addDomainEvent(
      new UserRegisteredEvent(this._id, this._props.phone.unpack(), vendorId, correlationId)
    );
  }
}

export { PhoneNumber, HashedPassword, ArgumentInvalidException };
