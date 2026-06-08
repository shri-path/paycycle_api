import { Prisma } from '@prisma/client';
import { prisma, PrismaTransaction } from '@/infrastructure/database/prisma.client';
import { Logger } from '@/infrastructure/logger/logger';
import { AuditPort, AuditLogInput } from './audit.port';

/**
 * Writes audit entries to `audit_logs`. Shared across all modules.
 *
 * Failure policy: an audit write must NEVER break the business operation.
 * On failure we emit a `warn` (with correlationId) and swallow the error.
 */
export class AuditLogger implements AuditPort {
  constructor(private readonly logger: Logger) {}

  async log(input: AuditLogInput, tx?: PrismaTransaction): Promise<void> {
    try {
      const client = tx ?? prisma;
      await client.auditLog.create({
        data: {
          vendorId: input.vendorId,
          performedByUserId: input.performedByUserId,
          performedByRole: input.performedByRole ?? null,
          action: input.action,
          entityType: input.entityType ?? null,
          entityId: input.entityId ?? null,
          ...(input.metadata !== undefined
            ? { metadata: input.metadata as Prisma.InputJsonValue }
            : {}),
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
        },
      });
    } catch (error) {
      this.logger.warn(
        {
          err: error,
          action: input.action,
          vendorId: input.vendorId.toString(),
          entityId: input.entityId?.toString() ?? null,
          correlationId: input.correlationId,
        },
        'AuditLogger: failed to persist audit entry (swallowed)'
      );
    }
  }
}
