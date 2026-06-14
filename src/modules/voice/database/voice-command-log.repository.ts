/**
 * VoiceCommandLogRepository — INSERT-only Prisma adapter.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/infrastructure/database/prisma.client';
import { VoiceCommandLogEntity } from '../domain/voice-command-log.entity';
import { IVoiceCommandLogRepository } from './voice-command-log.repository.port';
import { VoiceCommandLogMapper } from '../voice-command-log.mapper';

export class VoiceCommandLogRepository implements IVoiceCommandLogRepository {
  async insert(entity: VoiceCommandLogEntity): Promise<VoiceCommandLogEntity> {
    const data = VoiceCommandLogMapper.toPersistence(entity);

    const row = await prisma.voiceCommandLog.create({
      data: {
        userId: data.userId,
        vendorId: data.vendorId,
        languageCode: data.languageCode as never,
        supplyListId: data.supplyListId ?? null,
        customerId: data.customerId ?? null,
        transcription: data.transcription ?? null,
        detectedAction: data.detectedAction ?? null,
        confidenceScore: data.confidenceScore ?? null,
        wasExecuted: data.wasExecuted,
        executionResult:
          data.executionResult != null
            ? (data.executionResult as Prisma.InputJsonValue)
            : Prisma.JsonNull,
        errorMessage: data.errorMessage ?? null,
      },
    });
    return VoiceCommandLogMapper.toDomain(row);
  }

  async markExecuted(
    logId: bigint,
    result: { executionResult: Record<string, unknown>; errorMessage?: string | null }
  ): Promise<void> {
    await prisma.voiceCommandLog.update({
      where: { id: logId },
      data: {
        wasExecuted: true,
        executionResult: result.executionResult as Prisma.InputJsonValue,
        errorMessage: result.errorMessage ?? null,
      },
    });
  }
}
