import { MessageTemplateEntity } from '../domain/message-template.entity';

export interface IMessageTemplateRepository {
  findByKey(
    vendorId: bigint,
    templateType: string,
    languageCode: string
  ): Promise<MessageTemplateEntity | null>;
  findById(id: bigint, vendorId: bigint): Promise<MessageTemplateEntity | null>;
  list(
    vendorId: bigint,
    filters?: { templateType?: string | undefined; languageCode?: string | undefined }
  ): Promise<MessageTemplateEntity[]>;
  upsert(
    entity: MessageTemplateEntity
  ): Promise<{ entity: MessageTemplateEntity; created: boolean }>;
}
