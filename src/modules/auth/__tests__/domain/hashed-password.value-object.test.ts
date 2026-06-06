import { HashedPassword } from '../../domain/value-objects/hashed-password.value-object';
import { ArgumentInvalidException } from '@/common/errors/app-error';

// bcrypt hash example (60 chars)
const VALID_BCRYPT_HASH = '$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012345';

describe('HashedPassword VO', () => {
  describe('valid hash', () => {
    it('accepts a 60-character bcrypt hash', () => {
      const hp = HashedPassword.create(VALID_BCRYPT_HASH);
      expect(hp.unpack()).toBe(VALID_BCRYPT_HASH);
    });

    it('accepts a hash longer than 60 chars', () => {
      const longHash = '$2b$10$' + 'a'.repeat(60);
      const hp = HashedPassword.create(longHash);
      expect(hp.unpack()).toBe(longHash);
    });
  });

  describe('invalid hash', () => {
    it('rejects empty string', () => {
      expect(() => HashedPassword.create('')).toThrow(ArgumentInvalidException);
    });

    it('rejects string shorter than 60 chars', () => {
      expect(() => HashedPassword.create('tooshort')).toThrow(ArgumentInvalidException);
    });
  });

  describe('unpack', () => {
    it('returns the hash string', () => {
      const hp = HashedPassword.create(VALID_BCRYPT_HASH);
      expect(hp.unpack()).toBe(VALID_BCRYPT_HASH);
    });
  });
});
