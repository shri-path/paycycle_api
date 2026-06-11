import { SubscriptionEntity } from '../domain/subscription.entity';
import { ListDefaults } from '../domain/subscription.types';
import { SubscriptionDto, SubscriptionStatusLabel } from '../supply-list.types';
import { SubscriptionRecord } from './subscription.repository.port';

function toNumber(d: { toString(): string } | null): number | null {
  return d === null ? null : Number(d.toString());
}

/** Customer fields needed for the response (resolved via CustomerDirectoryPort). */
export interface CustomerInfo {
  name: string | null;
  phone: string | null;
  address: string | null;
}

/** Cap applied to otherLists names (OQ-4). */
const OTHER_LISTS_CAP = 5;

function statusLabel(isActive: boolean, endDate: Date | null): SubscriptionStatusLabel {
  if (endDate !== null) return 'ended';
  return isActive ? 'active' : 'paused';
}

export class SubscriptionMapper {
  // === Persistence → Domain ===

  static toDomain(record: SubscriptionRecord): SubscriptionEntity {
    return SubscriptionEntity.reconstitute({
      id: record.id,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      props: {
        vendorId: record.vendorId,
        supplyListId: record.supplyListId,
        customerId: record.customerId,
        customQuantity: toNumber(record.customQuantity),
        customRatePerUnit: toNumber(record.customRatePerUnit),
        startDate: record.startDate ?? record.createdAt,
        endDate: record.endDate,
        isActive: record.isActive,
        deletedAt: record.deletedAt,
      },
    });
  }

  // === Domain → Response (WHITELIST) ===

  static toResponse(
    entity: SubscriptionEntity,
    listDefaults: ListDefaults,
    customer: CustomerInfo,
    otherLists: string[]
  ): SubscriptionDto {
    const props = entity.getProps();
    const capped = otherLists.slice(0, OTHER_LISTS_CAP);
    return {
      subscriptionId: props.id.toString(),
      customerId: props.customerId.toString(),
      customerName: customer.name,
      phoneNumber: customer.phone,
      address: customer.address,
      quantity: entity.effectiveQuantity(listDefaults),
      ratePerUnit: entity.effectiveRate(listDefaults),
      amount: entity.amount(listDefaults),
      isCustomQuantity: entity.isCustomQuantity(),
      isCustomRate: entity.isCustomRate(),
      startDate: props.startDate.toISOString().slice(0, 10),
      status: statusLabel(props.isActive, props.endDate),
      otherLists: capped,
      otherListsCount: otherLists.length,
      // NEVER expose deletedAt / vendorId.
    };
  }
}
