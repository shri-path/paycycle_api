/**
 * GetMessageTemplateQuery — Query (read-only).
 * Fetch a single template by ID, tenant-scoped.
 */
import { NotFoundError } from '@/common/errors/app-error';
import { IMessageTemplateRepository } from '../../database/message-template.repository.port';
import { MessageTemplateMapper, MessageTemplateResponseDto } from '../../message-template.mapper';

export class GetMessageTemplateQuery {
  constructor(private readonly repo: IMessageTemplateRepository) {}

  async execute(id: bigint, vendorId: bigint): Promise<MessageTemplateResponseDto> {
    const entity = await this.repo.findById(id, vendorId);
    if (!entity) throw new NotFoundError('Message template not found');
    return MessageTemplateMapper.toResponse(entity);
  }
}
