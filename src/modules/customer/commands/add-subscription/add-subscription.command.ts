import { randomUUID } from 'crypto';
import { Logger } from '@/infrastructure/logger/logger';
import { prisma } from '@/infrastructure/database/prisma.client';
import { NotFoundError } from '@/common/errors/app-error';
import { ICustomerRepository } from '../../database/customer.repository.port';
import { CustomerNotFoundError, SubscriptionConflictError } from '../../domain/customer.errors';
import { CustomerMapper } from '../../customer.mapper';
import { SubscriptionDto } from '../../customer.types';

export interface AddSubscriptionInput {
  customerId: bigint;
  vendorId: bigint;
  supplyListId: bigint;
  startDate?: Date | null | undefined;
  customQuantity?: number | null | undefined;
  customRatePerUnit?: number | null | undefined;
}

export class AddSubscriptionCommand {
  constructor(
    private readonly repository: ICustomerRepository,
    private readonly logger: Logger
  ) {}

  async execute(input: AddSubscriptionInput): Promise<SubscriptionDto> {
    const correlationId = randomUUID();
    this.logger.info(
      { customerId: input.customerId.toString(), correlationId },
      'AddSubscriptionCommand: executing'
    );

    // Verify customer belongs to vendor
    const customer = await this.repository.findById(input.customerId, input.vendorId);
    if (!customer) throw new CustomerNotFoundError(input.customerId);

    // Verify supply list belongs to vendor
    const list = await prisma.supplyList.findFirst({
      where: { id: input.supplyListId, vendorId: input.vendorId, deletedAt: null },
    });
    if (!list) throw new NotFoundError('Supply list not found');

    // Check no active subscription already
    const existing = await this.repository.findActiveSubscription(
      input.customerId,
      input.supplyListId
    );
    if (existing) throw new SubscriptionConflictError();

    const row = await this.repository.insertSubscription({
      vendorId: input.vendorId,
      supplyListId: input.supplyListId,
      customerId: input.customerId,
      startDate: input.startDate,
      customQuantity: input.customQuantity,
      customRatePerUnit: input.customRatePerUnit,
    });

    return CustomerMapper.toSubscriptionDto(row);
  }
}
