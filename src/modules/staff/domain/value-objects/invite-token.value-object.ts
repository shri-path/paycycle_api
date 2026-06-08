import crypto from 'crypto';
import { ArgumentInvalidException } from '@/common/errors/app-error';

const TOKEN_BYTES = 32; // 256-bit CSPRNG token
const SHA256_HEX_LENGTH = 64;

/**
 * Opaque single-use invite token.
 *
 * - The RAW token is generated with a CSPRNG (`crypto.randomBytes`) — NEVER Math.random
 *   (memory rule: CSPRNG for secrets).
 * - Only the sha256 HASH is ever persisted; the raw token appears solely in the invite link.
 */
export const InviteToken = {
  /**
   * Generate a fresh raw token (returned out-of-band) plus its storable hash.
   */
  generate(): { raw: string; hash: string } {
    const raw = crypto.randomBytes(TOKEN_BYTES).toString('hex');
    return { raw, hash: InviteToken.hash(raw) };
  },

  /**
   * Compute the sha256 hex digest of a raw token.
   */
  hash(raw: string): string {
    const trimmed = (raw ?? '').trim();
    if (!trimmed) {
      throw new ArgumentInvalidException('Invite token must not be empty');
    }
    return crypto.createHash('sha256').update(trimmed).digest('hex');
  },

  isValidHash(hash: string): boolean {
    return typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash);
  },

  hashLength(): number {
    return SHA256_HEX_LENGTH;
  },
};
