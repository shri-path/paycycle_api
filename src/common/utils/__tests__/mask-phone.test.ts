/**
 * Unit tests — maskPhone PII helper (US-15.2 / US-007 conventions).
 */
import { maskPhone } from '../mask-phone';

describe('maskPhone', () => {
  it('keeps only the last 4 digits of a plain 10-digit number', () => {
    expect(maskPhone('9876543210')).toBe('******3210');
  });

  it('preserves a leading + and masks the rest, keeping the last 4 digits', () => {
    expect(maskPhone('+919876543210')).toBe('+********3210');
  });

  it('does not leak any of the masked digits', () => {
    const masked = maskPhone('+919876543210');
    expect(masked).not.toBeNull();
    expect(masked).not.toContain('987654');
    expect(masked).toMatch(/3210$/);
  });

  it('masks non-+ separators so formatting is not leaked', () => {
    // 10 digits total: last 4 (3210) revealed, separators masked.
    expect(maskPhone('98765-43210')).toBe('*******3210');
  });

  it('fully masks numbers with 4 or fewer digits (reveal nothing)', () => {
    expect(maskPhone('1234')).toBe('****');
    expect(maskPhone('123')).toBe('***');
  });

  it('returns null for null/undefined/empty input', () => {
    expect(maskPhone(null)).toBeNull();
    expect(maskPhone(undefined)).toBeNull();
    expect(maskPhone('')).toBeNull();
    expect(maskPhone('   ')).toBeNull();
  });
});
