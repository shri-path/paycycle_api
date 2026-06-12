/**
 * Unit tests for TimeOfDay value object.
 */
import { TimeOfDay } from '../domain/value-objects/time-of-day.vo';
import { ArgumentInvalidException } from '@/common/errors/app-error';

describe('TimeOfDay VO', () => {
  describe('create()', () => {
    it('should accept valid boundary values "00:00" and "23:59"', () => {
      expect(() => TimeOfDay.create('00:00')).not.toThrow();
      expect(() => TimeOfDay.create('23:59')).not.toThrow();
    });

    it('should accept common values like "20:00"', () => {
      const vo = TimeOfDay.create('20:00');
      expect(vo.hours).toBe(20);
      expect(vo.minutes).toBe(0);
    });

    it('should reject "24:00" — hours out of range', () => {
      expect(() => TimeOfDay.create('24:00')).toThrow(ArgumentInvalidException);
    });

    it('should reject "9:5" — missing padding', () => {
      expect(() => TimeOfDay.create('9:5')).toThrow(ArgumentInvalidException);
    });

    it('should reject empty string', () => {
      expect(() => TimeOfDay.create('')).toThrow(ArgumentInvalidException);
    });

    it('should reject "20:60" — minutes out of range', () => {
      expect(() => TimeOfDay.create('20:60')).toThrow(ArgumentInvalidException);
    });

    it('should reject non-string input', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
      expect(() => TimeOfDay.create(null as any)).toThrow(ArgumentInvalidException);
    });
  });

  describe('unpack()', () => {
    it('should serialize back to the same HH:mm string', () => {
      expect(TimeOfDay.create('06:30').unpack()).toBe('06:30');
      expect(TimeOfDay.create('20:00').unpack()).toBe('20:00');
      expect(TimeOfDay.create('00:00').unpack()).toBe('00:00');
    });
  });

  describe('equals()', () => {
    it('should return true for structurally equal values', () => {
      const a = TimeOfDay.create('10:30');
      const b = TimeOfDay.create('10:30');
      expect(a.equals(b)).toBe(true);
    });

    it('should return false for different values', () => {
      const a = TimeOfDay.create('10:30');
      const b = TimeOfDay.create('10:31');
      expect(a.equals(b)).toBe(false);
    });
  });
});
