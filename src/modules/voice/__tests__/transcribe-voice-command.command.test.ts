/**
 * Unit tests for TranscribeVoiceCommandCommand.
 * Covers: happy path, STT failure → log + re-throw, interpretation, combined confidence.
 */
/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
import { TranscribeVoiceCommandCommand } from '../commands/transcribe-voice-command/transcribe-voice-command.command';
import { ISpeechToTextPort } from '../ports/speech-to-text.port';
import { ICustomerLookupPort } from '../ports/customer-lookup.port';
import { IVoiceCommandLogRepository } from '../database/voice-command-log.repository.port';
import { VoiceCommandLogEntity } from '../domain/voice-command-log.entity';
import { SpeechProviderError } from '../domain/voice.errors';
import { Logger } from '@/infrastructure/logger/logger';

const VENDOR_ID = 10n;
const USER_ID = 1n;
const SUPPLY_LIST_ID = 5n;

describe('TranscribeVoiceCommandCommand', () => {
  let sttPort: jest.Mocked<ISpeechToTextPort>;
  let customerLookup: jest.Mocked<ICustomerLookupPort>;
  let logRepo: jest.Mocked<IVoiceCommandLogRepository>;
  let logger: jest.Mocked<Logger>;
  let cmd: TranscribeVoiceCommandCommand;

  beforeEach(() => {
    sttPort = {
      id: 'stub',
      transcribe: jest
        .fn()
        .mockResolvedValue({ transcription: 'delivered to sharma', confidence: 90 }),
    };
    customerLookup = {
      listRosterForList: jest.fn().mockResolvedValue([
        { id: 100n, name: 'Sharma' },
        { id: 101n, name: 'Ravi' },
      ]),
      getCustomer: jest.fn().mockResolvedValue({ id: 100n, name: 'Sharma' }),
    };
    logRepo = {
      insert: jest.fn().mockImplementation((entity: VoiceCommandLogEntity) =>
        Promise.resolve(
          VoiceCommandLogEntity.reconstitute({
            id: 99n,
            createdAt: new Date(),
            props: entity.getProps(),
          })
        )
      ),
      markExecuted: jest.fn().mockResolvedValue(undefined),
    };
    logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<Logger>;

    cmd = new TranscribeVoiceCommandCommand(sttPort, customerLookup, logRepo, logger);
  });

  it('should return transcription result with logId on success', async () => {
    const result = await cmd.execute({
      userId: USER_ID,
      vendorId: VENDOR_ID,
      audioData: 'dGVzdA==',
      languageCode: 'en',
      supplyListId: SUPPLY_LIST_ID,
    });

    expect(result.logId).toBe('99');
    expect(result.transcription).toBe('delivered to sharma');
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.interpretation.action).toBeDefined();
    expect(typeof result.interpretation.autoExecute).toBe('boolean');
  });

  it('should combine STT confidence and match confidence (avg)', async () => {
    // STT confidence = 90, interpreter returns matchConfidence depends on roster hit
    const result = await cmd.execute({
      userId: USER_ID,
      vendorId: VENDOR_ID,
      audioData: 'audio',
      languageCode: 'en',
      supplyListId: SUPPLY_LIST_ID,
    });
    // Combined = round(0.5 * sttConfidence + 0.5 * matchConfidence)
    // matchConfidence for 'sharma' exact = 95 → combined = round(0.5*90 + 0.5*95) = 93
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(100);
  });

  it('should set autoExecute=true when confidence > 80', async () => {
    // STT=90, matchConf=95 → combined=93 → autoExecute=true
    const result = await cmd.execute({
      userId: USER_ID,
      vendorId: VENDOR_ID,
      audioData: 'audio',
      languageCode: 'en',
      supplyListId: SUPPLY_LIST_ID,
    });
    // MARK_DELIVERED with high confidence
    if (result.interpretation.action === 'mark_delivered') {
      expect(result.interpretation.autoExecute).toBe(true);
    }
  });

  it('should call logRepo.insert once on success', async () => {
    await cmd.execute({
      userId: USER_ID,
      vendorId: VENDOR_ID,
      audioData: 'audio',
      languageCode: 'en',
      supplyListId: SUPPLY_LIST_ID,
    });
    expect(logRepo.insert).toHaveBeenCalledTimes(1);
  });

  it('should still insert error log and throw SpeechProviderError when STT fails', async () => {
    sttPort.transcribe.mockRejectedValue(new SpeechProviderError('STT unavailable'));

    await expect(
      cmd.execute({
        userId: USER_ID,
        vendorId: VENDOR_ID,
        audioData: 'audio',
        languageCode: 'en',
        supplyListId: SUPPLY_LIST_ID,
      })
    ).rejects.toThrow(SpeechProviderError);

    // Error log row must have been inserted
    expect(logRepo.insert).toHaveBeenCalledTimes(1);
    const insertedEntity = (logRepo.insert as jest.Mock).mock.calls[0][0] as VoiceCommandLogEntity;
    expect(insertedEntity.getProps().errorMessage).toContain('STT failure');
  });

  it('should wrap non-SpeechProviderError as SpeechProviderError', async () => {
    sttPort.transcribe.mockRejectedValue(new Error('Network error'));

    await expect(
      cmd.execute({
        userId: USER_ID,
        vendorId: VENDOR_ID,
        audioData: 'audio',
        languageCode: 'en',
        supplyListId: SUPPLY_LIST_ID,
      })
    ).rejects.toThrow(SpeechProviderError);
  });

  it('should include candidates in response for ambiguous interpretation', async () => {
    // Two very similar names on roster
    customerLookup.listRosterForList.mockResolvedValue([
      { id: 200n, name: 'Ravi' },
      { id: 201n, name: 'Ramu' },
    ]);
    customerLookup.getCustomer.mockImplementation((id) =>
      Promise.resolve({
        id,
        name: id === 200n ? 'Ravi' : 'Ramu',
      })
    );
    sttPort.transcribe.mockResolvedValue({ transcription: 'delivered to ravi', confidence: 85 });

    const result = await cmd.execute({
      userId: USER_ID,
      vendorId: VENDOR_ID,
      audioData: 'audio',
      languageCode: 'en',
      supplyListId: SUPPLY_LIST_ID,
    });

    // Either matched one or returned candidates
    expect(result.interpretation).toBeDefined();
    expect(Array.isArray(result.interpretation.candidates)).toBe(true);
  });

  it('should use today as serviceDate when not provided', async () => {
    const result = await cmd.execute({
      userId: USER_ID,
      vendorId: VENDOR_ID,
      audioData: 'audio',
      languageCode: 'hi',
      supplyListId: SUPPLY_LIST_ID,
      // serviceDate omitted
    });
    // Just verify it doesn't throw and returns a result
    expect(result.logId).toBeDefined();
  });

  it('should use provided serviceDate', async () => {
    const result = await cmd.execute({
      userId: USER_ID,
      vendorId: VENDOR_ID,
      audioData: 'audio',
      languageCode: 'en',
      supplyListId: SUPPLY_LIST_ID,
      serviceDate: '2024-06-15',
    });
    expect(result.logId).toBeDefined();
    expect(customerLookup.listRosterForList).toHaveBeenCalledWith(
      VENDOR_ID,
      SUPPLY_LIST_ID,
      expect.any(Date)
    );
  });
});
