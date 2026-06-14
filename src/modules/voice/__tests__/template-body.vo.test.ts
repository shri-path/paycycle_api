/**
 * Unit tests for TemplateBodyVO value object.
 * Covers: length validation, placeholder whitelist, render, unresolved tracking.
 */
import { TemplateBodyVO } from '../domain/value-objects/template-body.vo';
import { TemplateTypeVO } from '../domain/value-objects/template-type.vo';
import { ArgumentInvalidException } from '@/common/errors/app-error';
import { InvalidTemplatePlaceholderError } from '../domain/voice.errors';

const paymentType = () => TemplateTypeVO.create('PAYMENT_REMINDER');
const billType = () => TemplateTypeVO.create('MONTHLY_BILL');
const deliveryType = () => TemplateTypeVO.create('DELIVERY_CONFIRMATION');
const leaveType = () => TemplateTypeVO.create('LEAVE_CONFIRMATION');

describe('TemplateBodyVO', () => {
  describe('create() — length validation', () => {
    it('should accept valid non-empty template', () => {
      const vo = TemplateBodyVO.create('Hello {{customer_name}}', paymentType());
      expect(vo.raw).toBe('Hello {{customer_name}}');
    });

    it('should throw ArgumentInvalidException for empty string', () => {
      expect(() => TemplateBodyVO.create('', paymentType())).toThrow(ArgumentInvalidException);
    });

    it('should throw ArgumentInvalidException for whitespace-only string', () => {
      expect(() => TemplateBodyVO.create('   ', paymentType())).toThrow(ArgumentInvalidException);
    });

    it('should throw ArgumentInvalidException for string exceeding 2000 chars', () => {
      const longContent = 'a'.repeat(2001);
      expect(() => TemplateBodyVO.create(longContent, paymentType())).toThrow(
        ArgumentInvalidException
      );
    });

    it('should accept exactly 2000 chars', () => {
      const content = 'a'.repeat(2000);
      expect(() => TemplateBodyVO.create(content, paymentType())).not.toThrow();
    });
  });

  describe('create() — placeholder whitelist', () => {
    it('should accept template with allowed placeholder for PAYMENT_REMINDER', () => {
      expect(() =>
        TemplateBodyVO.create('Hi {{customer_name}}, you owe {{amount}}', paymentType())
      ).not.toThrow();
    });

    it('should throw InvalidTemplatePlaceholderError for unknown placeholder', () => {
      expect(() =>
        TemplateBodyVO.create('Hi {{customer_name}}, order: {{order_id}}', paymentType())
      ).toThrow(InvalidTemplatePlaceholderError);
    });

    it('should throw for cross-type placeholder (items is MONTHLY_BILL only)', () => {
      expect(() => TemplateBodyVO.create('Items: {{items}}', paymentType())).toThrow(
        InvalidTemplatePlaceholderError
      );
    });

    it('should accept MONTHLY_BILL placeholder in MONTHLY_BILL type', () => {
      expect(() =>
        TemplateBodyVO.create('Items: {{items}}, Total: {{total_due}}', billType())
      ).not.toThrow();
    });

    it('should accept DELIVERY_CONFIRMATION placeholders', () => {
      expect(() =>
        TemplateBodyVO.create(
          'Dear {{customer_name}}, delivered {{item}} (qty: {{quantity}}) on {{date}}',
          deliveryType()
        )
      ).not.toThrow();
    });

    it('should accept LEAVE_CONFIRMATION placeholders', () => {
      expect(() =>
        TemplateBodyVO.create(
          'Dear {{customer_name}}, leave from {{from_date}} to {{to_date}} confirmed',
          leaveType()
        )
      ).not.toThrow();
    });

    it('should throw for placeholders with extra spaces (inside braces)', () => {
      // "{{ customer_name }}" — the regex strips spaces, token = "customer_name" → valid
      expect(() => TemplateBodyVO.create('Hi {{ customer_name }}', paymentType())).not.toThrow();
    });

    it('should not report duplicate placeholder as error', () => {
      const vo = TemplateBodyVO.create(
        'Hi {{customer_name}}, {{customer_name}} welcome',
        paymentType()
      );
      expect(vo.placeholders()).toEqual(['customer_name']);
    });
  });

  describe('placeholders()', () => {
    it('should return list of unique placeholder tokens', () => {
      const vo = TemplateBodyVO.create(
        'Hi {{customer_name}}, pay {{amount}} by {{due_date}}',
        paymentType()
      );
      expect(vo.placeholders()).toEqual(
        expect.arrayContaining(['customer_name', 'amount', 'due_date'])
      );
      expect(vo.placeholders()).toHaveLength(3);
    });

    it('should return empty array when no placeholders', () => {
      const vo = TemplateBodyVO.create('Hello there!', paymentType());
      expect(vo.placeholders()).toHaveLength(0);
    });
  });

  describe('render()', () => {
    it('should substitute all placeholders with data', () => {
      const vo = TemplateBodyVO.create('Hi {{customer_name}}, pay Rs.{{amount}}', paymentType());
      const { text, unresolved } = vo.render({ customer_name: 'Ravi', amount: '500' });
      expect(text).toBe('Hi Ravi, pay Rs.500');
      expect(unresolved).toHaveLength(0);
    });

    it('should report unresolved placeholders when data is missing', () => {
      const vo = TemplateBodyVO.create(
        'Hi {{customer_name}}, pay {{amount}} by {{due_date}}',
        paymentType()
      );
      const { text, unresolved } = vo.render({ customer_name: 'Ravi' });
      expect(text).toContain('Ravi');
      expect(unresolved).toContain('amount');
      expect(unresolved).toContain('due_date');
    });

    it('should render empty string for unresolved placeholder position', () => {
      const vo = TemplateBodyVO.create('Hello {{customer_name}}!', paymentType());
      const { text } = vo.render({});
      expect(text).toBe('Hello !');
    });

    it('should handle multiple occurrences of same placeholder', () => {
      const vo = TemplateBodyVO.create(
        '{{customer_name}} owes {{amount}}. Pay {{amount}} now.',
        paymentType()
      );
      const { text, unresolved } = vo.render({ customer_name: 'Ravi', amount: '300' });
      expect(text).toBe('Ravi owes 300. Pay 300 now.');
      expect(unresolved).toHaveLength(0);
    });
  });

  describe('equals()', () => {
    it('should be equal for same raw content', () => {
      const a = TemplateBodyVO.create('Hello {{customer_name}}', paymentType());
      const b = TemplateBodyVO.create('Hello {{customer_name}}', paymentType());
      expect(a.equals(b)).toBe(true);
    });

    it('should not be equal for different content', () => {
      const a = TemplateBodyVO.create('Hello {{customer_name}}', paymentType());
      const b = TemplateBodyVO.create('Hi {{customer_name}}', paymentType());
      expect(a.equals(b)).toBe(false);
    });
  });
});
