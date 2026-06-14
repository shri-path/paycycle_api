import { randomUUID } from 'crypto';
import { Logger } from '@/infrastructure/logger/logger';
import { NotFoundError } from '@/common/errors/app-error';
import { ICreditSettingsRepository } from '../../database/credit-settings.repository.port';
import { ICreditBalancePort } from '../../ports/credit-balance.port';
import { ICreditCustomerPort } from '../../ports/credit-customer.port';
import { IDeliveryControlPort } from '../../ports/delivery-control.port';
import { CustomerCreditSettingsEntity } from '../../domain/customer-credit-settings.entity';
import { CreditTypeEnum, CreditBreachActionEnum } from '../../domain/credit.types';
import { CustomerCreditBreachedEvent } from '../../domain/events/customer-credit-breached.domain-event';
import { CustomerCreditSettingsUpdatedEvent } from '../../domain/events/customer-credit-settings-updated.domain-event';
import { CreditMapper, SettingsResponseDto } from '../../credit.mapper';

export interface SetCreditSettingsInput {
  customerId: bigint;
  vendorId: bigint;
  creditType?: CreditTypeEnum;
  creditLimit?: number;
  warningThreshold?: number;
  actionOnBreach?: CreditBreachActionEnum;
  minimumBalanceWarning?: number | null;
}

export class SetCreditSettingsCommand {
  constructor(
    private readonly settingsRepo: ICreditSettingsRepository,
    private readonly balancePort: ICreditBalancePort,
    private readonly customerPort: ICreditCustomerPort,
    private readonly deliveryControl: IDeliveryControlPort,
    private readonly logger: Logger
  ) {}

  async execute(input: SetCreditSettingsInput): Promise<SettingsResponseDto> {
    const correlationId = randomUUID();
    this.logger.info(
      { correlationId, customerId: input.customerId.toString() },
      'SetCreditSettings: start'
    );

    // Multi-tenant guard: verify customer belongs to this vendor
    const customer = await this.customerPort.getCustomer(input.customerId, input.vendorId);
    if (!customer) {
      throw new NotFoundError('Customer not found');
    }

    // If credit limit provided, delegate to customer port
    if (input.creditLimit !== undefined) {
      await this.customerPort.setCreditLimit(input.customerId, input.vendorId, input.creditLimit);
    }

    // Load or build settings entity
    let entity = await this.settingsRepo.findByCustomer(input.customerId);
    const patch = {
      ...(input.creditType !== undefined ? { creditType: input.creditType } : {}),
      ...(input.warningThreshold !== undefined
        ? { warningThresholdPercent: input.warningThreshold }
        : {}),
      ...(input.actionOnBreach !== undefined ? { actionOnBreach: input.actionOnBreach } : {}),
      ...(input.minimumBalanceWarning !== undefined
        ? { minimumBalanceWarning: input.minimumBalanceWarning }
        : {}),
    };

    if (entity) {
      entity.setPolicy(patch);
    } else {
      const createProps = {
        customerId: input.customerId,
        ...(input.creditType !== undefined ? { creditType: input.creditType } : {}),
        ...(input.warningThreshold !== undefined
          ? { warningThresholdPercent: input.warningThreshold }
          : {}),
        ...(input.actionOnBreach !== undefined ? { actionOnBreach: input.actionOnBreach } : {}),
        ...(input.minimumBalanceWarning !== undefined
          ? { minimumBalanceWarning: input.minimumBalanceWarning }
          : {}),
      };
      entity = CustomerCreditSettingsEntity.create(createProps);
    }

    entity = await this.settingsRepo.upsert(entity);

    // Reload effective credit limit (may have just changed)
    const updatedCustomer = await this.customerPort.getCustomer(input.customerId, input.vendorId);
    const effectiveLimit = updatedCustomer?.creditLimit ?? customer.creditLimit;
    const balance = await this.balancePort.getCustomerBalance(input.customerId, input.vendorId);

    // Warn if new limit is below current outstanding
    const warning =
      input.creditLimit !== undefined && balance > 0 && input.creditLimit < balance
        ? 'limit_below_outstanding'
        : null;

    // Breach evaluation
    const breachResult = entity.evaluateBreach(balance, effectiveLimit);
    let deliveriesPaused = false;

    const props = entity.getProps();
    const actionOnBreach = props.actionOnBreach;

    if (
      breachResult.breached &&
      (actionOnBreach === CreditBreachActionEnum.PAUSE ||
        actionOnBreach === CreditBreachActionEnum.BLOCK)
    ) {
      await this.deliveryControl.pauseCustomer(input.customerId, input.vendorId);
      deliveriesPaused = true;

      const event = new CustomerCreditBreachedEvent(
        input.customerId,
        input.vendorId,
        balance,
        effectiveLimit,
        actionOnBreach,
        { correlationId }
      );
      this.logger.info({ event, correlationId }, 'CustomerCreditBreached event emitted');
    }

    // Emit audit event
    const updatedEvent = new CustomerCreditSettingsUpdatedEvent(
      entity.id,
      input.customerId,
      input.vendorId,
      props.creditType,
      props.actionOnBreach,
      { correlationId }
    );
    this.logger.info(
      { event: updatedEvent, correlationId },
      'CustomerCreditSettingsUpdated event emitted'
    );

    return CreditMapper.toSettingsResponse(
      entity,
      effectiveLimit,
      balance,
      deliveriesPaused,
      warning
    );
  }
}
