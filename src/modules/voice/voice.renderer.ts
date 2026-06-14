/**
 * MessageTemplateRenderer — public facade for billing/reminder modules.
 * Render a message template with data substitution and resolve bill language.
 * No framework imports; depends only on domain entities/VOs.
 */
import { MessageTemplateEntity } from './domain/message-template.entity';
import { BillLanguagePolicyVO } from './domain/value-objects/bill-language-policy.vo';
import { SupportedLanguageVO } from './domain/value-objects/supported-language.vo';

export class MessageTemplateRenderer {
  /**
   * Render a template with data.
   * Returns { text, unresolved } where unresolved lists placeholder tokens
   * that had no matching key in data.
   */
  render(
    template: MessageTemplateEntity,
    data: Record<string, string>
  ): { text: string; unresolved: string[] } {
    return template.render(data);
  }

  /**
   * Resolve the language in which a bill should be rendered.
   * policy: 'CUSTOMER' | 'MY_LANGUAGE' | 'ENGLISH'
   * ownerLangCode: e.g. 'HI'
   * customerLangCode: e.g. 'TA'
   */
  resolveBillLanguage(policy: string, ownerLangCode: string, customerLangCode: string): string {
    const policyVO = BillLanguagePolicyVO.create(policy);
    const ownerLang = SupportedLanguageVO.create(ownerLangCode);
    const customerLang = SupportedLanguageVO.create(customerLangCode);
    return policyVO.resolve(ownerLang, customerLang).value.toLowerCase();
  }
}
