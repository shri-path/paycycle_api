/**
 * ExecuteVoiceCommandCommand — Command.
 * Validates intent, resolves delivery, delegates to IDeliveryActionPort,
 * then marks/inserts the voice command log.
 */
import { randomUUID } from 'crypto';
import { Logger } from '@/infrastructure/logger/logger';
import { NotFoundError } from '@/common/errors/app-error';
import { RoleContext } from '@/infrastructure/middlewares/rbac/role-context';
import { IDeliveryActionPort } from '../../ports/delivery-action.port';
import { ICustomerLookupPort } from '../../ports/customer-lookup.port';
import { IVoiceCommandLogRepository } from '../../database/voice-command-log.repository.port';
import { VoiceCommandLogEntity } from '../../domain/voice-command-log.entity';
import { UnprocessableVoiceCommandError } from '../../domain/voice.errors';
import { VoiceIntentAction } from '../../domain/voice.types';
import { ExecuteResponseDto } from '../../voice.types';
import { appToday } from '@/modules/delivery/delivery.shared';

export interface ExecuteVoiceCommandInput {
  userId: bigint;
  vendorId: bigint;
  /** The caller's real RoleContext (from req.roleContext) — threaded to the delivery RBAC check. */
  roleCtx: RoleContext;
  interpretation: {
    action: string;
    customerId?: bigint | null | undefined;
    quantity?: number | null | undefined;
  };
  supplyListId: bigint;
  serviceDate?: string | undefined;
  logId?: bigint | null | undefined;
}

export class ExecuteVoiceCommandCommand {
  constructor(
    private readonly deliveryPort: IDeliveryActionPort,
    private readonly customerLookup: ICustomerLookupPort,
    private readonly logRepo: IVoiceCommandLogRepository,
    private readonly logger: Logger
  ) {}

  async execute(input: ExecuteVoiceCommandInput): Promise<ExecuteResponseDto> {
    const correlationId = randomUUID();
    this.logger.info(
      {
        correlationId,
        userId: input.userId.toString(),
        vendorId: input.vendorId.toString(),
        action: input.interpretation.action,
      },
      'ExecuteVoiceCommand: start'
    );

    const actionUpper = input.interpretation.action.toUpperCase() as VoiceIntentAction;

    // Unknown action → 422
    if (actionUpper === VoiceIntentAction.UNKNOWN) {
      throw new UnprocessableVoiceCommandError(
        'Cannot execute an UNKNOWN voice command. Please clarify and try again.'
      );
    }

    const serviceDate = input.serviceDate
      ? new Date(input.serviceDate + 'T00:00:00.000Z')
      : appToday();

    const ctx = {
      userId: input.userId,
      vendorId: input.vendorId,
      correlationId,
      roleCtx: input.roleCtx,
    };
    let result: ExecuteResponseDto;

    if (actionUpper === VoiceIntentAction.MARK_ALL) {
      const markResult = await this.deliveryPort.markAllPending(
        ctx,
        input.supplyListId,
        serviceDate
      );
      result = {
        executed: true,
        action: 'mark_all',
        markedCount: markResult.markedCount,
      };

      await this._upsertLog(input, correlationId, {
        action: 'mark_all',
        markedCount: markResult.markedCount,
      });
    } else {
      // All other actions require a customerId
      if (!input.interpretation.customerId) {
        throw new UnprocessableVoiceCommandError(
          'customerId is required for this voice command action.'
        );
      }
      const customerId = input.interpretation.customerId;

      // Resolve delivery ID
      const deliveryId = await this.deliveryPort.resolveDeliveryId(
        input.vendorId,
        input.supplyListId,
        customerId,
        serviceDate
      );
      if (!deliveryId) {
        throw new NotFoundError('No pending delivery found for this customer on the given date.');
      }

      // Determine delivery status
      let deliveryStatus: 'DELIVERED' | 'LEAVE';
      if (
        actionUpper === VoiceIntentAction.MARK_DELIVERED ||
        actionUpper === VoiceIntentAction.ADJUST_QUANTITY
      ) {
        deliveryStatus = 'DELIVERED';
      } else if (actionUpper === VoiceIntentAction.MARK_LEAVE) {
        deliveryStatus = 'LEAVE';
      } else {
        throw new UnprocessableVoiceCommandError(
          `Unsupported action: ${input.interpretation.action}`
        );
      }

      await this.deliveryPort.markDelivery(ctx, deliveryId, deliveryStatus);

      // Fetch customer name for response
      const customer = await this.customerLookup.getCustomer(customerId, input.vendorId);

      result = {
        executed: true,
        action: input.interpretation.action,
        customerId: customerId.toString(),
        customerName: customer?.name ?? null,
        deliveryId: deliveryId.toString(),
        status: deliveryStatus,
      };

      await this._upsertLog(input, correlationId, {
        action: input.interpretation.action,
        deliveryId: deliveryId.toString(),
        status: deliveryStatus,
      });
    }

    this.logger.info({ correlationId, result }, 'ExecuteVoiceCommand: done');

    return result;
  }

  private async _upsertLog(
    input: ExecuteVoiceCommandInput,
    correlationId: string,
    executionResult: Record<string, unknown>
  ): Promise<void> {
    try {
      if (input.logId) {
        await this.logRepo.markExecuted(input.logId, { executionResult });
      } else {
        const logEntity = VoiceCommandLogEntity.record({
          userId: input.userId,
          vendorId: input.vendorId,
          languageCode: 'EN', // not critical for execute-only logs
          supplyListId: input.supplyListId,
          customerId: input.interpretation.customerId ?? null,
          detectedAction: input.interpretation.action.toUpperCase(),
          wasExecuted: true,
          executionResult,
        });
        await this.logRepo.insert(logEntity);
      }
    } catch (err) {
      // Log failures must not break the response
      this.logger.warn({ err, correlationId }, 'ExecuteVoiceCommand: failed to upsert log');
    }
  }
}
