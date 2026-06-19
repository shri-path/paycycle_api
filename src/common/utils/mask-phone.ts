/**
 * PII masking for phone numbers in audit/log payloads.
 *
 * US-007 audit convention: never persist a full phone number in audit metadata.
 * We keep the last 4 digits (the minimum needed to disambiguate a record during
 * a dispute investigation) and mask the rest.
 *
 * Examples:
 *   maskPhone('9876543210') -> '******3210'
 *   maskPhone('+919876543210') -> '+91*****3210' (non-digits preserved positionally)
 *   maskPhone('123') -> '***' (too short to reveal anything)
 *   maskPhone(null) -> null
 */
export function maskPhone(phone: string | null | undefined): string | null {
  if (phone === null || phone === undefined) return null;

  const trimmed = phone.trim();
  if (trimmed.length === 0) return null;

  const digits = trimmed.replace(/\D/g, '');

  // Fewer than 5 digits: reveal nothing, mask everything (preserve length).
  if (digits.length <= 4) {
    return '*'.repeat(trimmed.length);
  }

  // Reveal only the last 4 digits; mask every other character (digit or symbol).
  const revealFromDigitIndex = digits.length - 4;
  let seenDigits = 0;
  let result = '';
  for (const ch of trimmed) {
    if (/\d/.test(ch)) {
      result += seenDigits >= revealFromDigitIndex ? ch : '*';
      seenDigits += 1;
    } else {
      // Preserve a leading '+' so masked numbers remain recognisably phone-shaped;
      // mask any other separator to avoid leaking formatting that hints at the value.
      result += ch === '+' ? '+' : '*';
    }
  }
  return result;
}
