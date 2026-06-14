/**
 * GoogleSpeechAdapter — shell adapter. Not yet implemented (requires credentials).
 * Swap in by setting SPEECH_PROVIDER=google in the environment.
 */
import { ISpeechToTextPort } from '../ports/speech-to-text.port';
import { SpeechProviderError } from '../domain/voice.errors';

export class GoogleSpeechAdapter implements ISpeechToTextPort {
  readonly id = 'google' as const;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_apiKey: string) {}

  // eslint-disable-next-line @typescript-eslint/require-await
  async transcribe(_args: {
    audioBase64: string;
    locale: string;
  }): Promise<{ transcription: string; confidence: number }> {
    // TODO: wire Google Cloud Speech-to-Text API when credentials are available.
    throw new SpeechProviderError(
      'Google Speech adapter is not yet configured. Set SPEECH_PROVIDER=stub for development.'
    );
  }
}
