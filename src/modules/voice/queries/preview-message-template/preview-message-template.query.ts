/**
 * PreviewMessageTemplateQuery — Query (read-only, no persistence).
 * Render a template (supplied or saved) with sample data.
 */
import { NotFoundError } from '@/common/errors/app-error';
import { IMessageTemplateRepository } from '../../database/message-template.repository.port';
import { MessageTemplateEntity } from '../../domain/message-template.entity';

export interface PreviewMessageTemplateInput {
  vendorId: bigint;
  templateType: string;
  languageCode: string;
  content?: string | undefined;
  sampleData?: Record<string, string> | undefined;
}

export interface PreviewResponseDto {
  preview: string;
  unresolved: string[];
}

export class PreviewMessageTemplateQuery {
  constructor(private readonly repo: IMessageTemplateRepository) {}

  async execute(input: PreviewMessageTemplateInput): Promise<PreviewResponseDto> {
    let entity: MessageTemplateEntity;

    if (input.content) {
      // Inline preview — create a transient entity (validates placeholders)
      entity = MessageTemplateEntity.create({
        vendorId: input.vendorId,
        templateType: input.templateType.toUpperCase(),
        languageCode: input.languageCode.toUpperCase(),
        content: input.content,
      });
    } else {
      // Load saved template
      const saved = await this.repo.findByKey(
        input.vendorId,
        input.templateType.toUpperCase(),
        input.languageCode.toUpperCase()
      );
      if (!saved) {
        throw new NotFoundError(
          `No saved template found for type "${input.templateType}" in language "${input.languageCode}"`
        );
      }
      entity = saved;
    }

    const { text, unresolved } = entity.render(input.sampleData ?? {});
    return { preview: text, unresolved };
  }
}
