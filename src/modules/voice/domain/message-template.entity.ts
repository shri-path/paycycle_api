/**
 * MessageTemplateEntity — aggregate root for vendor message templates.
 * Pure domain, no framework imports.
 */
import { SupportedLanguageVO } from './value-objects/supported-language.vo';
import { TemplateTypeVO } from './value-objects/template-type.vo';
import { TemplateBodyVO } from './value-objects/template-body.vo';

export interface MessageTemplateProps {
  vendorId: bigint;
  templateType: TemplateTypeVO;
  languageCode: SupportedLanguageVO;
  body: TemplateBodyVO;
  isActive: boolean;
}

export class MessageTemplateEntity {
  private readonly _id: bigint;
  private readonly _createdAt: Date;
  private _updatedAt: Date;
  private _deletedAt: Date | null;
  private _props: MessageTemplateProps;

  private constructor(
    id: bigint,
    createdAt: Date,
    updatedAt: Date,
    deletedAt: Date | null,
    props: MessageTemplateProps
  ) {
    this._id = id;
    this._createdAt = createdAt;
    this._updatedAt = updatedAt;
    this._deletedAt = deletedAt;
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
  get deletedAt(): Date | null {
    return this._deletedAt;
  }

  getProps(): Readonly<
    MessageTemplateProps & {
      id: bigint;
      createdAt: Date;
      updatedAt: Date;
      deletedAt: Date | null;
    }
  > {
    return Object.freeze({
      id: this._id,
      createdAt: this._createdAt,
      updatedAt: this._updatedAt,
      deletedAt: this._deletedAt,
      ...this._props,
    });
  }

  equals(other?: MessageTemplateEntity): boolean {
    if (!other) return false;
    return this._id === other._id;
  }

  // ── Factory ──────────────────────────────────────────────────────────────────

  static create(input: {
    vendorId: bigint;
    templateType: string;
    languageCode: string;
    content: string;
  }): MessageTemplateEntity {
    const type = TemplateTypeVO.create(input.templateType);
    const lang = SupportedLanguageVO.create(input.languageCode);
    const body = TemplateBodyVO.create(input.content, type);

    return new MessageTemplateEntity(0n, new Date(), new Date(), null, {
      vendorId: input.vendorId,
      templateType: type,
      languageCode: lang,
      body,
      isActive: true,
    });
  }

  static reconstitute(data: {
    id: bigint;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
    props: MessageTemplateProps;
  }): MessageTemplateEntity {
    return new MessageTemplateEntity(
      data.id,
      data.createdAt,
      data.updatedAt,
      data.deletedAt,
      data.props
    );
  }

  // ── Domain behaviour ─────────────────────────────────────────────────────────

  updateBody(content: string): void {
    this._props = {
      ...this._props,
      body: TemplateBodyVO.create(content, this._props.templateType),
    };
    this._updatedAt = new Date();
  }

  render(data: Record<string, string>): { text: string; unresolved: string[] } {
    return this._props.body.render(data);
  }
}
