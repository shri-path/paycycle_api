/**
 * ListVendorReferralsQuery — paginated list with optional status filter.
 */
import { Logger } from 'pino';
import { IReferralRepository } from '../../database/referral.repository.port';
import { ICustomerCountPort } from '../../ports/customer-count.port';
import { ReferralVendorStatus } from '../../domain/vendor-referral.types';

export interface ListVendorReferralsInput {
  vendorId: bigint;
  page: number;
  limit: number;
  status?: ReferralVendorStatus;
}

export interface VendorReferralListItem {
  id: string;
  refereeName: string | null;
  refereePhone: string | null;
  referralCode: string;
  status: string;
  signupDate: string | null;
  customerCount: number;
  totalEarned: number;
  createdAt: string;
}

export class ListVendorReferralsQuery {
  constructor(
    private readonly repository: IReferralRepository,
    private readonly customerCountPort: ICustomerCountPort,
    private readonly logger: Logger
  ) {}

  async execute(
    input: ListVendorReferralsInput
  ): Promise<{ rows: VendorReferralListItem[]; total: number }> {
    this.logger.info(
      { vendorId: input.vendorId.toString(), page: input.page },
      'ListVendorReferralsQuery'
    );

    const { rows, total } = await this.repository.listVendorReferrals(
      input.vendorId,
      input.page,
      input.limit,
      input.status
    );

    const items = await Promise.all(
      rows.map(async (r) => {
        const customerCount = r.refereeVendorId
          ? await this.customerCountPort.activeCustomerCount(r.refereeVendorId)
          : 0;

        // Total earned from ledger for this referral
        const { rows: txns } = await this.repository.listCreditTransactions(input.vendorId, 1, 200);
        const totalEarned = txns
          .filter((t) => t.sourceId === r.id)
          .reduce((sum, t) => sum + t.amount, 0);

        return {
          id: r.id.toString(),
          refereeName: r.refereeName,
          refereePhone: r.refereePhone,
          referralCode: r.referralCode,
          status: r.status,
          signupDate: r.signupDate ? r.signupDate.toISOString() : null,
          customerCount,
          totalEarned,
          createdAt: r.createdAt.toISOString(),
        };
      })
    );

    return { rows: items, total };
  }
}
