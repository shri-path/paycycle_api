import { ArgumentInvalidException } from '@/common/errors/app-error';

/**
 * Allowed units of measurement for a supply list.
 * Case-insensitive on input; normalized to lowercase.
 */
const ALLOWED_UNITS = ['ltr', 'kg', 'pieces', 'grams', 'numbers', 'packets'] as const;

export type SupplyUnitValue = (typeof ALLOWED_UNITS)[number];

export class SupplyUnit {
  private readonly _value: SupplyUnitValue;

  private constructor(value: SupplyUnitValue) {
    this._value = value;
  }

  static create(raw: string): SupplyUnit {
    const normalized = raw.trim().toLowerCase();
    if (!ALLOWED_UNITS.includes(normalized as SupplyUnitValue)) {
      throw new ArgumentInvalidException(
        `Invalid unit: "${raw}". Allowed: ${ALLOWED_UNITS.join(', ')}`
      );
    }
    return new SupplyUnit(normalized as SupplyUnitValue);
  }

  static isValid(raw: string): boolean {
    return ALLOWED_UNITS.includes(raw.trim().toLowerCase() as SupplyUnitValue);
  }

  static all(): readonly SupplyUnitValue[] {
    return ALLOWED_UNITS;
  }

  get value(): SupplyUnitValue {
    return this._value;
  }

  unpack(): string {
    return this._value;
  }

  equals(other?: SupplyUnit): boolean {
    if (!other) return false;
    return this._value === other._value;
  }
}
