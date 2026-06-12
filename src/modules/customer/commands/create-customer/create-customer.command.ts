import { randomUUID } from 'crypto';
import { Logger } from '@/infrastructure/logger/logger';
import { ICustomerRepository } from '../../database/customer.repository.port';
import { CustomerEntity } from '../../domain/customer.entity';
import { CustomerConflictError } from '../../domain/customer.errors';
import { CustomerDetailDto } from '../../customer.types';
import { CustomerMapper } from '../../customer.mapper';
import { IDeliveryBillingPort } from '../../ports/delivery-billing.port';

export interface CreateCustomerInput {
  vendorId: bigint;
  performedByUserId: bigint;
  name: string;
  phone: string;
  phoneCountryCode?: string | undefined;
  email?: string | null | undefined;
  address?: string | null | undefined;
  area?: string | null | undefined;
  language?: string | undefined;
  supplyListIds?: bigint[] | undefined;
  startDate?: Date | null | undefined;
  creditLimit?: number | undefined;
  sendInvite?: boolean | undefined;
}

export class CreateCustomerCommand {
  constructor(
    private readonly repository: ICustomerRepository,
    private readonly billingPort: IDeliveryBillingPort,
    private readonly logger: Logger
  ) {}

  async execute(input: CreateCustomerInput): Promise<CustomerDetailDto> {
    const correlationId = randomUUID();
    this.logger.info(
      { vendorId: input.vendorId.toString(), correlationId },
      'CreateCustomerCommand: executing'
    );

    // Check phone uniqueness within vendor
    const existing = await this.repository.findByPhone(input.phone, input.vendorId);
    if (existing) {
      throw new CustomerConflictError();
    }

    const entity = CustomerEntity.create({
      vendorId: input.vendorId,
      name: input.name,
      phone: input.phone,
      phoneCountryCode: input.phoneCountryCode,
      email: input.email,
      address: input.address,
      area: input.area,
      languagePreference: input.language,
      creditLimit: input.creditLimit,
      createdByUserId: input.performedByUserId,
    });

    const row = await this.repository.insert(
      entity,
      input.vendorId,
      input.supplyListIds ?? [],
      input.startDate ?? null
    );

    // sendInvite: log intent (no external API in this iteration — OQ-1)
    if (input.sendInvite) {
      this.logger.info(
        { customerId: row.id.toString(), vendorId: input.vendorId.toString(), correlationId },
        'CreateCustomerCommand: sendInvite=true — invite queued (no external dispatch in v1)'
      );
    }

    const balance = await this.billingPort.getCustomerBalance(row.id, input.vendorId);
    const monthlyTotal = await this.billingPort.getCurrentMonthTotal(row.id, input.vendorId);
    return CustomerMapper.toDetailDto(row, [], [], balance, monthlyTotal);
  }
}
