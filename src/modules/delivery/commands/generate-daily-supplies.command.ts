import crypto from 'crypto';
import { DailySupplyStatus } from '@prisma/client';
import { Logger } from '@/infrastructure/logger/logger';
import { AuditPort } from '@/common/audit/audit.port';
import { AuditAction } from '@/common/audit/audit-action.enum';
import { RoleContext } from '@/infrastructure/middlewares/rbac/role-context';
import { DailySupplyEntity, ServiceDate } from '../delivery.domain';
import { IDeliveryRepository } from '../delivery.repository.port';
import { DeliveryReader } from '../delivery.reader';
import { ActorMeta, shouldGenerateForDate } from '../delivery.shared';
import { GenerateResultDto } from '../delivery.types';

/** Command: generate daily supplies for a vendor (manual endpoint + cron fan-out). */
export class GenerateDailySuppliesCommand {
  constructor(
    private readonly repository: IDeliveryRepository,
    private readonly reader: DeliveryReader,
    private readonly auditLogger: AuditPort,
    private readonly logger: Logger
  ) {}

  /** Generate for the caller's vendor and audit the run. */
  async execute(ctx: RoleContext, date: Date, meta: ActorMeta): Promise<GenerateResultDto> {
    const correlationId = crypto.randomUUID();
    const result = await this.generateForVendor(ctx.vendorId, date, correlationId);

    await this.auditLogger.log({
      vendorId: ctx.vendorId,
      performedByUserId: ctx.userId,
      performedByRole: ctx.roleName,
      action: AuditAction.DELIVERIES_GENERATED,
      entityType: 'vendor',
      entityId: ctx.vendorId,
      metadata: { generated: result.generated, date: result.date },
      ipAddress: meta.ip,
      userAgent: meta.userAgent,
      correlationId,
    });

    return result;
  }

  /** Idempotent per-vendor fan-out. Reused by the cron. */
  async generateForVendor(
    vendorId: bigint,
    date: Date,
    correlationId: string
  ): Promise<GenerateResultDto> {
    const serviceDate = ServiceDate.create(date).value;
    const subscriptions = await this.reader.getActiveSubscriptionsForGeneration(
      vendorId,
      serviceDate
    );

    const rows = [];
    let skipped = 0;
    for (const sub of subscriptions) {
      if (!shouldGenerateForDate(sub.frequency, sub.frequencyDays, serviceDate)) {
        skipped += 1;
        continue;
      }
      const onLeave = await this.repository.hasLeaveCovering(sub.subscriptionId, serviceDate);
      const entity = DailySupplyEntity.create({
        vendorId: sub.vendorId,
        supplyListCustomerId: sub.subscriptionId,
        supplyListId: sub.supplyListId,
        serviceDate,
        quantity: sub.quantity,
        unit: sub.unit,
        ratePerUnit: sub.ratePerUnit,
        onLeave,
      });
      const props = entity.getProps();
      rows.push({
        vendorId: props.vendorId,
        supplyListCustomerId: props.supplyListCustomerId,
        supplyListId: props.supplyListId,
        serviceDate: props.serviceDate,
        status: props.status as DailySupplyStatus,
        quantity: props.quantity,
        unit: props.unit,
        ratePerUnit: props.ratePerUnit,
        baseAmount: props.baseAmount,
        finalAmount: props.finalAmount,
      });
    }

    const generated = await this.repository.insertGenerated(rows);
    const totalSkipped = skipped + (rows.length - generated);
    this.logger.info(
      { vendorId: vendorId.toString(), generated, skipped: totalSkipped, correlationId },
      'generateForVendor: generation run complete'
    );
    return { generated, skipped: totalSkipped, date: serviceDate.toISOString().slice(0, 10) };
  }
}
