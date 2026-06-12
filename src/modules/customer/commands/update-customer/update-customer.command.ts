import { randomUUID } from 'crypto';
import { Logger } from '@/infrastructure/logger/logger';
import { ICustomerRepository } from '../../database/customer.repository.port';
import { CustomerEntity, CustomerStatus } from '../../domain/customer.entity';
import { CustomerNotFoundError, CustomerConflictError } from '../../domain/customer.errors';
import { CustomerMapper } from '../../customer.mapper';
import { CustomerDetailDto } from '../../customer.types';
import { IDeliveryBillingPort } from '../../ports/delivery-billing.port';
import { CustomerPhoneVO } from '../../domain/value-objects/customer-phone.vo';

export interface UpdateCustomerInput {
  customerId: bigint;
  vendorId: bigint;
  name?: string | undefined;
  phone?: string | undefined;
  phoneCountryCode?: string | undefined;
  email?: string | null | undefined;
  address?: string | null | undefined;
  area?: string | null | undefined;
  language?: string | undefined;
  status?: string | undefined;
}

export class UpdateCustomerCommand {
  constructor(
    private readonly repository: ICustomerRepository,
    private readonly billingPort: IDeliveryBillingPort,
    private readonly logger: Logger
  ) {}

  async execute(input: UpdateCustomerInput): Promise<CustomerDetailDto> {
    const correlationId = randomUUID();
    this.logger.info(
      { customerId: input.customerId.toString(), correlationId },
      'UpdateCustomerCommand: executing'
    );

    const row = await this.repository.findById(input.customerId, input.vendorId);
    if (!row) throw new CustomerNotFoundError(input.customerId);

    // Check phone uniqueness if phone changed
    if (input.phone) {
      const cc = input.phoneCountryCode ?? row.phoneCountryCode;
      const normalized = CustomerPhoneVO.create(input.phone, cc).unpack();
      if (normalized !== row.phone) {
        const conflict = await this.repository.findByPhone(input.phone, input.vendorId);
        if (conflict && conflict.id !== input.customerId) {
          throw new CustomerConflictError();
        }
      }
    }

    // Reconstitute entity and apply patch
    const { CustomerNameVO } = await import('../../domain/value-objects/customer-name.vo');
    const { CustomerPhoneVO: PhoneVO } =
      await import('../../domain/value-objects/customer-phone.vo');
    const { CreditLimitVO } = await import('../../domain/value-objects/credit-limit.vo');
    const { PaymentScoreVO } = await import('../../domain/value-objects/payment-score.vo');

    const entity = CustomerEntity.reconstitute({
      id: row.id,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      props: {
        vendorId: row.vendorId,
        name: CustomerNameVO.create(row.name ?? ''),
        phone: PhoneVO.create(row.phone.replace(row.phoneCountryCode, ''), row.phoneCountryCode),
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

    entity.update({
      name: input.name,
      phone: input.phone,
      phoneCountryCode: input.phoneCountryCode,
      email: input.email,
      address: input.address,
      area: input.area,
      languagePreference: input.language,
      status: input.status as CustomerStatus | undefined,
    });

    await this.repository.update(entity);

    const detail = await this.repository.getCustomerWithDetail(input.customerId, input.vendorId);
    if (!detail) throw new CustomerNotFoundError(input.customerId);
    const balance = await this.billingPort.getCustomerBalance(detail.id, input.vendorId);
    const monthlyTotal = await this.billingPort.getCurrentMonthTotal(detail.id, input.vendorId);
    return CustomerMapper.toDetailDto(detail, detail.subscriptions, [], balance, monthlyTotal);
  }
}
