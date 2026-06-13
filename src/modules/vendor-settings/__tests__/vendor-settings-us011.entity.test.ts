/**
 * Unit tests for VendorSettingsEntity — US-011 extended fields.
 */
import { VendorSettingsEntity } from '../domain/vendor-settings.entity';
import {
  InvalidCreditLimitError,
  InvalidCreditPeriodError,
} from '../domain/vendor-settings.errors';
import { NotificationPreferencesUpdatedEvent } from '../domain/events/notification-preferences-updated.domain-event';

const VENDOR_ID = 1n;

describe('VendorSettingsEntity — US-011 new fields', () => {
  describe('create() with new fields', () => {
    it('should default new fields to null/50', () => {
      const entity = VendorSettingsEntity.create({ vendorId: VENDOR_ID });
      const props = entity.getProps();
      expect(props.defaultCreditLimit).toBeNull();
      expect(props.defaultCreditPeriodDays).toBeNull();
      expect(props.bulkOperationConcurrencyLimit).toBe(50);
    });

    it('should accept valid credit limit', () => {
      const entity = VendorSettingsEntity.create({
        vendorId: VENDOR_ID,
        defaultCreditLimit: '2000.00',
        defaultCreditPeriodDays: 30,
        bulkOperationConcurrencyLimit: 100,
      });
      expect(entity.defaultCreditLimit).toBe('2000.00');
      expect(entity.defaultCreditPeriodDays).toBe(30);
      expect(entity.bulkOperationConcurrencyLimit).toBe(100);
    });

    it('should reject invalid credit limit (negative)', () => {
      expect(() =>
        VendorSettingsEntity.create({ vendorId: VENDOR_ID, defaultCreditLimit: '-1' })
      ).toThrow(InvalidCreditLimitError);
    });

    it('should reject invalid credit period (0)', () => {
      expect(() =>
        VendorSettingsEntity.create({ vendorId: VENDOR_ID, defaultCreditPeriodDays: 0 })
      ).toThrow(InvalidCreditPeriodError);
    });

    it('should reject invalid credit period (366)', () => {
      expect(() =>
        VendorSettingsEntity.create({ vendorId: VENDOR_ID, defaultCreditPeriodDays: 366 })
      ).toThrow(InvalidCreditPeriodError);
    });

    it('should reject concurrencyLimit > 500', () => {
      expect(() =>
        VendorSettingsEntity.create({ vendorId: VENDOR_ID, bulkOperationConcurrencyLimit: 501 })
      ).toThrow();
    });

    it('should reject concurrencyLimit < 1', () => {
      expect(() =>
        VendorSettingsEntity.create({ vendorId: VENDOR_ID, bulkOperationConcurrencyLimit: 0 })
      ).toThrow();
    });
  });

  describe('update() with new fields', () => {
    it('should track changes to new fields in event', () => {
      const entity = VendorSettingsEntity.create({ vendorId: VENDOR_ID });
      entity.update(
        { defaultCreditLimit: '3000.00', defaultCreditPeriodDays: 45 },
        { correlationId: 'test' }
      );
      const events = entity.pullEvents();
      expect(events).toHaveLength(1);
      const payload = events[0]!.payload as { changed: string[] };
      expect(payload).toMatchObject({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        changed: expect.arrayContaining(['defaultCreditLimit', 'defaultCreditPeriodDays']),
      });
    });

    it('should allow setting credit limit to null', () => {
      const entity = VendorSettingsEntity.create({
        vendorId: VENDOR_ID,
        defaultCreditLimit: '1000.00',
      });
      entity.update({ defaultCreditLimit: null });
      expect(entity.defaultCreditLimit).toBeNull();
    });

    it('should track bulkOperationConcurrencyLimit change', () => {
      const entity = VendorSettingsEntity.create({ vendorId: VENDOR_ID });
      entity.update({ bulkOperationConcurrencyLimit: 200 });
      expect(entity.bulkOperationConcurrencyLimit).toBe(200);
      const events = entity.pullEvents();
      const payload2 = events[0]!.payload as { changed: string[] };
      expect(payload2).toMatchObject({
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        changed: expect.arrayContaining(['bulkOperationConcurrencyLimit']),
      });
    });
  });

  describe('updateNotificationPreferences()', () => {
    it('should replace the preferences blob', () => {
      const entity = VendorSettingsEntity.create({ vendorId: VENDOR_ID });
      const newPrefs = { channels: { push: true, whatsapp: false } };
      entity.updateNotificationPreferences(newPrefs, { correlationId: 'pref-test' });
      expect(entity.notificationPreferences).toEqual(newPrefs);
    });

    it('should emit NotificationPreferencesUpdatedEvent', () => {
      const entity = VendorSettingsEntity.create({ vendorId: VENDOR_ID });
      entity.updateNotificationPreferences(
        { payment: { paymentReceived: true } },
        { correlationId: 'pref-corr' }
      );
      const events = entity.pullEvents();
      expect(events).toHaveLength(1);
      const event = events[0] as NotificationPreferencesUpdatedEvent;
      expect(event.type).toBe('vendor-settings.notification-preferences-updated');
      expect(event.payload.changedKeys).toContain('payment');
      expect(event.metadata.correlationId).toBe('pref-corr');
    });

    it('should throw when preferences is an array', () => {
      const entity = VendorSettingsEntity.create({ vendorId: VENDOR_ID });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
      expect(() => entity.updateNotificationPreferences([] as any)).toThrow();
    });
  });
});
