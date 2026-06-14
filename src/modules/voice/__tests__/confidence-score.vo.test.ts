/**
 * Unit tests for ConfidenceScoreVO value object.
 */
import { ConfidenceScoreVO } from '../domain/value-objects/confidence-score.vo';
import { ArgumentInvalidException } from '@/common/errors/app-error';

describe('ConfidenceScoreVO', () => {
  describe('create()', () => {
    it('should accept 0 (boundary)', () => {
      const vo = ConfidenceScoreVO.create(0);
      expect(vo.value).toBe(0);
    });

    it('should accept 100 (boundary)', () => {
      const vo = ConfidenceScoreVO.create(100);
      expect(vo.value).toBe(100);
    });

    it('should accept 85.5 (mid-range)', () => {
      const vo = ConfidenceScoreVO.create(85.5);
      expect(vo.value).toBe(85.5);
    });

    it('should round to 2 decimal places', () => {
      const vo = ConfidenceScoreVO.create(85.567);
      expect(vo.value).toBe(85.57);
    });

    it('should throw ArgumentInvalidException for value below 0', () => {
      expect(() => ConfidenceScoreVO.create(-1)).toThrow(ArgumentInvalidException);
    });

    it('should throw ArgumentInvalidException for value above 100', () => {
      expect(() => ConfidenceScoreVO.create(101)).toThrow(ArgumentInvalidException);
    });

    it('should throw ArgumentInvalidException for NaN', () => {
      expect(() => ConfidenceScoreVO.create(NaN)).toThrow(ArgumentInvalidException);
    });
  });

  describe('isAutoExecutable()', () => {
    it('should return false for score exactly at threshold (80)', () => {
      expect(ConfidenceScoreVO.create(80).isAutoExecutable()).toBe(false);
    });

    it('should return true for score above threshold (80.01)', () => {
      expect(ConfidenceScoreVO.create(80.01).isAutoExecutable()).toBe(true);
    });

    it('should return true for score 95', () => {
      expect(ConfidenceScoreVO.create(95).isAutoExecutable()).toBe(true);
    });

    it('should return false for score below threshold (79)', () => {
      expect(ConfidenceScoreVO.create(79).isAutoExecutable()).toBe(false);
    });

    it('should use a custom threshold when provided', () => {
      const vo = ConfidenceScoreVO.create(70);
      expect(vo.isAutoExecutable(65)).toBe(true);
      expect(vo.isAutoExecutable(75)).toBe(false);
    });
  });

  describe('equals()', () => {
    it('should be equal for same value', () => {
      expect(ConfidenceScoreVO.create(85).equals(ConfidenceScoreVO.create(85))).toBe(true);
    });

    it('should not be equal for different values', () => {
      expect(ConfidenceScoreVO.create(85).equals(ConfidenceScoreVO.create(90))).toBe(false);
    });
  });
});
