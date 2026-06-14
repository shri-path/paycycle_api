/**
 * Unit tests for AgingBucketVO value object.
 */
import { AgingBucketVO, AgingBucketEnum } from '../domain/value-objects/aging-bucket.vo';

describe('AgingBucketVO', () => {
  describe('fromDaysOverdue()', () => {
    it('should classify 0 days as FRESH_0_30', () => {
      const vo = AgingBucketVO.fromDaysOverdue(0);
      expect(vo.unpack()).toBe(AgingBucketEnum.FRESH_0_30);
      expect(vo.daysOverdue).toBe(0);
    });

    it('should classify 30 days as FRESH_0_30 (boundary inclusive)', () => {
      const vo = AgingBucketVO.fromDaysOverdue(30);
      expect(vo.unpack()).toBe(AgingBucketEnum.FRESH_0_30);
    });

    it('should classify 31 days as OVERDUE_30_60', () => {
      const vo = AgingBucketVO.fromDaysOverdue(31);
      expect(vo.unpack()).toBe(AgingBucketEnum.OVERDUE_30_60);
    });

    it('should classify 60 days as OVERDUE_30_60 (boundary inclusive)', () => {
      const vo = AgingBucketVO.fromDaysOverdue(60);
      expect(vo.unpack()).toBe(AgingBucketEnum.OVERDUE_30_60);
    });

    it('should classify 61 days as CRITICAL_60_PLUS', () => {
      const vo = AgingBucketVO.fromDaysOverdue(61);
      expect(vo.unpack()).toBe(AgingBucketEnum.CRITICAL_60_PLUS);
    });

    it('should classify 365 days as CRITICAL_60_PLUS', () => {
      const vo = AgingBucketVO.fromDaysOverdue(365);
      expect(vo.unpack()).toBe(AgingBucketEnum.CRITICAL_60_PLUS);
    });

    it('should clamp negative days to 0', () => {
      const vo = AgingBucketVO.fromDaysOverdue(-10);
      expect(vo.daysOverdue).toBe(0);
      expect(vo.unpack()).toBe(AgingBucketEnum.FRESH_0_30);
    });

    it('should floor fractional days', () => {
      // 30.9 → 30 → FRESH_0_30
      const vo = AgingBucketVO.fromDaysOverdue(30.9);
      expect(vo.daysOverdue).toBe(30);
      expect(vo.unpack()).toBe(AgingBucketEnum.FRESH_0_30);
    });
  });

  describe('equals()', () => {
    it('should be equal for same bucket and same days', () => {
      expect(AgingBucketVO.fromDaysOverdue(15).equals(AgingBucketVO.fromDaysOverdue(15))).toBe(
        true
      );
    });

    it('should not be equal when days differ even if bucket is same', () => {
      // Both are FRESH_0_30 but different day counts
      expect(AgingBucketVO.fromDaysOverdue(10).equals(AgingBucketVO.fromDaysOverdue(20))).toBe(
        false
      );
    });

    it('should not be equal when buckets differ', () => {
      expect(AgingBucketVO.fromDaysOverdue(15).equals(AgingBucketVO.fromDaysOverdue(45))).toBe(
        false
      );
    });
  });
});
