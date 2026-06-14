/**
 * Unit tests for ReminderConfigEntity aggregate root.
 */
import { ReminderConfigEntity } from '../domain/reminder-config.entity';
import { ArgumentInvalidException } from '@/common/errors/app-error';

const VENDOR_ID = 7n;

describe('ReminderConfigEntity', () => {
  // ── create() ──────────────────────────────────────────────────────────────

  describe('create()', () => {
    it('should apply defaults for a new vendor', () => {
      const entity = ReminderConfigEntity.create(VENDOR_ID);
      const props = entity.getProps();
      expect(props.vendorId).toBe(VENDOR_ID);
      expect(props.autoRemindersEnabled).toBe(false);
      expect(props.schedule3Days).toBe(true);
      expect(props.schedule15Days).toBe(true);
      expect(props.schedule30Days).toBe(true);
      expect(props.reminderTemplate).toBeNull();
      expect(props.excludedCustomerIds).toEqual([]);
    });

    it('should start with id=0n (not yet persisted)', () => {
      const entity = ReminderConfigEntity.create(VENDOR_ID);
      expect(entity.id).toBe(0n);
    });
  });

  // ── reconstitute() ───────────────────────────────────────────────────────

  describe('reconstitute()', () => {
    it('should reconstitute from persisted data', () => {
      const now = new Date();
      const entity = ReminderConfigEntity.reconstitute({
        id: 3n,
        createdAt: now,
        updatedAt: now,
        props: {
          vendorId: VENDOR_ID,
          autoRemindersEnabled: true,
          schedule3Days: true,
          schedule15Days: false,
          schedule30Days: false,
          reminderTemplate: 'Pay {amount} to {vendor_name}',
          excludedCustomerIds: [1, 2],
        },
      });
      expect(entity.id).toBe(3n);
      expect(entity.getProps().autoRemindersEnabled).toBe(true);
      expect(entity.getProps().excludedCustomerIds).toEqual([1, 2]);
    });
  });

  // ── getProps() + immutability ─────────────────────────────────────────────

  describe('getProps()', () => {
    it('should return a frozen object', () => {
      const entity = ReminderConfigEntity.create(VENDOR_ID);
      expect(Object.isFrozen(entity.getProps())).toBe(true);
    });
  });

  // ── equals() ─────────────────────────────────────────────────────────────

  describe('equals()', () => {
    it('should be equal for same ID', () => {
      const now = new Date();
      const base = {
        id: 5n,
        createdAt: now,
        updatedAt: now,
        props: {
          vendorId: VENDOR_ID,
          autoRemindersEnabled: false,
          schedule3Days: true,
          schedule15Days: true,
          schedule30Days: true,
          reminderTemplate: null,
          excludedCustomerIds: [] as number[],
        },
      };
      expect(
        ReminderConfigEntity.reconstitute(base).equals(ReminderConfigEntity.reconstitute(base))
      ).toBe(true);
    });

    it('should return false for undefined', () => {
      const entity = ReminderConfigEntity.create(VENDOR_ID);
      expect(entity.equals(undefined)).toBe(false);
    });
  });

  // ── update() — invariants ────────────────────────────────────────────────

  describe('update() — invariants', () => {
    it('should throw when autoRemindersEnabled=true and all schedules off', () => {
      const entity = ReminderConfigEntity.create(VENDOR_ID);
      expect(() =>
        entity.update({
          autoRemindersEnabled: true,
          schedule3Days: false,
          schedule15Days: false,
          schedule30Days: false,
        })
      ).toThrow(ArgumentInvalidException);
    });

    it('should not throw when at least one schedule remains on', () => {
      const entity = ReminderConfigEntity.create(VENDOR_ID);
      expect(() =>
        entity.update({
          autoRemindersEnabled: true,
          schedule3Days: true,
          schedule15Days: false,
          schedule30Days: false,
        })
      ).not.toThrow();
    });

    it('should throw when template uses an unknown placeholder', () => {
      const entity = ReminderConfigEntity.create(VENDOR_ID);
      expect(() => entity.update({ reminderTemplate: 'Hello {invalid_placeholder}' })).toThrow(
        ArgumentInvalidException
      );
    });

    it('should accept a template with only allowed placeholders', () => {
      const entity = ReminderConfigEntity.create(VENDOR_ID);
      expect(() =>
        entity.update({ reminderTemplate: 'Hi {customer_name}, your bill is {amount}' })
      ).not.toThrow();
      expect(entity.getProps().reminderTemplate).toBe('Hi {customer_name}, your bill is {amount}');
    });

    it('should deduplicate and keep only positive integers in excludedCustomerIds', () => {
      const entity = ReminderConfigEntity.create(VENDOR_ID);
      entity.update({ excludedCustomerIds: [1, 2, 2, 3] });
      expect(entity.getProps().excludedCustomerIds).toEqual([1, 2, 3]);
    });

    it('should silently filter out non-positive integers from excludedCustomerIds', () => {
      // The entity filters invalid ids before storing (does not throw)
      const entity = ReminderConfigEntity.create(VENDOR_ID);
      entity.update({ excludedCustomerIds: [0, -5, 1, 2] });
      // 0 and -5 are filtered, only 1 and 2 remain
      expect(entity.getProps().excludedCustomerIds).toEqual([1, 2]);
    });

    it('should update updatedAt on each call', () => {
      const entity = ReminderConfigEntity.create(VENDOR_ID);
      const before = entity.updatedAt;
      entity.update({ schedule3Days: false });
      expect(entity.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });
  });
});
