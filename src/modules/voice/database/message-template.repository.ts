/**
 * MessageTemplateRepository — Prisma adapter with soft-delete filtering.
 */
import { prisma } from '@/infrastructure/database/prisma.client';
import { Prisma } from '@prisma/client';
import { MessageTemplateEntity } from '../domain/message-template.entity';
import { IMessageTemplateRepository } from './message-template.repository.port';
import { MessageTemplateMapper } from '../message-template.mapper';
import { ConflictError } from '@/common/errors/app-error';

export class MessageTemplateRepository implements IMessageTemplateRepository {
  async findByKey(
    vendorId: bigint,
    templateType: string,
    languageCode: string
  ): Promise<MessageTemplateEntity | null> {
    const row = await prisma.messageTemplate.findFirst({
      where: {
        vendorId,
        templateType: templateType as never,
        languageCode: languageCode as never,
        deletedAt: null,
      },
    });
    if (!row) return null;
    return MessageTemplateMapper.toDomain(row);
  }

  async findById(id: bigint, vendorId: bigint): Promise<MessageTemplateEntity | null> {
    const row = await prisma.messageTemplate.findFirst({
      where: { id, vendorId, deletedAt: null },
    });
    if (!row) return null;
    return MessageTemplateMapper.toDomain(row);
  }

  async list(
    vendorId: bigint,
    filters?: { templateType?: string; languageCode?: string }
  ): Promise<MessageTemplateEntity[]> {
    const rows = await prisma.messageTemplate.findMany({
      where: {
        vendorId,
        deletedAt: null,
        ...(filters?.templateType ? { templateType: filters.templateType as never } : {}),
        ...(filters?.languageCode ? { languageCode: filters.languageCode as never } : {}),
      },
      orderBy: [{ templateType: 'asc' }, { languageCode: 'asc' }],
    });
    return rows.map((r) => MessageTemplateMapper.toDomain(r));
  }

  async upsert(
    entity: MessageTemplateEntity
  ): Promise<{ entity: MessageTemplateEntity; created: boolean }> {
    const p = entity.getProps();
    const data = MessageTemplateMapper.toPersistence(entity);

    try {
      // Check if existing (for created flag)
      const existing = await prisma.messageTemplate.findFirst({
        where: {
          vendorId: p.vendorId,
          templateType: data.templateType as never,
          languageCode: data.languageCode as never,
          deletedAt: null,
        },
      });

      let row;
      if (existing) {
        row = await prisma.messageTemplate.update({
          where: { id: existing.id },
          data: {
            content: data.content,
            isActive: data.isActive,
            updatedAt: new Date(),
          },
        });
        return { entity: MessageTemplateMapper.toDomain(row), created: false };
      } else {
        row = await prisma.messageTemplate.create({
          data: {
            vendorId: data.vendorId,
            templateType: data.templateType as never,
            languageCode: data.languageCode as never,
            content: data.content,
            isActive: data.isActive,
          },
        });
        return { entity: MessageTemplateMapper.toDomain(row), created: true };
      }
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictError(
          'Template already exists for this vendor/type/language combination'
        );
      }
      throw err;
    }
  }
}
