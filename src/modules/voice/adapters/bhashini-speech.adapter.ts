/**
 * BhashiniSpeechAdapter — shell adapter for Bhashini STT API.
 * Not yet implemented (requires credentials from bhashini.gov.in).
 * Swap in by setting SPEECH_PROVIDER=bhashini.
 */
import { ISpeechToTextPort } from '../ports/speech-to-text.port';
import { SpeechProviderError } from '../domain/voice.errors';

export class BhashiniSpeechAdapter implements ISpeechToTextPort {
  readonly id = 'bhashini' as const;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_apiKey: string, _userId: string) {}

  // eslint-disable-next-line @typescript-eslint/require-await
  async transcribe(_args: {
    audioBase64: string;
    locale: string;
  }): Promise<{ transcription: string; confidence: number }> {
    // TODO: wire Bhashini ULCA API when credentials are available.
    throw new SpeechProviderError(
      'Bhashini Speech adapter is not yet configured. Set SPEECH_PROVIDER=stub for development.'
    );
  }
}
