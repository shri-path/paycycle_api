/**
 * Unit tests for all three voice module mappers.
 * Verifies toDomain, toPersistence, toResponse — whitelist enforcement.
 */
import { LanguagePreferenceMapper } from '../language-preference.mapper';
import { MessageTemplateMapper } from '../message-template.mapper';
import { VoiceCommandLogMapper } from '../voice-command-log.mapper';
import { LanguagePreferenceEntity } from '../domain/language-preference.entity';
import { MessageTemplateEntity } from '../domain/message-template.entity';
import { SupportedLanguageVO } from '../domain/value-objects/supported-language.vo';
import { BillLanguagePolicyVO } from '../domain/value-objects/bill-language-policy.vo';
import { TemplateTypeVO } from '../domain/value-objects/template-type.vo';
import { TemplateBodyVO } from '../domain/value-objects/template-body.vo';

// ── Helpers to create mock Prisma rows ───────────────────────────────────────

function makePrismaLangPrefRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1n,
    userId: 42n,
    appLanguage: 'HI' as unknown,
    secondaryLanguage: null as unknown,
    voiceCommandsEnabled: false,
    voiceResponsesEnabled: true,
    transliterationEnabled: true,
    billLanguageDefault: 'CUSTOMER' as unknown,
    preferredVoiceAccent: null as string | null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-02'),
    ...overrides,
  } as Parameters<typeof LanguagePreferenceMapper.toDomain>[0];
}

function makePrismaTemplateRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 5n,
    vendorId: 10n,
    templateType: 'PAYMENT_REMINDER' as unknown,
    languageCode: 'HI' as unknown,
    content: 'नमस्ते {{customer_name}}, {{amount}} रुपए बाकी हैं',
    isActive: true,
    createdAt: new Date('2024-02-01'),
    updatedAt: new Date('2024-02-02'),
    deletedAt: null as Date | null,
    ...overrides,
  } as Parameters<typeof MessageTemplateMapper.toDomain>[0];
}

function makePrismaLogRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 9n,
    userId: 1n,
    vendorId: 2n,
    languageCode: 'EN' as unknown,
    supplyListId: null as bigint | null,
    customerId: null as bigint | null,
    transcription: 'delivered to sharma' as string | null,
    detectedAction: 'MARK_DELIVERED' as string | null,
    confidenceScore: null as { toString(): string } | null,
    wasExecuted: false,
    executionResult: null as Record<string, unknown> | null,
    errorMessage: null as string | null,
    createdAt: new Date('2024-03-01'),
    ...overrides,
  } as Parameters<typeof VoiceCommandLogMapper.toDomain>[0];
}

// ── LanguagePreferenceMapper tests ────────────────────────────────────────────

describe('LanguagePreferenceMapper', () => {
  describe('toDomain()', () => {
    it('should map Prisma row to LanguagePreferenceEntity', () => {
      const row = makePrismaLangPrefRow();
      const entity = LanguagePreferenceMapper.toDomain(row);
      const p = entity.getProps();
      expect(p.userId).toBe(42n);
      expect(p.appLanguage.value).toBe('HI');
      expect(p.transliterationEnabled).toBe(true);
      expect(p.voiceResponsesEnabled).toBe(true);
    });

    it('should map secondaryLanguage when present', () => {
      const row = makePrismaLangPrefRow({ secondaryLanguage: 'EN' });
      const entity = LanguagePreferenceMapper.toDomain(row);
      expect(entity.getProps().secondaryLanguage?.value).toBe('EN');
    });
  });

  describe('toPersistence()', () => {
    it('should map entity to persistence shape', () => {
      const entity = LanguagePreferenceEntity.reconstitute({
        id: 1n,
        createdAt: new Date(),
        updatedAt: new Date(),
        props: {
          userId: 42n,
          appLanguage: SupportedLanguageVO.create('HI'),
          secondaryLanguage: SupportedLanguageVO.create('EN'),
          voiceCommandsEnabled: true,
          voiceResponsesEnabled: false,
          transliterationEnabled: true,
          billLanguageDefault: BillLanguagePolicyVO.create('MY_LANGUAGE'),
          preferredVoiceAccent: 'delhi',
        },
      });
      const persistence = LanguagePreferenceMapper.toPersistence(entity);
      expect(persistence.userId).toBe(42n);
      expect(persistence.appLanguage).toBe('HI');
      expect(persistence.secondaryLanguage).toBe('EN');
      expect(persistence.voiceCommandsEnabled).toBe(true);
      expect(persistence.billLanguageDefault).toBe('MY_LANGUAGE');
    });
  });

  describe('toResponse()', () => {
    it('should whitelist fields — never expose userId or id', () => {
      const entity = LanguagePreferenceMapper.toDomain(makePrismaLangPrefRow());
      const dto = LanguagePreferenceMapper.toResponse(entity);

      expect(dto).not.toHaveProperty('userId');
      expect(dto).not.toHaveProperty('id');
      expect(dto).toHaveProperty('appLanguage');
      expect(dto).toHaveProperty('billLanguageDefault');
    });

    it('should return lowercase language codes in response', () => {
      const entity = LanguagePreferenceMapper.toDomain(makePrismaLangPrefRow());
      const dto = LanguagePreferenceMapper.toResponse(entity);
      expect(dto.appLanguage).toBe('hi');
      expect(dto.billLanguageDefault).toBe('customer');
    });

    it('should return null secondaryLanguage when not set', () => {
      const entity = LanguagePreferenceMapper.toDomain(makePrismaLangPrefRow());
      const dto = LanguagePreferenceMapper.toResponse(entity);
      expect(dto.secondaryLanguage).toBeNull();
    });
  });
});

