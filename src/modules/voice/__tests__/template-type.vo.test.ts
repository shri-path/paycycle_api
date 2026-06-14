/**
 * Unit tests for TemplateTypeVO value object.
 */
import { TemplateTypeVO } from '../domain/value-objects/template-type.vo';
import { ArgumentInvalidException } from '@/common/errors/app-error';

describe('TemplateTypeVO', () => {
  describe('create()', () => {
    it('should accept PAYMENT_REMINDER (uppercase)', () => {
      const vo = TemplateTypeVO.create('PAYMENT_REMINDER');
      expect(vo.value).toBe('PAYMENT_REMINDER');
    });

    it('should accept payment_reminder (lowercase → normalized)', () => {
      const vo = TemplateTypeVO.create('payment_reminder');
      expect(vo.value).toBe('PAYMENT_REMINDER');
    });

    it('should accept all four valid types', () => {
      const types = [
        'PAYMENT_REMINDER',
        'MONTHLY_BILL',
        'DELIVERY_CONFIRMATION',
        'LEAVE_CONFIRMATION',
      ];
      for (const t of types) {
        expect(() => TemplateTypeVO.create(t)).not.toThrow();
      }
    });

    it('should throw ArgumentInvalidException for unknown type', () => {
      expect(() => TemplateTypeVO.create('INVOICE')).toThrow(ArgumentInvalidException);
    });

    it('should throw ArgumentInvalidException for empty string', () => {
      expect(() => TemplateTypeVO.create('')).toThrow(ArgumentInvalidException);
    });
  });

  describe('allowedPlaceholders()', () => {
    it('PAYMENT_REMINDER should include customer_name, amount, due_date', () => {
      const allowed = TemplateTypeVO.create('PAYMENT_REMINDER').allowedPlaceholders();
      expect(allowed).toContain('customer_name');
      expect(allowed).toContain('amount');
      expect(allowed).toContain('due_date');
    });

    it('MONTHLY_BILL should include total_due and items', () => {
      const allowed = TemplateTypeVO.create('MONTHLY_BILL').allowedPlaceholders();
      expect(allowed).toContain('total_due');
      expect(allowed).toContain('items');
    });

    it('DELIVERY_CONFIRMATION should include item, quantity, date', () => {
      const allowed = TemplateTypeVO.create('DELIVERY_CONFIRMATION').allowedPlaceholders();
      expect(allowed).toContain('item');
      expect(allowed).toContain('quantity');
      expect(allowed).toContain('date');
    });

    it('LEAVE_CONFIRMATION should include from_date and to_date but NOT quantity', () => {
      const allowed = TemplateTypeVO.create('LEAVE_CONFIRMATION').allowedPlaceholders();
      expect(allowed).toContain('from_date');
      expect(allowed).toContain('to_date');
      expect(allowed).not.toContain('quantity');
    });

    it('PAYMENT_REMINDER should NOT include items (belongs to MONTHLY_BILL only)', () => {
      const allowed = TemplateTypeVO.create('PAYMENT_REMINDER').allowedPlaceholders();
      expect(allowed).not.toContain('items');
    });
  });

  describe('equals()', () => {
    it('should be equal for same type', () => {
      expect(
        TemplateTypeVO.create('MONTHLY_BILL').equals(TemplateTypeVO.create('MONTHLY_BILL'))
      ).toBe(true);
    });

    it('should not be equal for different types', () => {
      expect(
        TemplateTypeVO.create('MONTHLY_BILL').equals(TemplateTypeVO.create('PAYMENT_REMINDER'))
      ).toBe(false);
    });
  });
});
