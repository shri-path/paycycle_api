/**
 * Unit tests for LanguagePreferenceEntity — invariants and lifecycle.
 */
import { LanguagePreferenceEntity } from '../domain/language-preference.entity';
import { SupportedLanguageVO } from '../domain/value-objects/supported-language.vo';
import { BillLanguagePolicyVO } from '../domain/value-objects/bill-language-policy.vo';
import { SupportedLanguageCode, BillLanguagePolicyValue } from '../domain/voice.types';
import { ArgumentInvalidException } from '@/common/errors/app-error';

const USER_ID = 42n;

function makeHiEntity(): LanguagePreferenceEntity {
  return LanguagePreferenceEntity.reconstitute({
    id: 1n,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    props: {
      userId: USER_ID,
      appLanguage: SupportedLanguageVO.create('HI'),
      secondaryLanguage: null,
      voiceCommandsEnabled: false,
      voiceResponsesEnabled: false,
      transliterationEnabled: true,
      billLanguageDefault: BillLanguagePolicyVO.create('CUSTOMER'),
      preferredVoiceAccent: null,
    },
  });
}

describe('LanguagePreferenceEntity', () => {
  describe('createDefault()', () => {
    it('should create entity with EN defaults', () => {
      const entity = LanguagePreferenceEntity.createDefault(USER_ID);
      const p = entity.getProps();
      expect(p.appLanguage.value).toBe(SupportedLanguageCode.EN);
      expect(p.voiceCommandsEnabled).toBe(false);
      expect(p.transliterationEnabled).toBe(false);
      expect(p.billLanguageDefault.value).toBe(BillLanguagePolicyValue.CUSTOMER);
    });

    it('should have id 0n (not persisted)', () => {
      const entity = LanguagePreferenceEntity.createDefault(USER_ID);
      expect(entity.id).toBe(0n);
    });
  });

  describe('reconstitute()', () => {
    it('should reconstitute entity with provided props', () => {
      const entity = makeHiEntity();
      const p = entity.getProps();
      expect(p.userId).toBe(USER_ID);
      expect(p.appLanguage.value).toBe('HI');
      expect(p.transliterationEnabled).toBe(true);
    });

    it('should throw when secondaryLanguage equals appLanguage', () => {
      expect(() =>
        LanguagePreferenceEntity.reconstitute({
          id: 1n,
          createdAt: new Date(),
          updatedAt: new Date(),
          props: {
            userId: USER_ID,
            appLanguage: SupportedLanguageVO.create('HI'),
            secondaryLanguage: SupportedLanguageVO.create('HI'), // same as primary
            voiceCommandsEnabled: false,
            voiceResponsesEnabled: false,
            transliterationEnabled: false,
            billLanguageDefault: BillLanguagePolicyVO.create('CUSTOMER'),
            preferredVoiceAccent: null,
          },
        })
      ).toThrow(ArgumentInvalidException);
    });

    it('should throw when EN + transliterationEnabled=true', () => {
      expect(() =>
        LanguagePreferenceEntity.reconstitute({
          id: 1n,
          createdAt: new Date(),
          updatedAt: new Date(),
          props: {
            userId: USER_ID,
            appLanguage: SupportedLanguageVO.create('EN'),
            secondaryLanguage: null,
            voiceCommandsEnabled: false,
            voiceResponsesEnabled: false,
            transliterationEnabled: true, // invalid for EN
            billLanguageDefault: BillLanguagePolicyVO.create('CUSTOMER'),
            preferredVoiceAccent: null,
          },
        })
      ).toThrow(ArgumentInvalidException);
    });
  });

  describe('update()', () => {
    it('should update appLanguage field', () => {
      const entity = makeHiEntity();
      entity.update({ appLanguage: 'ta' });
      expect(entity.getProps().appLanguage.value).toBe('TA');
    });

    it('should set secondaryLanguage', () => {
      const entity = makeHiEntity();
      entity.update({ secondaryLanguage: 'en' });
      expect(entity.getProps().secondaryLanguage?.value).toBe('EN');
    });

    it('should clear secondaryLanguage when null', () => {
      const entity = makeHiEntity();
      entity.update({ secondaryLanguage: 'en' });
      entity.update({ secondaryLanguage: null });
      expect(entity.getProps().secondaryLanguage).toBeNull();
    });

    it('should throw when updating to EN with transliterationEnabled still true', () => {
      const entity = makeHiEntity(); // transliterationEnabled=true
      expect(() => entity.update({ appLanguage: 'en' })).toThrow(ArgumentInvalidException);
    });

    it('should allow updating to EN if transliterationEnabled is also set false', () => {
      const entity = makeHiEntity();
      entity.update({ appLanguage: 'en', transliterationEnabled: false });
      expect(entity.getProps().appLanguage.value).toBe('EN');
      expect(entity.getProps().transliterationEnabled).toBe(false);
    });

    it('should throw when secondaryLanguage equals new appLanguage', () => {
      const entity = makeHiEntity();
      entity.update({ secondaryLanguage: 'en' });
      expect(() => entity.update({ appLanguage: 'en', transliterationEnabled: false })).toThrow(
        ArgumentInvalidException
      );
    });

    it('should update voiceCommandsEnabled', () => {
      const entity = makeHiEntity();
      entity.update({ voiceCommandsEnabled: true });
      expect(entity.getProps().voiceCommandsEnabled).toBe(true);
    });
  });

  describe('forceTransliterationOffForEnglish()', () => {
    it('should force transliterationEnabled=false when appLanguage is EN', () => {
      const entity = LanguagePreferenceEntity.reconstitute({
        id: 1n,
        createdAt: new Date(),
        updatedAt: new Date(),
        props: {
          userId: USER_ID,
          appLanguage: SupportedLanguageVO.create('EN'),
          secondaryLanguage: null,
          voiceCommandsEnabled: false,
          voiceResponsesEnabled: false,
          transliterationEnabled: false,
          billLanguageDefault: BillLanguagePolicyVO.create('CUSTOMER'),
          preferredVoiceAccent: null,
        },
      });
      entity.forceTransliterationOffForEnglish();
      expect(entity.getProps().transliterationEnabled).toBe(false);
    });

    it('should not change transliterationEnabled for non-EN language', () => {
      const entity = makeHiEntity();
      entity.forceTransliterationOffForEnglish();
      // HI with transliterationEnabled=true → unchanged
      expect(entity.getProps().transliterationEnabled).toBe(true);
    });
  });

  describe('getProps() — immutability', () => {
    it('getProps() should return frozen object', () => {
      const entity = makeHiEntity();
      const props = entity.getProps();
      expect(Object.isFrozen(props)).toBe(true);
    });
  });

  describe('equals()', () => {
    it('should be equal for same id', () => {
      const a = makeHiEntity();
      const b = makeHiEntity();
      expect(a.equals(b)).toBe(true);
    });

    it('should not be equal for different ids', () => {
      const a = makeHiEntity();
      const b = LanguagePreferenceEntity.reconstitute({
        id: 99n,
        createdAt: new Date(),
        updatedAt: new Date(),
        props: {
          userId: USER_ID,
          appLanguage: SupportedLanguageVO.create('HI'),
          secondaryLanguage: null,
          voiceCommandsEnabled: false,
          voiceResponsesEnabled: false,
          transliterationEnabled: true,
          billLanguageDefault: BillLanguagePolicyVO.create('CUSTOMER'),
          preferredVoiceAccent: null,
        },
      });
      expect(a.equals(b)).toBe(false);
    });

    it('should return false when compared to undefined', () => {
      const a = makeHiEntity();
      expect(a.equals(undefined)).toBe(false);
    });
  });
});
