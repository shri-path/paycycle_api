/**
 * Unit tests for CollectionPriorityVO value object.
 */
import {
  CollectionPriorityVO,
  CollectionPriorityEnum,
} from '../domain/value-objects/collection-priority.vo';

describe('CollectionPriorityVO', () => {
  describe('evaluate()', () => {
    // ── HIGH ──────────────────────────────────────────────────────────────

    it('should evaluate to HIGH when daysOverdue > 60', () => {
      const vo = CollectionPriorityVO.evaluate(61, 0);
      expect(vo.unpack()).toBe(CollectionPriorityEnum.HIGH);
    });

    it('should evaluate to HIGH when utilization >= 95', () => {
      const vo = CollectionPriorityVO.evaluate(0, 95);
      expect(vo.unpack()).toBe(CollectionPriorityEnum.HIGH);
    });

    it('should evaluate to HIGH when both conditions are true', () => {
      const vo = CollectionPriorityVO.evaluate(90, 100);
      expect(vo.unpack()).toBe(CollectionPriorityEnum.HIGH);
    });

    // ── MEDIUM ────────────────────────────────────────────────────────────

    it('should evaluate to MEDIUM when daysOverdue > 30 (and not HIGH)', () => {
      const vo = CollectionPriorityVO.evaluate(31, 0);
      expect(vo.unpack()).toBe(CollectionPriorityEnum.MEDIUM);
    });

    it('should evaluate to MEDIUM when utilization >= 80 (and not HIGH)', () => {
      const vo = CollectionPriorityVO.evaluate(0, 80);
      expect(vo.unpack()).toBe(CollectionPriorityEnum.MEDIUM);
    });

    // ── LOW ───────────────────────────────────────────────────────────────

    it('should evaluate to LOW when daysOverdue <= 30 and utilization < 80', () => {
      const vo = CollectionPriorityVO.evaluate(10, 50);
      expect(vo.unpack()).toBe(CollectionPriorityEnum.LOW);
    });

    it('should evaluate to LOW at exactly 0 days and 0 utilization', () => {
      const vo = CollectionPriorityVO.evaluate(0, 0);
      expect(vo.unpack()).toBe(CollectionPriorityEnum.LOW);
    });

    it('should evaluate to LOW at exactly 30 days overdue', () => {
      // 30 is NOT > 30, so not MEDIUM
      const vo = CollectionPriorityVO.evaluate(30, 79);
      expect(vo.unpack()).toBe(CollectionPriorityEnum.LOW);
    });

    // ── Boundary: HIGH vs MEDIUM ──────────────────────────────────────────

    it('should evaluate to HIGH at exactly daysOverdue=61 over threshold=60', () => {
      const vo = CollectionPriorityVO.evaluate(61, 0);
      expect(vo.unpack()).toBe(CollectionPriorityEnum.HIGH);
    });

    it('should evaluate to MEDIUM at exactly daysOverdue=60', () => {
      const vo = CollectionPriorityVO.evaluate(60, 0);
      expect(vo.unpack()).toBe(CollectionPriorityEnum.MEDIUM);
    });
  });

  describe('equals()', () => {
    it('should be equal for same priority', () => {
      expect(
        CollectionPriorityVO.evaluate(10, 50).equals(CollectionPriorityVO.evaluate(5, 60))
      ).toBe(true); // both LOW
    });

    it('should not be equal for different priorities', () => {
      expect(CollectionPriorityVO.evaluate(0, 0).equals(CollectionPriorityVO.evaluate(70, 0))).toBe(
        false
      ); // LOW vs HIGH
    });
  });
});
