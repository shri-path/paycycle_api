/**
 * ListCreditTransactionsQuery — paginated immutable ledger.
 */
import { Logger } from 'pino';
import { IReferralRepository } from '../../database/referral.repository.port';
import { CreditTransactionType } from '../../domain/vendor-referral.types';

export interface ListTransactionsInput {
  vendorId: bigint;
  page: number;
  limit: number;
  type?: CreditTransactionType;
}

export interface CreditTransactionItem {
  id: string;
  transactionType: string;
  rewardKind: string | null;
  amount: number;
  balanceAfter: number;
  sourceType: string | null;
  description: string | null;
  createdAt: string;
}

export class ListCreditTransactionsQuery {
  constructor(
    private readonly repository: IReferralRepository,
    private readonly logger: Logger
  ) {}

  async execute(
    input: ListTransactionsInput
  ): Promise<{ rows: CreditTransactionItem[]; total: number }> {
    this.logger.info(
      { vendorId: input.vendorId.toString(), page: input.page },
      'ListCreditTransactionsQuery'
    );

    const { rows, total } = await this.repository.listCreditTransactions(
      input.vendorId,
      input.page,
      input.limit,
      input.type
    );

    return {
      rows: rows.map((r) => ({
        id: r.id.toString(),
        transactionType: r.transactionType,
        rewardKind: r.rewardKind,
        amount: r.amount,
        balanceAfter: r.balanceAfter,
        sourceType: r.sourceType,
        description: r.description,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
    };
  }
}
