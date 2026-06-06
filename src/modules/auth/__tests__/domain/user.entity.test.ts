import { UserEntity } from '../../domain/user.entity';
import {
  PhoneNumber,
  ArgumentInvalidException,
} from '../../domain/value-objects/phone-number.value-object';
import { HashedPassword } from '../../domain/value-objects/hashed-password.value-object';
import { UserRegisteredEvent } from '../../domain/events/user-registered.domain-event';
import { UserLoggedInEvent } from '../../domain/events/user-logged-in.domain-event';
import { PasswordChangedEvent } from '../../domain/events/password-changed.domain-event';

const VALID_HASH = '$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012345';

function makeValidProps() {
  return {
    phone: PhoneNumber.create('+919876543210'),
    passwordHash: HashedPassword.create(VALID_HASH),
  };
}

describe('UserEntity', () => {
  describe('create()', () => {
    it('creates entity with valid props', () => {
      const user = UserEntity.create(makeValidProps());
      expect(user.getProps().phone.unpack()).toBe('+919876543210');
      expect(user.getProps().preferredLanguage).toBe('en');
      expect(user.getProps().deletedAt).toBeNull();
    });

    it('sets default preferredLanguage to en', () => {
      const user = UserEntity.create(makeValidProps());
      expect(user.getProps().preferredLanguage).toBe('en');
    });

    it('uses provided preferredLanguage', () => {
      const user = UserEntity.create({ ...makeValidProps(), preferredLanguage: 'hi' });
      expect(user.getProps().preferredLanguage).toBe('hi');
    });

    it('throws ArgumentInvalidException for invalid preferredLanguage', () => {
      expect(() => UserEntity.create({ ...makeValidProps(), preferredLanguage: 'xx' })).toThrow(
        ArgumentInvalidException
      );
    });
  });

  describe('emitRegisteredEvent()', () => {
    it('emits UserRegisteredEvent after creation', () => {
      const user = UserEntity.create(makeValidProps());
      user.emitRegisteredEvent(1n, 'test-correlation-id');
      const events = user.getDomainEvents();
      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(UserRegisteredEvent);
    });
  });

  describe('recordLogin()', () => {
    it('updates lastLoginAt and emits UserLoggedInEvent', () => {
      const user = UserEntity.reconstitute({
        id: 1n,
        createdAt: new Date(),
        updatedAt: new Date(),
        props: {
          phone: PhoneNumber.create('+919876543210'),
          passwordHash: HashedPassword.create(VALID_HASH),
          name: null,
          email: null,
          profilePhotoUrl: null,
          preferredLanguage: 'en',
          lastLoginAt: null,
          deletedAt: null,
        },
      });

      user.recordLogin('corr-id');
      expect(user.getProps().lastLoginAt).not.toBeNull();
      const events = user.getDomainEvents();
      expect(events[0]).toBeInstanceOf(UserLoggedInEvent);
    });
  });

  describe('changePassword()', () => {
    it('updates passwordHash and emits PasswordChangedEvent', () => {
      const user = UserEntity.reconstitute({
        id: 1n,
        createdAt: new Date(),
        updatedAt: new Date(),
        props: {
          phone: PhoneNumber.create('+919876543210'),
          passwordHash: HashedPassword.create(VALID_HASH),
          name: null,
          email: null,
          profilePhotoUrl: null,
          preferredLanguage: 'en',
          lastLoginAt: null,
          deletedAt: null,
        },
      });

      const newHash = HashedPassword.create('$2b$10$' + 'x'.repeat(53));
      user.changePassword(newHash, 'corr-id');
      expect(user.getProps().passwordHash.unpack()).toBe('$2b$10$' + 'x'.repeat(53));
      expect(user.getDomainEvents()[0]).toBeInstanceOf(PasswordChangedEvent);
    });
  });

  describe('softDelete()', () => {
    it('sets deletedAt', () => {
      const user = UserEntity.create(makeValidProps());
      user.softDelete();
      expect(user.getProps().deletedAt).not.toBeNull();
    });
  });
});
