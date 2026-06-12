/**
 * ListInvoicesQuery — paginated billing history (vendor-scoped).
 */
import { ISubscriptionRepository } from '../../database/subscription.repository.port';
import { SubscriptionMapper } from '../../subscription.mapper';
import { InvoiceDto } from '../../subscription.types';

export interface ListInvoicesResult {
  rows: InvoiceDto[];
  total: number;
}

export class ListInvoicesQuery {
  constructor(private readonly subscriptionRepo: ISubscriptionRepository) {}

  async execute(vendorId: bigint, page: number, limit: number): Promise<ListInvoicesResult> {
    const { rows, total } = await this.subscriptionRepo.listInvoices(vendorId, page, limit);
    return { rows: rows.map((r) => SubscriptionMapper.toInvoiceDto(r)), total };
  }
}
