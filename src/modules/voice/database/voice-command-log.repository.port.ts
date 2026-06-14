import { VoiceCommandLogEntity } from '../domain/voice-command-log.entity';

export interface IVoiceCommandLogRepository {
  insert(entity: VoiceCommandLogEntity): Promise<VoiceCommandLogEntity>;
  markExecuted(
    logId: bigint,
    result: { executionResult: Record<string, unknown>; errorMessage?: string | null }
  ): Promise<void>;
}
