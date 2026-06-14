import { ICreditBalancePort } from '../../ports/credit-balance.port';
import { ICreditCustomerPort, CustomerCreditRow } from '../../ports/credit-customer.port';
import { ICreditSettingsRepository } from '../../database/credit-settings.repository.port';
import {
  CollectionPriorityVO,
  CollectionPriorityEnum,
} from '../../domain/value-objects/collection-priority.vo';
import { CreditMapper } from '../../credit.mapper';

type SortOption = 'oldest_first' | 'amount_desc' | 'utilization_desc' | 'score_asc';

export interface PriorityCard {
  customerId: string;
  customerName: string;
  phoneNumber: string;
  outstanding: number;
  daysOverdue: number;
  creditLimit: number;
  utilizationPercentage: number;
  lastPaymentDate: string | null;
  paymentScore: number;
  creditType: string;
}

export interface AdvanceCreditCard {
  customerId: string;
  customerName: string;
  creditBalance: number;
  monthsCovered: number;
}

export interface PriorityListResult {
  highPriority: PriorityCard[];
  mediumPriority: PriorityCard[];
  lowPriority: PriorityCard[];
  advanceCredit: AdvanceCreditCard[];
}

export class GetPriorityListQuery {
  constructor(
    private readonly balancePort: ICreditBalancePort,
    private readonly customerPort: ICreditCustomerPort,
    private readonly settingsRepo: ICreditSettingsRepository
  ) {}

  async execute(vendorId: bigint, sort: SortOption = 'oldest_first'): Promise<PriorityListResult> {
    const customers = await this.customerPort.listCustomersWithCredit(vendorId);
    if (customers.length === 0) {
      return { highPriority: [], mediumPriority: [], lowPriority: [], advanceCredit: [] };
    }

    const customerIds = customers.map((c) => c.id);
    const [balanceMap, oldestDateMap, settingsList] = await Promise.all([
      this.balancePort.getBulkBalances(customerIds, vendorId),
      this.balancePort.getOldestUnpaidServiceDate(customerIds, vendorId),
      Promise.all(customerIds.map((id) => this.settingsRepo.findByCustomer(id))),
    ]);

    // Build Map<customerId, creditType> — default to 'normal' when no settings row exists
    const creditTypeMap = new Map<string, string>();
    for (let i = 0; i < customerIds.length; i++) {
      const settings = settingsList[i];
      const key = customerIds[i]!.toString();
      creditTypeMap.set(key, settings ? settings.getProps().creditType.toLowerCase() : 'normal');
    }

    const today = new Date();
    const high: PriorityCard[] = [];
    const medium: PriorityCard[] = [];
    const low: PriorityCard[] = [];
    const advance: AdvanceCreditCard[] = [];

    for (const customer of customers) {
      const key = customer.id.toString();
      const balance = balanceMap.get(key) ?? 0;

      if (balance < 0) {
        // Advance credit bucket: monthsCovered = |balance| / (monthly billing heuristic)
        // Use creditLimit as proxy for monthly billing for simplicity
        const monthsCovered =
          customer.creditLimit > 0
            ? Math.round((Math.abs(balance) / customer.creditLimit) * 12 * 10) / 10
            : 0;
        advance.push({
          customerId: customer.id.toString(),
          customerName: customer.name,
          creditBalance: Math.abs(balance),
          monthsCovered,
        });
        continue;
      }

      if (balance === 0) {
        // Fully paid — omit from all priority buckets (FEATURE_PLAN: only balance > 0 are aged)
        continue;
      }

      const oldestDate = oldestDateMap.get(key) ?? null;
      const daysOverdue = oldestDate
        ? Math.max(0, Math.floor((today.getTime() - oldestDate.getTime()) / (1000 * 60 * 60 * 24)))
        : 0;

      const utilization =
        customer.creditLimit > 0 ? Math.round((balance / customer.creditLimit) * 100) : 0;

      const priority = CollectionPriorityVO.evaluate(daysOverdue, utilization);
      const creditType = creditTypeMap.get(key);
      const card = this._buildCard(customer, balance, daysOverdue, utilization, creditType);

      if (priority.unpack() === CollectionPriorityEnum.HIGH) high.push(card);
      else if (priority.unpack() === CollectionPriorityEnum.MEDIUM) medium.push(card);
      else low.push(card);
    }

    // Apply sort
    const sortFn = this._getSortFn(sort);
    high.sort(sortFn);
    medium.sort(sortFn);
    low.sort(sortFn);

    return { highPriority: high, mediumPriority: medium, lowPriority: low, advanceCredit: advance };
  }

  private _buildCard(
    customer: CustomerCreditRow,
    balance: number,
    daysOverdue: number,
    utilization: number,
    creditType?: string
  ): PriorityCard {
    return CreditMapper.toPriorityCard({
      customer,
      balance,
      daysOverdue,
      utilizationPercent: utilization,
      ...(creditType !== undefined ? { creditType } : {}),
    }) as PriorityCard;
  }

  private _getSortFn(sort: SortOption): (a: PriorityCard, b: PriorityCard) => number {
    switch (sort) {
      case 'amount_desc':
        return (a, b) => b.outstanding - a.outstanding;
      case 'utilization_desc':
        return (a, b) => b.utilizationPercentage - a.utilizationPercentage;
      case 'score_asc':
        return (a, b) => a.paymentScore - b.paymentScore;
      case 'oldest_first':
      default:
        return (a, b) => b.daysOverdue - a.daysOverdue;
    }
  }
}
