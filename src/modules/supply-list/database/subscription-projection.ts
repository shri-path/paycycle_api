import { SubscriptionMapper } from './subscription.mapper';
import { ISubscriptionRepository, SubscriptionRecord } from './subscription.repository.port';
import { ListDefaults } from '../domain/subscription.types';
import { CustomerDirectoryPort } from '../ports/customer-directory.port';
import { SubscriptionDto } from '../supply-list.types';

/**
 * Batch-builds SubscriptionDtos from records: loads customer info and otherLists
 * in two batched queries (no N+1).
 */
export async function buildSubscriptionDtos(
  records: SubscriptionRecord[],
  vendorId: bigint,
  supplyListId: bigint,
  listDefaults: ListDefaults,
  subscriptionRepo: ISubscriptionRepository,
  customerDirectory: CustomerDirectoryPort
): Promise<SubscriptionDto[]> {
  if (records.length === 0) return [];
  const customerIds = records.map((r) => r.customerId);

  const [customerInfo, otherLists] = await Promise.all([
    customerDirectory.getCustomerInfo(vendorId, customerIds),
    subscriptionRepo.otherListNamesFor(vendorId, customerIds, supplyListId),
  ]);

  return records.map((record) => {
    const entity = SubscriptionMapper.toDomain(record);
    const info = customerInfo.get(record.customerId.toString()) ?? {
      customerId: record.customerId,
      name: null,
      phone: null,
      address: null,
    };
    return SubscriptionMapper.toResponse(
      entity,
      listDefaults,
      { name: info.name, phone: info.phone, address: info.address },
      otherLists.get(record.customerId.toString()) ?? []
    );
  });
}
