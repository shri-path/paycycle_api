import { prisma } from '@/infrastructure/database/prisma.client';
import { Prisma } from '@prisma/client';
import { CustomerCreditSettingsEntity } from '../domain/customer-credit-settings.entity';
import { CreditTypeEnum, CreditBreachActionEnum } from '../domain/credit.types';
import { ICreditSettingsRepository } from './credit-settings.repository.port';
import { ConflictError } from '@/common/errors/app-error';

export class CreditSettingsRepository implements ICreditSettingsRepository {
  async findByCustomer(customerId: bigint): Promise<CustomerCreditSettingsEntity | null> {
    const row = await prisma.customerCreditSettings.findUnique({
      where: { customerId },
    });
    if (!row) return null;

    return CustomerCreditSettingsEntity.reconstitute({
      id: row.id,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      props: {
        customerId: row.customerId,
        creditType: row.creditType as CreditTypeEnum,
        warningThresholdPercent: row.warningThresholdPercent,
        actionOnBreach: row.actionOnBreach as CreditBreachActionEnum,
        minimumBalanceWarning: row.minimumBalanceWarning
          ? Number(row.minimumBalanceWarning.toString())
          : null,
      },
    });
  }

  async upsert(entity: CustomerCreditSettingsEntity): Promise<CustomerCreditSettingsEntity> {
    const props = entity.getProps();

    const data = {
      creditType: props.creditType,
      warningThresholdPercent: props.warningThresholdPercent,
      actionOnBreach: props.actionOnBreach,
      minimumBalanceWarning: props.minimumBalanceWarning ?? null,
    };

    try {
      const row = await prisma.customerCreditSettings.upsert({
        where: { customerId: props.customerId },
        update: { ...data, updatedAt: new Date() },
        create: { customerId: props.customerId, ...data },
      });

      return CustomerCreditSettingsEntity.reconstitute({
        id: row.id,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        props: {
          customerId: row.customerId,
          creditType: row.creditType as CreditTypeEnum,
          warningThresholdPercent: row.warningThresholdPercent,
          actionOnBreach: row.actionOnBreach as CreditBreachActionEnum,
          minimumBalanceWarning: row.minimumBalanceWarning
            ? Number(row.minimumBalanceWarning.toString())
            : null,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictError('Credit settings already exist for this customer');
      }
      throw err;
    }
  }
}
