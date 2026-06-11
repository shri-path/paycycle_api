import crypto from 'crypto';
import { Logger } from '@/infrastructure/logger/logger';
import { AppError, InternalServerError } from '@/common/errors/app-error';
import { AuditPort } from '@/common/audit/audit.port';
import { AuditAction } from '@/common/audit/audit-action.enum';
import { SubscriptionEntity } from '../../domain/subscription.entity';
import { ListDefaults } from '../../domain/subscription.types';
import {
  AllCustomersAlreadySubscribedError,
  CustomerNotInVendorError,
  SupplyListNotFoundError,
} from '../../domain/supply-list.errors';
import { ISupplyListRepository } from '../../database/supply-list.repository.port';
import { ISubscriptionRepository } from '../../database/subscription.repository.port';
import { buildSubscriptionDtos } from '../../database/subscription-projection';
import { CustomerDirectoryPort } from '../../ports/customer-directory.port';
import { AddCustomersResultDto } from '../../supply-list.types';

export interface AddCustomersRequestDto {
  vendorId: bigint;
  listId: bigint;
  customerIds: bigint[];
  useDefaultQuantity: boolean;
  customQuantity: number | null;
  useDefaultRate: boolean;
  customRate: number | null;
  startDate: Date | null;
  actorUserId: bigint;
  actorRole: string;
  ip: string | null;
  userAgent: string | null;
}

export class AddCustomersService {
  constructor(
    private readonly listRepository: ISupplyListRepository,
    private readonly subscriptionRepository: ISubscriptionRepository,
    private readonly customerDirectory: CustomerDirectoryPort,
    private readonly auditLogger: AuditPort,
    private readonly logger: Logger
  ) {}

  /** Command: bulk-subscribe customers to a list (dedupe + per-item skip). */
  async execute(dto: AddCustomersRequestDto): Promise<AddCustomersResultDto> {
    const correlationId = crypto.randomUUID();

    const list = await this.listRepository.findById(dto.listId, dto.vendorId);
    if (!list || list.deletedAt !== null) {
      throw new SupplyListNotFoundError();
    }

    // De-dupe the incoming ids.
    const requestedIds = dedupe(dto.customerIds);

    // Validate vendor membership (422 if any offender).
    const notInVendor = await this.customerDirectory.findCustomersNotInVendor(
      dto.vendorId,
      requestedIds
    );
    if (notInVendor.length > 0) {
      throw new CustomerNotInVendorError(
        `Customers not in this vendor: ${notInVendor.map((i) => i.toString()).join(', ')}`
      );
    }

    // Existing non-ended subscriptions on this list → skip.
    const existing = new Set(
      (await this.subscriptionRepository.findNonEndedSubscriptionCustomerIds(dto.listId)).map((i) =>
        i.toString()
      )
    );

    const skipped: Array<{ customerId: string; reason: string }> = [];
    const newIds: bigint[] = [];
    for (const id of requestedIds) {
      if (existing.has(id.toString())) {
        skipped.push({ customerId: id.toString(), reason: 'Already subscribed to this list' });
      } else {
        newIds.push(id);
      }
    }

    if (newIds.length === 0) {
      throw new AllCustomersAlreadySubscribedError();
    }

    const customQuantity = dto.useDefaultQuantity ? null : dto.customQuantity;
    const customRate = dto.useDefaultRate ? null : dto.customRate;
    const startDate = dto.startDate ?? new Date();

    const entities = newIds.map((customerId) =>
      SubscriptionEntity.create({
        vendorId: dto.vendorId,
        supplyListId: dto.listId,
        customerId,
        customQuantity,
        customRatePerUnit: customRate,
        startDate,
        correlationId,
      })
    );

    let createdRecords;
    try {
      createdRecords = await this.subscriptionRepository.insertMany(entities);
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.logger.error({ err: error, correlationId }, 'AddCustomersService: insert failed');
      throw new InternalServerError('Failed to add customers. Please try again.');
    }

    await this.auditLogger.log({
      vendorId: dto.vendorId,
      performedByUserId: dto.actorUserId,
      performedByRole: dto.actorRole,
      action: AuditAction.CUSTOMERS_ADDED,
      entityType: 'supply_list',
      entityId: dto.listId,
      metadata: { addedCount: createdRecords.length, skippedCount: skipped.length },
      ipAddress: dto.ip,
      userAgent: dto.userAgent,
      correlationId,
    });

    const listDefaults: ListDefaults = {
      defaultQuantity:
        list.defaultQuantity === null ? null : Number(list.defaultQuantity.toString()),
      ratePerUnit: list.ratePerUnit === null ? null : Number(list.ratePerUnit.toString()),
    };

    const subscriptions = await buildSubscriptionDtos(
      createdRecords,
      dto.vendorId,
      dto.listId,
      listDefaults,
      this.subscriptionRepository,
      this.customerDirectory
    );

    this.logger.info(
      {
        vendorId: dto.vendorId.toString(),
        listId: dto.listId.toString(),
        added: createdRecords.length,
        skipped: skipped.length,
        correlationId,
      },
      'AddCustomersService: customers added'
    );

    return {
      addedCount: createdRecords.length,
      skippedCount: skipped.length,
      subscriptions,
      skipped,
    };
  }
}

function dedupe(ids: bigint[]): bigint[] {
  const seen = new Set<string>();
  const out: bigint[] = [];
  for (const id of ids) {
    if (!seen.has(id.toString())) {
      seen.add(id.toString());
      out.push(id);
    }
  }
  return out;
}