// ── MessageTemplateMapper tests ───────────────────────────────────────────────

describe('MessageTemplateMapper', () => {
  describe('toDomain()', () => {
    it('should map Prisma row to MessageTemplateEntity', () => {
      const row = makePrismaTemplateRow();
      const entity = MessageTemplateMapper.toDomain(row);
      const p = entity.getProps();
      expect(p.vendorId).toBe(10n);
      expect(p.templateType.value).toBe('PAYMENT_REMINDER');
      expect(p.languageCode.value).toBe('HI');
    });
  });

  describe('toPersistence()', () => {
    it('should map entity to persistence shape with raw body', () => {
      const type = TemplateTypeVO.create('PAYMENT_REMINDER');
      const entity = MessageTemplateEntity.reconstitute({
        id: 5n,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        props: {
          vendorId: 10n,
          templateType: type,
          languageCode: SupportedLanguageVO.create('HI'),
          body: TemplateBodyVO.create('नमस्ते {{customer_name}}, {{amount}} रुपए', type),
          isActive: true,
        },
      });
      const persistence = MessageTemplateMapper.toPersistence(entity);
      expect(persistence.vendorId).toBe(10n);
      expect(persistence.templateType).toBe('PAYMENT_REMINDER');
      expect(persistence.languageCode).toBe('HI');
      expect(persistence.content).toContain('{{customer_name}}');
    });
  });

  describe('toResponse()', () => {
    it('should whitelist correct fields and stringify id', () => {
      const entity = MessageTemplateMapper.toDomain(makePrismaTemplateRow());
      const dto = MessageTemplateMapper.toResponse(entity);

      expect(dto.id).toBe('5');
      expect(dto).toHaveProperty('templateType');
      expect(dto).toHaveProperty('languageCode');
      expect(dto).toHaveProperty('content');
      expect(dto).toHaveProperty('placeholders');
      expect(dto).toHaveProperty('isActive');
      expect(dto).toHaveProperty('createdAt');
      expect(dto).toHaveProperty('updatedAt');
      // Must not expose vendorId
      expect(dto).not.toHaveProperty('vendorId');
    });

    it('should return lowercase templateType and languageCode', () => {
      const entity = MessageTemplateMapper.toDomain(makePrismaTemplateRow());
      const dto = MessageTemplateMapper.toResponse(entity);
      expect(dto.templateType).toBe('payment_reminder');
      expect(dto.languageCode).toBe('hi');
    });

    it('should include extracted placeholders array', () => {
      const entity = MessageTemplateMapper.toDomain(makePrismaTemplateRow());
      const dto = MessageTemplateMapper.toResponse(entity);
      expect(Array.isArray(dto.placeholders)).toBe(true);
      expect(dto.placeholders).toContain('customer_name');
    });
  });
});

// ── VoiceCommandLogMapper tests ───────────────────────────────────────────────

describe('VoiceCommandLogMapper', () => {
  describe('toDomain()', () => {
    it('should map Prisma row to VoiceCommandLogEntity', () => {
      const row = makePrismaLogRow();
      const entity = VoiceCommandLogMapper.toDomain(row);
      const p = entity.getProps();
      expect(p.userId).toBe(1n);
      expect(p.vendorId).toBe(2n);
      expect(p.languageCode.value).toBe('EN');
      expect(p.transcription).toBe('delivered to sharma');
      expect(p.detectedAction).toBe('MARK_DELIVERED');
      expect(p.wasExecuted).toBe(false);
    });

    it('should map confidenceScore as VO when present', () => {
      const row = makePrismaLogRow({
        confidenceScore: { toString: () => '87.50' },
      });
      const entity = VoiceCommandLogMapper.toDomain(row);
      expect(entity.getProps().confidenceScore?.value).toBe(87.5);
    });

    it('should handle null confidenceScore', () => {
      const row = makePrismaLogRow({ confidenceScore: null });
      const entity = VoiceCommandLogMapper.toDomain(row);
      expect(entity.getProps().confidenceScore).toBeNull();
    });
  });

  describe('toPersistence()', () => {
    it('should map entity to persistence shape', () => {
      const entity = VoiceCommandLogMapper.toDomain(
        makePrismaLogRow({ wasExecuted: true, transcription: 'delivered' })
      );
      const persistence = VoiceCommandLogMapper.toPersistence(entity);
      expect(persistence.userId).toBe(1n);
      expect(persistence.vendorId).toBe(2n);
      expect(persistence.languageCode).toBe('EN');
      expect(persistence.wasExecuted).toBe(true);
      expect(persistence.transcription).toBe('delivered');
    });

    it('should serialize confidenceScore as number', () => {
      const entity = VoiceCommandLogMapper.toDomain(
        makePrismaLogRow({ confidenceScore: { toString: () => '75.00' } })
      );
      const persistence = VoiceCommandLogMapper.toPersistence(entity);
      expect(persistence.confidenceScore).toBe(75);
    });
  });
});
