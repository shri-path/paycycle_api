/**
 * Unit tests for VoiceIntentVO value object.
 */
import { VoiceIntentVO } from '../domain/value-objects/voice-intent.vo';
import { VoiceIntentAction } from '../domain/voice.types';
import { ArgumentInvalidException } from '@/common/errors/app-error';

describe('VoiceIntentVO', () => {
  describe('create()', () => {
    it('should create MARK_DELIVERED with customerName', () => {
      const vo = VoiceIntentVO.create({
        action: VoiceIntentAction.MARK_DELIVERED,
        customerName: 'Sharma',
      });
      expect(vo.action).toBe(VoiceIntentAction.MARK_DELIVERED);
      expect(vo.customerName).toBe('Sharma');
    });

    it('should create MARK_LEAVE with customerName', () => {
      const vo = VoiceIntentVO.create({
        action: VoiceIntentAction.MARK_LEAVE,
        customerName: 'Ravi',
      });
      expect(vo.action).toBe(VoiceIntentAction.MARK_LEAVE);
    });

    it('should create MARK_ALL without customerName', () => {
      const vo = VoiceIntentVO.create({ action: VoiceIntentAction.MARK_ALL });
      expect(vo.action).toBe(VoiceIntentAction.MARK_ALL);
      expect(vo.customerName).toBeUndefined();
    });

    it('should create ADJUST_QUANTITY with quantity > 0', () => {
      const vo = VoiceIntentVO.create({
        action: VoiceIntentAction.ADJUST_QUANTITY,
        quantity: 2.5,
        customerName: 'Gupta',
      });
      expect(vo.quantity).toBe(2.5);
    });

    it('should throw ArgumentInvalidException for MARK_DELIVERED without customerName', () => {
      expect(() => VoiceIntentVO.create({ action: VoiceIntentAction.MARK_DELIVERED })).toThrow(
        ArgumentInvalidException
      );
    });

    it('should throw ArgumentInvalidException for MARK_LEAVE without customerName', () => {
      expect(() => VoiceIntentVO.create({ action: VoiceIntentAction.MARK_LEAVE })).toThrow(
        ArgumentInvalidException
      );
    });

    it('should throw ArgumentInvalidException for ADJUST_QUANTITY with quantity <= 0', () => {
      expect(() =>
        VoiceIntentVO.create({ action: VoiceIntentAction.ADJUST_QUANTITY, quantity: 0 })
      ).toThrow(ArgumentInvalidException);
    });

    it('should throw ArgumentInvalidException for ADJUST_QUANTITY with undefined quantity', () => {
      expect(() => VoiceIntentVO.create({ action: VoiceIntentAction.ADJUST_QUANTITY })).toThrow(
        ArgumentInvalidException
      );
    });

    it('should throw ArgumentInvalidException for invalid action string', () => {
      expect(() => VoiceIntentVO.create({ action: 'INVALID' as VoiceIntentAction })).toThrow(
        ArgumentInvalidException
      );
    });
  });

  describe('unknown()', () => {
    it('should create an UNKNOWN intent without throwing', () => {
      const vo = VoiceIntentVO.unknown();
      expect(vo.action).toBe(VoiceIntentAction.UNKNOWN);
      expect(vo.customerName).toBeUndefined();
    });
  });
});
