/**
 * voice.errors.ts — Domain exceptions for the voice module.
 * All extend AppError so the centralized error handler maps them correctly.
 */
import { AppError, ValidationError } from '@/common/errors/app-error';

export class InvalidTemplatePlaceholderError extends ValidationError {
  constructor(token: string) {
    super(`Invalid placeholder: {{${token}}}`, [{ field: 'content', token }]);
    this.name = 'InvalidTemplatePlaceholderError';
  }
}

export class SpeechProviderError extends AppError {
  constructor(message = 'Speech provider failed', details?: unknown) {
    super(message, 502, 'SPEECH_PROVIDER_ERROR', true, details);
    this.name = 'SpeechProviderError';
  }
}

export class UnprocessableVoiceCommandError extends AppError {
  constructor(message = 'Voice command could not be interpreted or executed', details?: unknown) {
    super(message, 422, 'UNPROCESSABLE', true, details);
    this.name = 'UnprocessableVoiceCommandError';
  }
}
