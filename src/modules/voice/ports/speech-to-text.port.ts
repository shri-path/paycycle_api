export interface ISpeechToTextPort {
  readonly id: 'google' | 'bhashini' | 'stub';
  transcribe(args: {
    audioBase64: string;
    locale: string;
  }): Promise<{ transcription: string; confidence: number }>;
}
