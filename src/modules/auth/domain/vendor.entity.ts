import { VendorProps, CreateVendorProps, ReconstituteVendorData } from './vendor.types';
import { VendorCreatedEvent } from './events/vendor-created.domain-event';
import { ArgumentInvalidException } from './value-objects/phone-number.value-object';

type DomainEvent = VendorCreatedEvent;

export class VendorEntity {
  private readonly _id: bigint;
  private readonly _createdAt: Date;
  private _updatedAt: Date;
  private _props: VendorProps;
  private _domainEvents: DomainEvent[] = [];

  private constructor(id: bigint, createdAt: Date, updatedAt: Date, props: VendorProps) {
    this._id = id;
    this._createdAt = createdAt;
    this._updatedAt = updatedAt;
    this._props = props;
  }

  get id(): bigint {
    return this._id;
  }

  getProps(): Readonly<VendorProps & { id: bigint; createdAt: Date; updatedAt: Date }> {
    return Object.freeze({
      id: this._id,
      createdAt: this._createdAt,
      updatedAt: this._updatedAt,
      ...this._props,
    });
  }

  equals(other?: VendorEntity): boolean {
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

  static create(props: CreateVendorProps): VendorEntity {
    const entity = new VendorEntity(0n, new Date(), new Date(), {
      name: props.name,
      phone: null,
      category: null,
      referralCode: null,
      referredByVendorId: null,
      autoMarkEnabled: true,
      autoSendBills: false,
      autoSendTime: '20:00',
      upiId: null,
      bankDetails: null,
      deletedAt: null,
    });
    entity.validate();
    return entity;
  }

  static reconstitute(data: ReconstituteVendorData): VendorEntity {
    return new VendorEntity(data.id, data.createdAt, data.updatedAt, data.props);
  }

  emitCreatedEvent(ownerUserId: bigint, correlationId: string): void {
    this.addDomainEvent(
      new VendorCreatedEvent(this._id, this._props.name, ownerUserId, correlationId)
    );
  }

  private validate(): void {
    if (!this._props.name || this._props.name.trim().length === 0) {
      throw new ArgumentInvalidException('Vendor name must not be empty');
    }
    if (this._props.name.length > 150) {
      throw new ArgumentInvalidException('Vendor name must not exceed 150 characters');
    }
  }
}
