/**
 * UpsertMessageTemplateCommand — Command (state-changing).
 * Upsert a vendor message template. Owner-only; tenant-scoped.
 */
import { randomUUID } from 'crypto';
import { Logger } from '@/infrastructure/logger/logger';
import { IMessageTemplateRepository } from '../../database/message-template.repository.port';
import { MessageTemplateEntity } from '../../domain/message-template.entity';
import { MessageTemplateMapper, MessageTemplateResponseDto } from '../../message-template.mapper';

export interface UpsertMessageTemplateInput {
  vendorId: bigint;
  templateType: string;
  languageCode: string;
  content: string;
}

export interface UpsertMessageTemplateResult {
  dto: MessageTemplateResponseDto;
  created: boolean;
}

export class UpsertMessageTemplateCommand {
  constructor(
    private readonly repo: IMessageTemplateRepository,
    private readonly logger: Logger
  ) {}

  async execute(input: UpsertMessageTemplateInput): Promise<UpsertMessageTemplateResult> {
    const correlationId = randomUUID();
    this.logger.info(
      {
        correlationId,
        vendorId: input.vendorId.toString(),
        templateType: input.templateType,
        languageCode: input.languageCode,
      },
      'UpsertMessageTemplate: start'
    );

    // Build entity (validates type, language, placeholder whitelist via domain)
    const entity = MessageTemplateEntity.create({
      vendorId: input.vendorId,
      templateType: input.templateType.toUpperCase(),
      languageCode: input.languageCode.toUpperCase(),
      content: input.content,
    });

    const { entity: saved, created } = await this.repo.upsert(entity);

    this.logger.info(
      { correlationId, id: saved.id.toString(), created },
      'UpsertMessageTemplate: done'
    );

    return { dto: MessageTemplateMapper.toResponse(saved), created };
  }
}
