/**
 * TemplateBodyVO — validates and renders message template content.
 * Placeholder syntax: {{token}}. Token names must be snake_case letters only.
 * Pure domain, no framework imports.
 */
import { ArgumentInvalidException } from '@/common/errors/app-error';
import { InvalidTemplatePlaceholderError } from '../voice.errors';
import { TemplateTypeVO } from './template-type.vo';

const PLACEHOLDER_REGEX = /\{\{\s*([a-z_]+)\s*\}\}/g;
const MAX_LENGTH = 2000;

export class TemplateBodyVO {
  readonly raw: string;
  private readonly _placeholders: string[];

  private constructor(raw: string, placeholders: string[]) {
    this.raw = raw;
    this._placeholders = placeholders;
  }

  static create(raw: string, type: TemplateTypeVO): TemplateBodyVO {
    if (!raw || raw.trim().length === 0) {
      throw new ArgumentInvalidException('Template content must not be empty');
    }
    if (raw.length > MAX_LENGTH) {
      throw new ArgumentInvalidException(
        `Template content must not exceed ${MAX_LENGTH} characters (got ${raw.length})`
      );
    }

    const allowed = type.allowedPlaceholders();
    const found: string[] = [];
    let match: RegExpExecArray | null;
    const regex = new RegExp(PLACEHOLDER_REGEX.source, 'g');

    while ((match = regex.exec(raw)) !== null) {
      const token = match[1]!;
      if (!allowed.includes(token)) {
        throw new InvalidTemplatePlaceholderError(token);
      }
      if (!found.includes(token)) {
        found.push(token);
      }
    }

    return new TemplateBodyVO(raw, found);
  }

  placeholders(): string[] {
    return [...this._placeholders];
  }

  /** Renders the template, substituting {{token}} with data values. */
  render(data: Record<string, string>): { text: string; unresolved: string[] } {
    const unresolved: string[] = [];
    const text = this.raw.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_match, token: string) => {
      const val = data[token];
      if (val === undefined || val === null) {
        if (!unresolved.includes(token)) unresolved.push(token);
        return '';
      }
      return val;
    });
    return { text, unresolved };
  }

  equals(other: TemplateBodyVO): boolean {
    return this.raw === other.raw;
  }
}
