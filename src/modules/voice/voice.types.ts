/**
 * voice.types.ts — shared response DTO types for the voice module (interface layer).
 * Re-exports from domain types + defines HTTP-layer shapes.
 */
export type { LanguagePreferenceResponseDto } from './language-preference.mapper';
export type { MessageTemplateResponseDto } from './message-template.mapper';

// ── Transcribe response ──────────────────────────────────────────────────────

export interface CandidateDto {
  id: string;
  name: string;
}

export interface InterpretationDto {
  action: string;
  customerId: string | null;
  customerName: string | null;
  quantity: number | null;
  confidence: number;
  autoExecute: boolean;
  candidates: CandidateDto[];
}

export interface TranscribeResponseDto {
  logId: string;
  transcription: string;
  confidence: number;
  interpretation: InterpretationDto;
}

// ── Execute response ─────────────────────────────────────────────────────────

export interface ExecuteResponseDto {
  executed: boolean;
  action: string;
  customerId?: string | null;
  customerName?: string | null;
  deliveryId?: string | null;
  status?: string;
  markedCount?: number;
}
