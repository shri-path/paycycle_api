/**
 * ListMessageTemplatesQuery — Query (read-only).
 * List vendor templates, optionally filtered by type and language.
 */
import { IMessageTemplateRepository } from '../../database/message-template.repository.port';
import { MessageTemplateMapper, MessageTemplateResponseDto } from '../../message-template.mapper';

export interface ListMessageTemplatesInput {
  vendorId: bigint;
  templateType?: string | undefined;
  languageCode?: string | undefined;
}

export class ListMessageTemplatesQuery {
  constructor(private readonly repo: IMessageTemplateRepository) {}

  async execute(input: ListMessageTemplatesInput): Promise<MessageTemplateResponseDto[]> {
    const entities = await this.repo.list(input.vendorId, {
      templateType: input.templateType?.toUpperCase(),
      languageCode: input.languageCode?.toUpperCase(),
    });
    return entities.map((e) => MessageTemplateMapper.toResponse(e));
  }
}
