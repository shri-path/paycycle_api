import { PrismaTransaction } from '@/infrastructure/database/prisma.client';
import { AuditAction } from './audit-action.enum';

export interface AuditLogInput {
  vendorId: bigint;
  performedByUserId: bigint | null;
  performedByRole?: string;
  action: AuditAction;
  entityType?: string;
  entityId?: bigint | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
  /** Correlates the audit entry with the originating request/log line. */
  correlationId?: string;
}

/**
 * Open-host audit logging contract. Implementations MUST NOT throw into the
 * request path — a failed audit write is logged and swallowed.
 */
export interface AuditPort {
  log(input: AuditLogInput, tx?: PrismaTransaction): Promise<void>;
}
