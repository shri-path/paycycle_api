import { prisma } from '@/infrastructure/database/prisma.client';
import { Prisma } from '@prisma/client';
import { ReminderConfigEntity } from '../domain/reminder-config.entity';
import { ReminderConfigProps } from '../domain/credit.types';
import { IReminderConfigRepository } from './reminder-config.repository.port';
import { ConflictError } from '@/common/errors/app-error';

function rowToProps(row: {
  vendorId: bigint;
  autoRemindersEnabled: boolean;
  schedule3Days: boolean;
  schedule15Days: boolean;
  schedule30Days: boolean;
  reminderTemplate: string | null;
  excludedCustomerIds: Prisma.JsonValue;
}): ReminderConfigProps {
  const ids = Array.isArray(row.excludedCustomerIds) ? (row.excludedCustomerIds as number[]) : [];
  return {
    vendorId: row.vendorId,
    autoRemindersEnabled: row.autoRemindersEnabled,
    schedule3Days: row.schedule3Days,
    schedule15Days: row.schedule15Days,
    schedule30Days: row.schedule30Days,
    reminderTemplate: row.reminderTemplate,
    excludedCustomerIds: ids,
  };
}

export class ReminderConfigRepository implements IReminderConfigRepository {
  async findByVendor(vendorId: bigint): Promise<ReminderConfigEntity | null> {
    const row = await prisma.reminderConfig.findUnique({ where: { vendorId } });
    if (!row) return null;

    return ReminderConfigEntity.reconstitute({
      id: row.id,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      props: rowToProps(row),
    });
  }

  async upsert(entity: ReminderConfigEntity): Promise<ReminderConfigEntity> {
    const p = entity.getProps();
    const data = {
      autoRemindersEnabled: p.autoRemindersEnabled,
      schedule3Days: p.schedule3Days,
      schedule15Days: p.schedule15Days,
      schedule30Days: p.schedule30Days,
      reminderTemplate: p.reminderTemplate ?? null,
      excludedCustomerIds: p.excludedCustomerIds,
    };

    try {
      const row = await prisma.reminderConfig.upsert({
        where: { vendorId: p.vendorId },
        update: { ...data, updatedAt: new Date() },
        create: { vendorId: p.vendorId, ...data },
      });

      return ReminderConfigEntity.reconstitute({
        id: row.id,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        props: rowToProps(row),
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictError('Reminder config already exists for this vendor');
      }
      throw err;
    }
  }
}
