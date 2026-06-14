/**
 * Unit tests for VoiceCommandLogEntity — INSERT-only analytics record.
 */
import { VoiceCommandLogEntity } from '../domain/voice-command-log.entity';
import { ArgumentInvalidException } from '@/common/errors/app-error';

describe('VoiceCommandLogEntity', () => {
  describe('record()', () => {
    it('should create a log entity with minimal required fields', () => {
      const entity = VoiceCommandLogEntity.record({
        userId: 1n,
        vendorId: 2n,
        languageCode: 'HI',
      });
      const p = entity.getProps();
      expect(p.userId).toBe(1n);
      expect(p.vendorId).toBe(2n);
      expect(p.languageCode.value).toBe('HI');
      expect(p.wasExecuted).toBe(false);
      expect(p.errorMessage).toBeNull();
    });

    it('should have id 0n (not persisted yet)', () => {
      const entity = VoiceCommandLogEntity.record({
        userId: 1n,
        vendorId: 2n,
        languageCode: 'EN',
      });
      expect(entity.id).toBe(0n);
    });

    it('should set transcription and detectedAction', () => {
      const entity = VoiceCommandLogEntity.record({
        userId: 1n,
        vendorId: 2n,
        languageCode: 'HI',
        transcription: 'शर्मा जी को दूध दिया',
        detectedAction: 'MARK_DELIVERED',
      });
      const p = entity.getProps();
      expect(p.transcription).toBe('शर्मा जी को दूध दिया');
      expect(p.detectedAction).toBe('MARK_DELIVERED');
    });

    it('should set wasExecuted to true when provided', () => {
      const entity = VoiceCommandLogEntity.record({
        userId: 1n,
        vendorId: 2n,
        languageCode: 'EN',
        wasExecuted: true,
        executionResult: { action: 'mark_delivered', deliveryId: '123' },
      });
      const p = entity.getProps();
      expect(p.wasExecuted).toBe(true);
      expect(p.executionResult).toEqual({ action: 'mark_delivered', deliveryId: '123' });
    });

    it('should set confidenceScore as VO when provided', () => {
      const entity = VoiceCommandLogEntity.record({
        userId: 1n,
        vendorId: 2n,
        languageCode: 'EN',
        confidenceScore: 87.5,
      });
      const p = entity.getProps();
      expect(p.confidenceScore?.value).toBe(87.5);
    });

    it('should set errorMessage when provided', () => {
      const entity = VoiceCommandLogEntity.record({
        userId: 1n,
        vendorId: 2n,
        languageCode: 'EN',
        errorMessage: 'STT failure: timeout',
      });
      expect(entity.getProps().errorMessage).toBe('STT failure: timeout');
    });

    it('should throw ArgumentInvalidException for invalid languageCode', () => {
      expect(() =>
        VoiceCommandLogEntity.record({
          userId: 1n,
          vendorId: 2n,
          languageCode: 'INVALID',
        })
      ).toThrow(ArgumentInvalidException);
    });

    it('should null-out optional fields when not provided', () => {
      const entity = VoiceCommandLogEntity.record({
        userId: 1n,
        vendorId: 2n,
        languageCode: 'EN',
      });
      const p = entity.getProps();
      expect(p.supplyListId).toBeNull();
      expect(p.customerId).toBeNull();
      expect(p.transcription).toBeNull();
      expect(p.detectedAction).toBeNull();
      expect(p.confidenceScore).toBeNull();
      expect(p.executionResult).toBeNull();
    });
  });

  describe('reconstitute()', () => {
    it('should reconstitute from persistence data', () => {
      const entity = VoiceCommandLogEntity.reconstitute({
        id: 99n,
        createdAt: new Date('2024-03-01'),
        props: {
          userId: 5n,
          vendorId: 10n,
          languageCode: { value: 'HI' } as ReturnType<
            typeof import('../domain/value-objects/supported-language.vo').SupportedLanguageVO.create
          >,
          supplyListId: 1n,
          customerId: 7n,
          transcription: 'delivered',
          detectedAction: 'MARK_DELIVERED',
          confidenceScore: null,
          wasExecuted: true,
          executionResult: { markedCount: 1 },
          errorMessage: null,
        },
      });
      expect(entity.id).toBe(99n);
      expect(entity.getProps().wasExecuted).toBe(true);
    });
  });

  describe('getProps() — immutability', () => {
    it('getProps() should return frozen object', () => {
      const entity = VoiceCommandLogEntity.record({
        userId: 1n,
        vendorId: 2n,
        languageCode: 'EN',
      });
      expect(Object.isFrozen(entity.getProps())).toBe(true);
    });
  });
});
