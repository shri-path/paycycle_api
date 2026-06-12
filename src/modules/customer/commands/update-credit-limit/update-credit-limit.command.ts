import { randomUUID } from 'crypto';
import { Logger } from '@/infrastructure/logger/logger';
import { ICustomerRepository } from '../../database/customer.repository.port';
import { CustomerEntity, CustomerStatus } from '../../domain/customer.entity';
import { CustomerNotFoundError } from '../../domain/customer.errors';
import { CustomerNameVO } from '../../domain/value-objects/customer-name.vo';
import { CustomerPhoneVO } from '../../domain/value-objects/customer-phone.vo';
import { CreditLimitVO } from '../../domain/value-objects/credit-limit.vo';
import { PaymentScoreVO } from '../../domain/value-objects/payment-score.vo';
import { IDeliveryBillingPort } from '../../ports/delivery-billing.port';

export interface UpdateCreditLimitInput {
  customerId: bigint;
  vendorId: bigint;
  creditLimit: number;
}

export interface UpdateCreditLimitResult {
  creditLimit: number;
  creditUtilization: number;
}

export class UpdateCreditLimitCommand {
  constructor(
    private readonly repository: ICustomerRepository,
    private readonly billingPort: IDeliveryBillingPort,
    private readonly logger: Logger
  ) {}

  async execute(input: UpdateCreditLimitInput): Promise<UpdateCreditLimitResult> {
    const correlationId = randomUUID();
    this.logger.info(
      { customerId: input.customerId.toString(), correlationId },
      'UpdateCreditLimitCommand: executing'
    );

    const row = await this.repository.findById(input.customerId, input.vendorId);
    if (!row) throw new CustomerNotFoundError(input.customerId);

    const entity = CustomerEntity.reconstitute({
      id: row.id,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      props: {
        vendorId: row.vendorId,
        name: CustomerNameVO.create(row.name ?? ''),
        phone: CustomerPhoneVO.create(
          row.phone.replace(row.phoneCountryCode, ''),
          row.phoneCountryCode
        ),
        phoneCountryCode: row.phoneCountryCode,
        email: row.email,
        address: row.address,
        area: row.area,
        languagePreference: row.languagePreference,
        creditLimit: CreditLimitVO.create(row.creditLimit),
        paymentScore: PaymentScoreVO.create(row.paymentScore),
        customerSince: row.customerSince,
        status: row.status as CustomerStatus,
        createdByUserId: row.createdByUserId,
        deletedAt: row.deletedAt,
      },
    });

    entity.updateCreditLimit(input.creditLimit);
    await this.repository.update(entity);

    const balance = await this.billingPort.getCustomerBalance(input.customerId, input.vendorId);
    const utilization = input.creditLimit > 0 ? Math.round((balance / input.creditLimit) * 100) : 0;

    return { creditLimit: input.creditLimit, creditUtilization: utilization };
  }
}
