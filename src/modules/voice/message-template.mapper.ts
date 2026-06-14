/**
 * MessageTemplateMapper — three-way mapper.
 */
import { MessageTemplate as PrismaMessageTemplate } from '@prisma/client';
import { MessageTemplateEntity, MessageTemplateProps } from './domain/message-template.entity';
import { SupportedLanguageVO } from './domain/value-objects/supported-language.vo';
import { TemplateTypeVO } from './domain/value-objects/template-type.vo';
import { TemplateBodyVO } from './domain/value-objects/template-body.vo';

export interface MessageTemplateResponseDto {
  id: string;
  templateType: string;
  languageCode: string;
  content: string;
  placeholders: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export class MessageTemplateMapper {
  static toDomain(row: PrismaMessageTemplate): MessageTemplateEntity {
    const type = TemplateTypeVO.create(row.templateType);
    const lang = SupportedLanguageVO.create(row.languageCode);
    const body = TemplateBodyVO.create(row.content, type);

    const props: MessageTemplateProps = {
      vendorId: row.vendorId,
      templateType: type,
      languageCode: lang,
      body,
      isActive: row.isActive,
    };
    return MessageTemplateEntity.reconstitute({
      id: row.id,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt ?? null,
      props,
    });
  }

  static toPersistence(entity: MessageTemplateEntity) {
    const p = entity.getProps();
    return {
      vendorId: p.vendorId,
      templateType: p.templateType.value,
      languageCode: p.languageCode.value,
      content: p.body.raw,
      isActive: p.isActive,
    };
  }

  static toResponse(entity: MessageTemplateEntity): MessageTemplateResponseDto {
    const p = entity.getProps();
    return {
      id: p.id.toString(),
      templateType: p.templateType.value.toLowerCase(),
      languageCode: p.languageCode.value.toLowerCase(),
      content: p.body.raw,
      placeholders: p.body.placeholders(),
      isActive: p.isActive,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }
}
