import { randomUUID } from 'crypto';
import { Logger } from '@/infrastructure/logger/logger';
import { ICustomerRepository } from '../../database/customer.repository.port';
import { PaymentEntity, PaymentMethod } from '../../domain/customer.entity';
import { CustomerNotFoundError } from '../../domain/customer.errors';
import { CustomerMapper } from '../../customer.mapper';
import { PaymentDto } from '../../customer.types';

export interface RecordPaymentInput {
  customerId: bigint;
  vendorId: bigint;
  recordedByUserId: bigint;
  amount: number;
  paymentDate: Date;
  paymentMethod: string;
  referenceNumber?: string | null | undefined;
}

export class RecordPaymentCommand {
  constructor(
    private readonly repository: ICustomerRepository,
    private readonly logger: Logger
  ) {}

  async execute(input: RecordPaymentInput): Promise<PaymentDto> {
    const correlationId = randomUUID();
    this.logger.info(
      { customerId: input.customerId.toString(), correlationId },
      'RecordPaymentCommand: executing'
    );

    const customer = await this.repository.findById(input.customerId, input.vendorId);
    if (!customer) throw new CustomerNotFoundError(input.customerId);

    const entity = PaymentEntity.create({
      customerId: input.customerId,
      vendorId: input.vendorId,
      amount: input.amount,
      paymentDate: input.paymentDate,
      paymentMethod: input.paymentMethod as PaymentMethod,
      referenceNumber: input.referenceNumber,
      recordedByUserId: input.recordedByUserId,
    });

    const row = await this.repository.insertPayment(entity);
    return CustomerMapper.toPaymentDto(row);
  }
}
