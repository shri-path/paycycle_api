/**
 * LanguagePreferenceEntity — aggregate root for user language & voice settings.
 * Pure domain, no framework imports.
 */
import { ArgumentInvalidException } from '@/common/errors/app-error';
import { SupportedLanguageVO } from './value-objects/supported-language.vo';
import { BillLanguagePolicyVO } from './value-objects/bill-language-policy.vo';
import { SupportedLanguageCode, BillLanguagePolicyValue } from './voice.types';

export interface LanguagePreferenceProps {
  userId: bigint;
  appLanguage: SupportedLanguageVO;
  secondaryLanguage: SupportedLanguageVO | null;
  voiceCommandsEnabled: boolean;
  voiceResponsesEnabled: boolean;
  transliterationEnabled: boolean;
  billLanguageDefault: BillLanguagePolicyVO;
  preferredVoiceAccent: string | null;
}

export interface LanguagePreferencePatch {
  appLanguage?: string;
  secondaryLanguage?: string | null;
  voiceCommandsEnabled?: boolean;
  voiceResponsesEnabled?: boolean;
  transliterationEnabled?: boolean;
  billLanguageDefault?: string;
  preferredVoiceAccent?: string | null;
}

export class LanguagePreferenceEntity {
  private readonly _id: bigint;
  private readonly _createdAt: Date;
  private _updatedAt: Date;
  private _props: LanguagePreferenceProps;

  private constructor(
    id: bigint,
    createdAt: Date,
    updatedAt: Date,
    props: LanguagePreferenceProps
  ) {
    this._id = id;
    this._createdAt = createdAt;
    this._updatedAt = updatedAt;
    this._props = props;
  }

  get id(): bigint {
    return this._id;
  }
  get createdAt(): Date {
    return this._createdAt;
  }
  get updatedAt(): Date {
    return this._updatedAt;
  }

  getProps(): Readonly<LanguagePreferenceProps & { id: bigint; createdAt: Date; updatedAt: Date }> {
    return Object.freeze({
      id: this._id,
      createdAt: this._createdAt,
      updatedAt: this._updatedAt,
      ...this._props,
    });
  }

  equals(other?: LanguagePreferenceEntity): boolean {
    if (!other) return false;
    return this._id === other._id;
  }

  // ── Factory: defaults (returned when no row exists) ──────────────────────────

  static createDefault(userId: bigint): LanguagePreferenceEntity {
    const entity = new LanguagePreferenceEntity(0n, new Date(), new Date(), {
      userId,
      appLanguage: SupportedLanguageVO.create(SupportedLanguageCode.EN),
      secondaryLanguage: null,
      voiceCommandsEnabled: false,
      voiceResponsesEnabled: false,
      transliterationEnabled: false,
      billLanguageDefault: BillLanguagePolicyVO.create(BillLanguagePolicyValue.CUSTOMER),
      preferredVoiceAccent: null,
    });
    entity.validate();
    return entity;
  }

  // ── Factory: reconstitute from persistence ───────────────────────────────────

  static reconstitute(data: {
    id: bigint;
    createdAt: Date;
    updatedAt: Date;
    props: LanguagePreferenceProps;
  }): LanguagePreferenceEntity {
    const entity = new LanguagePreferenceEntity(
      data.id,
      data.createdAt,
      data.updatedAt,
      data.props
    );
    entity.validate();
    return entity;
  }

  // ── Domain behaviour ─────────────────────────────────────────────────────────

  update(patch: LanguagePreferencePatch): void {
    const next = { ...this._props };

    if (patch.appLanguage !== undefined) {
      next.appLanguage = SupportedLanguageVO.create(patch.appLanguage);
    }
    if (patch.secondaryLanguage !== undefined) {
      next.secondaryLanguage =
        patch.secondaryLanguage != null
          ? SupportedLanguageVO.create(patch.secondaryLanguage)
          : null;
    }
    if (patch.voiceCommandsEnabled !== undefined) {
      next.voiceCommandsEnabled = patch.voiceCommandsEnabled;
    }
    if (patch.voiceResponsesEnabled !== undefined) {
      next.voiceResponsesEnabled = patch.voiceResponsesEnabled;
    }
    if (patch.transliterationEnabled !== undefined) {
      next.transliterationEnabled = patch.transliterationEnabled;
    }
    if (patch.billLanguageDefault !== undefined) {
      next.billLanguageDefault = BillLanguagePolicyVO.create(patch.billLanguageDefault);
    }
    if (patch.preferredVoiceAccent !== undefined) {
      next.preferredVoiceAccent = patch.preferredVoiceAccent ?? null;
    }

    this._props = next;
    this._updatedAt = new Date();
    this.validate();
  }

  // ── Invariants ───────────────────────────────────────────────────────────────

  private validate(): void {
    const p = this._props;

    // Invariant: secondaryLanguage ≠ appLanguage
    if (p.secondaryLanguage && p.secondaryLanguage.equals(p.appLanguage)) {
      throw new ArgumentInvalidException('secondaryLanguage must differ from appLanguage');
    }

    // Invariant: EN → transliterationEnabled must be false
    if (p.appLanguage.value === SupportedLanguageCode.EN && p.transliterationEnabled) {
      throw new ArgumentInvalidException(
        'transliterationEnabled must be false when appLanguage is EN'
      );
    }
  }

  /** Forces transliteration off when language is EN (idempotent). */
  forceTransliterationOffForEnglish(): void {
    if (this._props.appLanguage.value === SupportedLanguageCode.EN) {
      this._props = { ...this._props, transliterationEnabled: false };
    }
  }
}
