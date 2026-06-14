/**
 * Unit tests for MessageTemplateEntity — factory, invariants, updateBody, render.
 */
import { MessageTemplateEntity } from '../domain/message-template.entity';
import { SupportedLanguageVO } from '../domain/value-objects/supported-language.vo';
import { TemplateTypeVO } from '../domain/value-objects/template-type.vo';
import { TemplateBodyVO } from '../domain/value-objects/template-body.vo';
import { ArgumentInvalidException } from '@/common/errors/app-error';
import { InvalidTemplatePlaceholderError } from '../domain/voice.errors';

const VENDOR_ID = 10n;

describe('MessageTemplateEntity', () => {
  describe('create()', () => {
    it('should create entity with valid inputs', () => {
      const entity = MessageTemplateEntity.create({
        vendorId: VENDOR_ID,
        templateType: 'PAYMENT_REMINDER',
        languageCode: 'HI',
        content: 'नमस्ते {{customer_name}}, {{amount}} रुपए बाकी हैं',
      });
      const p = entity.getProps();
      expect(p.vendorId).toBe(VENDOR_ID);
      expect(p.templateType.value).toBe('PAYMENT_REMINDER');
      expect(p.languageCode.value).toBe('HI');
      expect(p.isActive).toBe(true);
    });

    it('should set id to 0n (not persisted)', () => {
      const entity = MessageTemplateEntity.create({
        vendorId: VENDOR_ID,
        templateType: 'MONTHLY_BILL',
        languageCode: 'EN',
        content: 'Bill for {{customer_name}}: {{total_due}}',
      });
      expect(entity.id).toBe(0n);
    });

    it('should throw ArgumentInvalidException for invalid templateType', () => {
      expect(() =>
        MessageTemplateEntity.create({
          vendorId: VENDOR_ID,
          templateType: 'INVALID_TYPE',
          languageCode: 'EN',
          content: 'Hello',
        })
      ).toThrow(ArgumentInvalidException);
    });

    it('should throw ArgumentInvalidException for invalid languageCode', () => {
      expect(() =>
        MessageTemplateEntity.create({
          vendorId: VENDOR_ID,
          templateType: 'PAYMENT_REMINDER',
          languageCode: 'XX',
          content: 'Hello {{customer_name}}',
        })
      ).toThrow(ArgumentInvalidException);
    });

    it('should throw InvalidTemplatePlaceholderError for unknown placeholder', () => {
      expect(() =>
        MessageTemplateEntity.create({
          vendorId: VENDOR_ID,
          templateType: 'PAYMENT_REMINDER',
          languageCode: 'EN',
          content: 'Hello {{customer_name}}, ref: {{invoice_id}}',
        })
      ).toThrow(InvalidTemplatePlaceholderError);
    });
  });

  describe('reconstitute()', () => {
    it('should reconstitute entity from persistence data', () => {
      const type = TemplateTypeVO.create('DELIVERY_CONFIRMATION');
      const entity = MessageTemplateEntity.reconstitute({
        id: 5n,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
        deletedAt: null,
        props: {
          vendorId: VENDOR_ID,
          templateType: type,
          languageCode: SupportedLanguageVO.create('EN'),
          body: TemplateBodyVO.create(
            'Dear {{customer_name}}, delivered {{item}} on {{date}}',
            type
          ),
          isActive: true,
        },
      });
      expect(entity.id).toBe(5n);
      expect(entity.deletedAt).toBeNull();
    });
  });

  describe('updateBody()', () => {
    it('should replace the template body with valid new content', () => {
      const entity = MessageTemplateEntity.create({
        vendorId: VENDOR_ID,
        templateType: 'PAYMENT_REMINDER',
        languageCode: 'EN',
        content: 'Old content {{customer_name}}',
      });
      entity.updateBody('New content {{customer_name}} pay {{amount}}');
      expect(entity.getProps().body.raw).toBe('New content {{customer_name}} pay {{amount}}');
    });

    it('should throw InvalidTemplatePlaceholderError when new content has unknown placeholder', () => {
      const entity = MessageTemplateEntity.create({
        vendorId: VENDOR_ID,
        templateType: 'PAYMENT_REMINDER',
        languageCode: 'EN',
        content: 'Hello {{customer_name}}',
      });
      expect(() => entity.updateBody('Hello {{customer_name}}, invoice {{invoice_id}}')).toThrow(
        InvalidTemplatePlaceholderError
      );
    });
  });

  describe('render()', () => {
    it('should render template with provided data', () => {
      const entity = MessageTemplateEntity.create({
        vendorId: VENDOR_ID,
        templateType: 'PAYMENT_REMINDER',
        languageCode: 'EN',
        content: 'Hi {{customer_name}}, pay Rs.{{amount}} by {{due_date}}',
      });
      const { text, unresolved } = entity.render({
        customer_name: 'Sharma',
        amount: '500',
        due_date: '2024-12-31',
      });
      expect(text).toBe('Hi Sharma, pay Rs.500 by 2024-12-31');
      expect(unresolved).toHaveLength(0);
    });

    it('should report unresolved placeholders', () => {
      const entity = MessageTemplateEntity.create({
        vendorId: VENDOR_ID,
        templateType: 'PAYMENT_REMINDER',
        languageCode: 'EN',
        content: 'Hi {{customer_name}}, pay {{amount}}',
      });
      const { unresolved } = entity.render({ customer_name: 'Sharma' });
      expect(unresolved).toContain('amount');
    });
  });

  describe('getProps() — immutability', () => {
    it('getProps() should return frozen object', () => {
      const entity = MessageTemplateEntity.create({
        vendorId: VENDOR_ID,
        templateType: 'MONTHLY_BILL',
        languageCode: 'EN',
        content: 'Bill: {{customer_name}}, {{total_due}}',
      });
      expect(Object.isFrozen(entity.getProps())).toBe(true);
    });
  });

  describe('equals()', () => {
    it('should be equal for same id', () => {
      const type = TemplateTypeVO.create('LEAVE_CONFIRMATION');
      const body = TemplateBodyVO.create(
        'Dear {{customer_name}}, leave {{from_date}} to {{to_date}}',
        type
      );
      const a = MessageTemplateEntity.reconstitute({
        id: 7n,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        props: {
          vendorId: VENDOR_ID,
          templateType: type,
          languageCode: SupportedLanguageVO.create('EN'),
          body,
          isActive: true,
        },
      });
      const b = MessageTemplateEntity.reconstitute({
        id: 7n,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        props: {
          vendorId: VENDOR_ID,
          templateType: type,
          languageCode: SupportedLanguageVO.create('EN'),
          body,
          isActive: true,
        },
      });
      expect(a.equals(b)).toBe(true);
    });

    it('should not be equal for different ids', () => {
      const type = TemplateTypeVO.create('MONTHLY_BILL');
      const body = TemplateBodyVO.create('Bill {{customer_name}} {{total_due}}', type);
      const makeEntity = (id: bigint) =>
        MessageTemplateEntity.reconstitute({
          id,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
          props: {
            vendorId: VENDOR_ID,
            templateType: type,
            languageCode: SupportedLanguageVO.create('EN'),
            body,
            isActive: true,
          },
        });
      expect(makeEntity(1n).equals(makeEntity(2n))).toBe(false);
    });
  });
});
