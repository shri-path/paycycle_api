/**
 * UpsertLanguagePreferenceCommand — Command (state-changing).
 * Upsert user language preferences + sync users.preferred_language.
 * Self-guard: :userId must equal caller (enforced in routes; checked here too).
 */
import { randomUUID } from 'crypto';
import { Logger } from '@/infrastructure/logger/logger';
import { ForbiddenError } from '@/common/errors/app-error';
import { prisma } from '@/infrastructure/database/prisma.client';
import { ILanguagePreferenceRepository } from '../../database/language-preference.repository.port';
import { LanguagePreferenceEntity } from '../../domain/language-preference.entity';
import {
  LanguagePreferenceMapper,
  LanguagePreferenceResponseDto,
} from '../../language-preference.mapper';

export interface UpsertLanguagePreferenceInput {
  userId: bigint;
  callerId: bigint; // authenticated user
  patch: {
    appLanguage?: string;
    secondaryLanguage?: string | null;
    voiceCommandsEnabled?: boolean;
    voiceResponsesEnabled?: boolean;
    transliterationEnabled?: boolean;
    billLanguageDefault?: string;
    preferredVoiceAccent?: string | null;
  };
}

export class UpsertLanguagePreferenceCommand {
  constructor(
    private readonly repo: ILanguagePreferenceRepository,
    private readonly logger: Logger
  ) {}

  async execute(input: UpsertLanguagePreferenceInput): Promise<LanguagePreferenceResponseDto> {
    const correlationId = randomUUID();
    this.logger.info(
      { correlationId, userId: input.userId.toString() },
      'UpsertLanguagePreference: start'
    );

    // Self-guard
    if (input.callerId !== input.userId) {
      throw new ForbiddenError('You may only update your own language preferences');
    }

    // Load or create default entity
    let entity = await this.repo.findByUser(input.userId);
    if (!entity) {
      entity = LanguagePreferenceEntity.createDefault(input.userId);
    }

    // Per API spec: if appLanguage is being set to 'en', the server silently forces
    // transliterationEnabled=false before validation runs (not a 400 error).
    const resolvedPatch = { ...input.patch };
    if (resolvedPatch.appLanguage?.toLowerCase() === 'en') {
      resolvedPatch.transliterationEnabled = false;
    }

    // Apply patch — validate() runs inside update() after the silent override above
    entity.update(resolvedPatch);
    // Safety: also force off in case entity was already EN before the patch
    entity.forceTransliterationOffForEnglish();

    // Persist both writes atomically so language_preferences and users.preferred_language
    // never diverge if one write fails (MAJOR-5: transaction required for multi-step mutation).
    const savedEntity = await prisma.$transaction(async (tx) => {
      const persisted = await this.repo.upsert(entity, tx);
      const appLang = persisted.getProps().appLanguage.value.toLowerCase();
      await tx.user.update({
        where: { id: input.userId },
        data: { preferredLanguage: appLang },
      });
      return persisted;
    });

    this.logger.info(
      {
        correlationId,
        userId: input.userId.toString(),
        appLang: savedEntity.getProps().appLanguage.value.toLowerCase(),
      },
      'UpsertLanguagePreference: done'
    );

    return LanguagePreferenceMapper.toResponse(savedEntity);
  }
}
