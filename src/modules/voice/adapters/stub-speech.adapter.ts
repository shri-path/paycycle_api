/**
 * StubSpeechAdapter — deterministic stub for testing and development.
 * Returns a canned transcription based on the audio base64 hash (first chars).
 * No cloud dependency.
 */
import { ISpeechToTextPort } from '../ports/speech-to-text.port';

export class StubSpeechAdapter implements ISpeechToTextPort {
  readonly id = 'stub' as const;

  // eslint-disable-next-line @typescript-eslint/require-await
  async transcribe(args: {
    audioBase64: string;
    locale: string;
  }): Promise<{ transcription: string; confidence: number }> {
    // Deterministic: produce a fixed transcription for testing.
    // In real use, this will be replaced by a real provider.
    const firstChars = args.audioBase64.slice(0, 8);

    const localeMap: Record<string, string> = {
      'hi-IN': 'शर्मा जी को दूध दे दिया',
      'en-IN': 'delivered to sharma',
      'ta-IN': 'கொடுத்தேன்',
      'te-IN': 'delivered',
      'mr-IN': 'दिले',
      'bn-IN': 'delivered',
      'kn-IN': 'delivered',
      'ml-IN': 'delivered',
      'gu-IN': 'delivered',
    };

    const transcription = localeMap[args.locale] ?? `stub transcription for ${firstChars}`;
    return { transcription, confidence: 90 };
  }
}
