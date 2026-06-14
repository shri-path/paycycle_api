/**
 * VoiceCommandLogEntity — INSERT-only analytics record.
 * No mutations after creation (except markExecuted in the repository).
 * Pure domain, no framework imports.
 */
import { SupportedLanguageVO } from './value-objects/supported-language.vo';
import { ConfidenceScoreVO } from './value-objects/confidence-score.vo';

export interface VoiceCommandLogProps {
  userId: bigint;
  vendorId: bigint;
  languageCode: SupportedLanguageVO;
  supplyListId: bigint | null;
  customerId: bigint | null;
  transcription: string | null;
  detectedAction: string | null;
  confidenceScore: ConfidenceScoreVO | null;
  wasExecuted: boolean;
  executionResult: Record<string, unknown> | null;
  errorMessage: string | null;
}

export class VoiceCommandLogEntity {
  private readonly _id: bigint;
  private readonly _createdAt: Date;
  private readonly _props: VoiceCommandLogProps;

  private constructor(id: bigint, createdAt: Date, props: VoiceCommandLogProps) {
    this._id = id;
    this._createdAt = createdAt;
    this._props = props;
  }

  get id(): bigint {
    return this._id;
  }
  get createdAt(): Date {
    return this._createdAt;
  }

  getProps(): Readonly<VoiceCommandLogProps & { id: bigint; createdAt: Date }> {
    return Object.freeze({
      id: this._id,
      createdAt: this._createdAt,
      ...this._props,
    });
  }

  // ── Factory: record a new log entry ──────────────────────────────────────────

  static record(input: {
    userId: bigint;
    vendorId: bigint;
    languageCode: string;
    supplyListId?: bigint | null;
    customerId?: bigint | null;
    transcription?: string | null;
    detectedAction?: string | null;
    confidenceScore?: number | null;
    wasExecuted?: boolean;
    executionResult?: Record<string, unknown> | null;
    errorMessage?: string | null;
  }): VoiceCommandLogEntity {
    const confidence =
      input.confidenceScore != null ? ConfidenceScoreVO.create(input.confidenceScore) : null;

    return new VoiceCommandLogEntity(0n, new Date(), {
      userId: input.userId,
      vendorId: input.vendorId,
      languageCode: SupportedLanguageVO.create(input.languageCode),
      supplyListId: input.supplyListId ?? null,
      customerId: input.customerId ?? null,
      transcription: input.transcription ?? null,
      detectedAction: input.detectedAction ?? null,
      confidenceScore: confidence,
      wasExecuted: input.wasExecuted ?? false,
      executionResult: input.executionResult ?? null,
      errorMessage: input.errorMessage ?? null,
    });
  }

  static reconstitute(data: {
    id: bigint;
    createdAt: Date;
    props: VoiceCommandLogProps;
  }): VoiceCommandLogEntity {
    return new VoiceCommandLogEntity(data.id, data.createdAt, data.props);
  }
}
