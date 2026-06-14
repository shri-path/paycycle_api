/**
 * VoiceCommandLogMapper — persistence mapper (INSERT-only; toResponse for analytics).
 */
import { VoiceCommandLog as PrismaVoiceCommandLog } from '@prisma/client';
import { VoiceCommandLogEntity, VoiceCommandLogProps } from './domain/voice-command-log.entity';
import { SupportedLanguageVO } from './domain/value-objects/supported-language.vo';
import { ConfidenceScoreVO } from './domain/value-objects/confidence-score.vo';

export class VoiceCommandLogMapper {
  static toDomain(row: PrismaVoiceCommandLog): VoiceCommandLogEntity {
    const props: VoiceCommandLogProps = {
      userId: row.userId,
      vendorId: row.vendorId,
      languageCode: SupportedLanguageVO.create(row.languageCode),
      supplyListId: row.supplyListId ?? null,
      customerId: row.customerId ?? null,
      transcription: row.transcription ?? null,
      detectedAction: row.detectedAction ?? null,
      confidenceScore:
        row.confidenceScore != null
          ? ConfidenceScoreVO.create(Number(row.confidenceScore.toString()))
          : null,
      wasExecuted: row.wasExecuted,
      executionResult: (row.executionResult as Record<string, unknown> | null) ?? null,
      errorMessage: row.errorMessage ?? null,
    };
    return VoiceCommandLogEntity.reconstitute({
      id: row.id,
      createdAt: row.createdAt,
      props,
    });
  }

  static toPersistence(entity: VoiceCommandLogEntity) {
    const p = entity.getProps();
    return {
      userId: p.userId,
      vendorId: p.vendorId,
      languageCode: p.languageCode.value,
      supplyListId: p.supplyListId ?? null,
      customerId: p.customerId ?? null,
      transcription: p.transcription ?? null,
      detectedAction: p.detectedAction ?? null,
      confidenceScore: p.confidenceScore?.value ?? null,
      wasExecuted: p.wasExecuted,
      executionResult: p.executionResult ?? null,
      errorMessage: p.errorMessage ?? null,
    };
  }
}
