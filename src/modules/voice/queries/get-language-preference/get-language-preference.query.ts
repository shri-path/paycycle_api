/**
 * GetLanguagePreferenceQuery — Query (read-only).
 * Returns the user's language preferences, or defaults if no row exists.
 * Self-guard: callerId must equal userId (consistent with UpsertLanguagePreferenceCommand).
 */
import { ForbiddenError } from '@/common/errors/app-error';
import { ILanguagePreferenceRepository } from '../../database/language-preference.repository.port';
import { LanguagePreferenceEntity } from '../../domain/language-preference.entity';
import {
  LanguagePreferenceMapper,
  LanguagePreferenceResponseDto,
} from '../../language-preference.mapper';

export class GetLanguagePreferenceQuery {
  constructor(private readonly repo: ILanguagePreferenceRepository) {}

  async execute(userId: bigint, callerId: bigint): Promise<LanguagePreferenceResponseDto> {
    if (callerId !== userId) {
      throw new ForbiddenError('You may only view your own language preferences');
    }
    let entity = await this.repo.findByUser(userId);
    if (!entity) {
      entity = LanguagePreferenceEntity.createDefault(userId);
    }
    return LanguagePreferenceMapper.toResponse(entity);
  }
}
