/**
 * TemplateTypeVO — value object for message template type.
 * Holds the allowed placeholder list per type.
 * Pure domain, no framework imports.
 */
import { ArgumentInvalidException } from '@/common/errors/app-error';
import { TemplateTypeValue } from '../voice.types';

const VALID_TYPES = new Set(Object.values(TemplateTypeValue));

const ALLOWED_PLACEHOLDERS: Record<TemplateTypeValue, readonly string[]> = {
  [TemplateTypeValue.PAYMENT_REMINDER]: [
    'customer_name',
    'month',
    'amount',
    'upi_id',
    'phone',
    'vendor_name',
    'due_date',
  ],
  [TemplateTypeValue.MONTHLY_BILL]: [
    'customer_name',
    'month',
    'total_due',
    'items',
    'upi_id',
    'phone',
    'vendor_name',
  ],
  [TemplateTypeValue.DELIVERY_CONFIRMATION]: [
    'customer_name',
    'item',
    'quantity',
    'date',
    'vendor_name',
  ],
  [TemplateTypeValue.LEAVE_CONFIRMATION]: ['customer_name', 'from_date', 'to_date', 'vendor_name'],
};

export class TemplateTypeVO {
  readonly value: TemplateTypeValue;

  private constructor(value: TemplateTypeValue) {
    this.value = value;
  }

  static create(raw: string): TemplateTypeVO {
    const upper = raw.toUpperCase();
    if (!VALID_TYPES.has(upper as TemplateTypeValue)) {
      throw new ArgumentInvalidException(
        `Invalid template type: "${raw}". Must be one of: ${[...VALID_TYPES].join(', ')}`
      );
    }
    return new TemplateTypeVO(upper as TemplateTypeValue);
  }

  allowedPlaceholders(): readonly string[] {
    return ALLOWED_PLACEHOLDERS[this.value];
  }

  equals(other: TemplateTypeVO): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
