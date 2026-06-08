import { passwordUtil } from '../utils/password.util';

describe('PasswordUtil', () => {
  const plainPassword = 'Test@123x';

  describe('hash()', () => {
    it('produces a bcrypt hash starting with $2b$', async () => {
      const hash = await passwordUtil.hash(plainPassword);
      expect(hash).toMatch(/^\$2b\$/);
    });

    it('produces a hash of at least 60 characters', async () => {
      const hash = await passwordUtil.hash(plainPassword);
      expect(hash.length).toBeGreaterThanOrEqual(60);
    });
  });

  describe('compare()', () => {
    it('returns true for correct password', async () => {
      const hash = await passwordUtil.hash(plainPassword);
      const result = await passwordUtil.compare(plainPassword, hash);
      expect(result).toBe(true);
    });

    it('returns false for wrong password', async () => {
      const hash = await passwordUtil.hash(plainPassword);
      const result = await passwordUtil.compare('WrongPassword!', hash);
      expect(result).toBe(false);
    });
  });
});
