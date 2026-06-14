/**
 * LanguagePreferenceMapper — three-way mapper: DB row ↔ Domain entity ↔ Response DTO.
 */
import { LanguagePreference as PrismaLanguagePreference } from '@prisma/client';
import {
  LanguagePreferenceEntity,
  LanguagePreferenceProps,
} from './domain/language-preference.entity';
import { SupportedLanguageVO } from './domain/value-objects/supported-language.vo';
import { BillLanguagePolicyVO } from './domain/value-objects/bill-language-policy.vo';

export interface LanguagePreferenceResponseDto {
  appLanguage: string;
  secondaryLanguage: string | null;
  voiceCommandsEnabled: boolean;
  voiceResponsesEnabled: boolean;
  transliterationEnabled: boolean;
  billLanguageDefault: string;
  preferredVoiceAccent: string | null;
}

export class LanguagePreferenceMapper {
  static toDomain(row: PrismaLanguagePreference): LanguagePreferenceEntity {
    const props: LanguagePreferenceProps = {
      userId: row.userId,
      appLanguage: SupportedLanguageVO.create(row.appLanguage),
      secondaryLanguage: row.secondaryLanguage
        ? SupportedLanguageVO.create(row.secondaryLanguage)
        : null,
      voiceCommandsEnabled: row.voiceCommandsEnabled,
      voiceResponsesEnabled: row.voiceResponsesEnabled,
      transliterationEnabled: row.transliterationEnabled,
      billLanguageDefault: BillLanguagePolicyVO.create(row.billLanguageDefault),
      preferredVoiceAccent: row.preferredVoiceAccent ?? null,
    };
    return LanguagePreferenceEntity.reconstitute({
      id: row.id,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      props,
    });
  }

  static toPersistence(entity: LanguagePreferenceEntity) {
    const p = entity.getProps();
    return {
      userId: p.userId,
      appLanguage: p.appLanguage.value,
      secondaryLanguage: p.secondaryLanguage?.value ?? null,
      voiceCommandsEnabled: p.voiceCommandsEnabled,
      voiceResponsesEnabled: p.voiceResponsesEnabled,
      transliterationEnabled: p.transliterationEnabled,
      billLanguageDefault: p.billLanguageDefault.value,
      preferredVoiceAccent: p.preferredVoiceAccent ?? null,
    };
  }

  static toResponse(entity: LanguagePreferenceEntity): LanguagePreferenceResponseDto {
    const p = entity.getProps();
    // Whitelist: never expose userId or id
    return {
      appLanguage: p.appLanguage.value.toLowerCase(),
      secondaryLanguage: p.secondaryLanguage?.value.toLowerCase() ?? null,
      voiceCommandsEnabled: p.voiceCommandsEnabled,
      voiceResponsesEnabled: p.voiceResponsesEnabled,
      transliterationEnabled: p.transliterationEnabled,
      billLanguageDefault: p.billLanguageDefault.value.toLowerCase(),
      preferredVoiceAccent: p.preferredVoiceAccent,
    };
  }
}
