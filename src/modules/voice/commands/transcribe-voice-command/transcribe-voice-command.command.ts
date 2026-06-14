/**
 * TranscribeVoiceCommandCommand — Command.
 * Calls STT → interprets → writes VoiceCommandLog (wasExecuted=false).
 * Never mutates delivery state. STT failure still logs + re-throws.
 */
import { randomUUID } from 'crypto';
import { Logger } from '@/infrastructure/logger/logger';
import { ISpeechToTextPort } from '../../ports/speech-to-text.port';
import { ICustomerLookupPort } from '../../ports/customer-lookup.port';
import { IVoiceCommandLogRepository } from '../../database/voice-command-log.repository.port';
import { VoiceCommandInterpreter } from '../../domain/voice-command-interpreter';
import { VoiceCommandLogEntity } from '../../domain/voice-command-log.entity';
import { SupportedLanguageVO } from '../../domain/value-objects/supported-language.vo';
import { ConfidenceScoreVO } from '../../domain/value-objects/confidence-score.vo';
import { SpeechProviderError } from '../../domain/voice.errors';
import { TranscribeResponseDto, CandidateDto } from '../../voice.types';
import { appToday } from '@/modules/delivery/delivery.shared';
import { logErrorToFile } from '@/common/utils/log-error-to-file';

export interface TranscribeVoiceCommandInput {
  userId: bigint;
  vendorId: bigint;
  audioData: string;
  languageCode: string;
  supplyListId: bigint;
  serviceDate?: string | undefined;
}

export class TranscribeVoiceCommandCommand {
  private readonly interpreter = new VoiceCommandInterpreter();

  constructor(
    private readonly sttPort: ISpeechToTextPort,
    private readonly customerLookup: ICustomerLookupPort,
    private readonly logRepo: IVoiceCommandLogRepository,
    private readonly logger: Logger
  ) {}

  async execute(input: TranscribeVoiceCommandInput): Promise<TranscribeResponseDto> {
    const correlationId = randomUUID();
    this.logger.info(
      {
        correlationId,
        userId: input.userId.toString(),
        vendorId: input.vendorId.toString(),
        languageCode: input.languageCode,
      },
      'TranscribeVoiceCommand: start'
    );

    const langVO = SupportedLanguageVO.create(input.languageCode.toUpperCase());
    const locale = langVO.toLocale();
    const serviceDate = input.serviceDate
      ? new Date(input.serviceDate + 'T00:00:00.000Z')
      : appToday();

    // 1. Call STT — on failure log error row and re-throw
    let transcription: string;
    let sttConfidence: number;

    try {
      const result = await this.sttPort.transcribe({
        audioBase64: input.audioData,
        locale,
      });
      transcription = result.transcription;
      sttConfidence = result.confidence;
    } catch (err) {
      // Log failure row
      const errMsg = err instanceof Error ? err.message : String(err);
      const errorLog = VoiceCommandLogEntity.record({
        userId: input.userId,
        vendorId: input.vendorId,
        languageCode: langVO.value,
        supplyListId: input.supplyListId,
        wasExecuted: false,
        errorMessage: `STT failure: ${errMsg}`,
      });
      const savedErrorLog = await this.logRepo.insert(errorLog);

      this.logger.error(
        { correlationId, err, logId: savedErrorLog.id.toString() },
        'TranscribeVoiceCommand: STT failed'
      );

      logErrorToFile(err instanceof Error ? err : new Error(String(err)), {
        correlationId,
        userId: input.userId.toString(),
        vendorId: input.vendorId.toString(),
      });

      if (err instanceof SpeechProviderError) throw err;
      throw new SpeechProviderError('Speech provider returned an error', { cause: errMsg });
    }

    // 2. Fetch customer roster
    const roster = await this.customerLookup.listRosterForList(
      input.vendorId,
      input.supplyListId,
      serviceDate
    );

    // 3. Interpret
    const interpretation = this.interpreter.interpret(transcription, langVO, roster);

    // 4. Combine confidence
    const combined = Math.round(0.5 * sttConfidence + 0.5 * interpretation.matchConfidence);
    const confidenceVO = ConfidenceScoreVO.create(Math.min(100, Math.max(0, combined)));

    // 5. Resolve customerId to name for response
    let customerName: string | null = null;
    if (interpretation.customerId) {
      const customer = await this.customerLookup.getCustomer(
        interpretation.customerId,
        input.vendorId
      );
      customerName = customer?.name ?? null;
    }

    // 6. Insert log row (wasExecuted = false)
    const logEntity = VoiceCommandLogEntity.record({
      userId: input.userId,
      vendorId: input.vendorId,
      languageCode: langVO.value,
      supplyListId: input.supplyListId,
      customerId: interpretation.customerId ?? null,
      transcription,
      detectedAction: interpretation.intent.action,
      confidenceScore: confidenceVO.value,
      wasExecuted: false,
    });
    const savedLog = await this.logRepo.insert(logEntity);

    // 7. Build candidates list
    const candidateDtos: CandidateDto[] = [];
    if (interpretation.candidates && interpretation.candidates.length > 0) {
      for (const cid of interpretation.candidates) {
        const c = await this.customerLookup.getCustomer(cid, input.vendorId);
        if (c) candidateDtos.push({ id: c.id.toString(), name: c.name });
      }
    }

    this.logger.info(
      {
        correlationId,
        logId: savedLog.id.toString(),
        action: interpretation.intent.action,
        confidence: confidenceVO.value,
      },
      'TranscribeVoiceCommand: done'
    );

    return {
      logId: savedLog.id.toString(),
      transcription,
      confidence: confidenceVO.value,
      interpretation: {
        action: interpretation.intent.action.toLowerCase(),
        customerId: interpretation.customerId?.toString() ?? null,
        customerName,
        quantity: interpretation.intent.quantity ?? null,
        confidence: confidenceVO.value,
        autoExecute: confidenceVO.isAutoExecutable(),
        candidates: candidateDtos,
      },
    };
  }
}
