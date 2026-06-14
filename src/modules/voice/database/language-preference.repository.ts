/**
 * LanguagePreferenceRepository — Prisma adapter.
 */
import { prisma, PrismaTransaction } from '@/infrastructure/database/prisma.client';
import { LanguagePreferenceEntity } from '../domain/language-preference.entity';
import { ILanguagePreferenceRepository } from './language-preference.repository.port';
import { LanguagePreferenceMapper } from '../language-preference.mapper';

export class LanguagePreferenceRepository implements ILanguagePreferenceRepository {
  async findByUser(userId: bigint): Promise<LanguagePreferenceEntity | null> {
    const row = await prisma.languagePreference.findUnique({ where: { userId } });
    if (!row) return null;
    return LanguagePreferenceMapper.toDomain(row);
  }

  async upsert(
    entity: LanguagePreferenceEntity,
    tx?: PrismaTransaction
  ): Promise<LanguagePreferenceEntity> {
    const p = entity.getProps();
    const data = LanguagePreferenceMapper.toPersistence(entity);
    const client = tx ?? prisma;

    const row = await client.languagePreference.upsert({
      where: { userId: p.userId },
      update: {
        appLanguage: data.appLanguage as never,
        secondaryLanguage: data.secondaryLanguage as never,
        voiceCommandsEnabled: data.voiceCommandsEnabled,
        voiceResponsesEnabled: data.voiceResponsesEnabled,
        transliterationEnabled: data.transliterationEnabled,
        billLanguageDefault: data.billLanguageDefault as never,
        preferredVoiceAccent: data.preferredVoiceAccent,
        updatedAt: new Date(),
      },
      create: {
        userId: data.userId,
        appLanguage: data.appLanguage as never,
        secondaryLanguage: data.secondaryLanguage as never,
        voiceCommandsEnabled: data.voiceCommandsEnabled,
        voiceResponsesEnabled: data.voiceResponsesEnabled,
        transliterationEnabled: data.transliterationEnabled,
        billLanguageDefault: data.billLanguageDefault as never,
        preferredVoiceAccent: data.preferredVoiceAccent,
      },
    });

    return LanguagePreferenceMapper.toDomain(row);
  }
}
