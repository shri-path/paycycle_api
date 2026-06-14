import { randomUUID } from 'crypto';
import { Logger } from '@/infrastructure/logger/logger';
import { NotFoundError } from '@/common/errors/app-error';
import { InvalidCreditTransitionError } from '../../domain/credit.errors';
import { ICreditSettingsRepository } from '../../database/credit-settings.repository.port';
import { ICreditBalancePort } from '../../ports/credit-balance.port';
import { ICreditCustomerPort } from '../../ports/credit-customer.port';
import { CustomerCreditSettingsEntity } from '../../domain/customer-credit-settings.entity';
import { CreditTypeEnum } from '../../domain/credit.types';
import { CustomerPrepaidEnabledEvent } from '../../domain/events/customer-prepaid-enabled.domain-event';

export interface EnablePrepaidInput {
  customerId: bigint;
  vendorId: bigint;
  clearOutstandingFirst: boolean;
  minimumBalanceWarning?: number | null;
  message?: string;
}

export type EnablePrepaidResult =
  | {
      switched: true;
      customerId: string;
      creditType: 'prepaid';
      minimumBalanceWarning: number | null;
      clearOutstandingRequired: false;
    }
  | {
      switched: false;
      customerId: string;
      creditType: string;
      clearOutstandingRequired: true;
      outstanding: number;
    };

export class EnablePrepaidCommand {
  constructor(
    private readonly settingsRepo: ICreditSettingsRepository,
    private readonly balancePort: ICreditBalancePort,
    private readonly customerPort: ICreditCustomerPort,
    private readonly logger: Logger
  ) {}

  async execute(input: EnablePrepaidInput): Promise<EnablePrepaidResult> {
    const correlationId = randomUUID();
    this.logger.info(
      { correlationId, customerId: input.customerId.toString() },
      'EnablePrepaid: start'
    );

    // Multi-tenant guard
    const customer = await this.customerPort.getCustomer(input.customerId, input.vendorId);
    if (!customer) throw new NotFoundError('Customer not found');

    // Load or create settings
    let entity = await this.settingsRepo.findByCustomer(input.customerId);
    if (!entity) {
      entity = CustomerCreditSettingsEntity.create({ customerId: input.customerId });
    }

    const currentType = entity.getProps().creditType;

    // Already prepaid → 409
    if (currentType === CreditTypeEnum.PREPAID) {
      throw new InvalidCreditTransitionError('Customer is already in prepaid mode');
    }

    // If clearOutstandingFirst=true and balance > 0, do not switch
    if (input.clearOutstandingFirst) {
      const balance = await this.balancePort.getCustomerBalance(input.customerId, input.vendorId);
      if (balance > 0) {
        this.logger.info(
          { correlationId, balance, customerId: input.customerId.toString() },
          'EnablePrepaid: outstanding balance must be cleared first'
        );
        return {
          switched: false,
          customerId: input.customerId.toString(),
          creditType: currentType.toLowerCase(),
          clearOutstandingRequired: true,
          outstanding: balance,
        };
      }
    }

    // Switch to prepaid
    entity.enablePrepaid(input.minimumBalanceWarning ?? null);
    entity = await this.settingsRepo.upsert(entity);

    const event = new CustomerPrepaidEnabledEvent(
      input.customerId,
      input.vendorId,
      input.clearOutstandingFirst,
      input.minimumBalanceWarning ?? null,
      { correlationId }
    );
    this.logger.info({ event, correlationId }, 'CustomerPrepaidEnabled event emitted');

    return {
      switched: true,
      customerId: input.customerId.toString(),
      creditType: 'prepaid',
      minimumBalanceWarning: entity.getProps().minimumBalanceWarning,
      clearOutstandingRequired: false,
    };
  }
}
