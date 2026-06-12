/**
 * Unit tests for VendorSettingsEntity aggregate root.
 */
import { VendorSettingsEntity } from '../domain/vendor-settings.entity';
import { InvalidTimeOfDayError } from '../domain/vendor-settings.errors';
import { VendorSettingsUpdatedEvent } from '../domain/events/vendor-settings-updated.domain-event';

const VENDOR_ID = 1n;

describe('VendorSettingsEntity', () => {
  describe('create()', () => {
    it('should apply defaults for all optional fields', () => {
      const entity = VendorSettingsEntity.create({ vendorId: VENDOR_ID });
      const props = entity.getProps();
      expect(props.autoMarkEnabled).toBe(true);
      expect(props.autoSendBillsEnabled).toBe(false);
      expect(props.autoSendBillsTime).toBe('20:00');
      expect(props.notificationPreferences).toEqual({});
    });

    it('should accept custom initial values', () => {
      const entity = VendorSettingsEntity.create({
        vendorId: VENDOR_ID,
        autoMarkEnabled: false,
        autoSendBillsTime: '08:00',
      });
      expect(entity.autoMarkEnabled).toBe(false);
      expect(entity.autoSendBillsTime).toBe('08:00');
    });

    it('should throw InvalidTimeOfDayError for invalid time on create', () => {
      expect(() =>
        VendorSettingsEntity.create({ vendorId: VENDOR_ID, autoSendBillsTime: '25:00' })
      ).toThrow(InvalidTimeOfDayError);
    });
  });

  describe('fromPersistence()', () => {
    it('should reconstitute from a valid persistence row', () => {
      const now = new Date();
      const entity = VendorSettingsEntity.fromPersistence({
        id: 42n,
        vendorId: VENDOR_ID,
        autoMarkEnabled: false,
        autoSendBillsEnabled: true,
        autoSendBillsTime: '09:00',
        notificationPreferences: { reminders: true },
        createdAt: now,
        updatedAt: now,
      });
      expect(entity.id).toBe(42n);
      expect(entity.autoSendBillsEnabled).toBe(true);
    });
  });

  describe('update()', () => {
    it('should apply partial patch and track changed keys', () => {
      const entity = VendorSettingsEntity.create({ vendorId: VENDOR_ID });
      entity.update({ autoMarkEnabled: false }, { correlationId: 'test-corr' });
      expect(entity.autoMarkEnabled).toBe(false);

      const events = entity.pullEvents();
      expect(events).toHaveLength(1);
      const event = events[0] as VendorSettingsUpdatedEvent;
      expect(event.payload.changed).toContain('autoMarkEnabled');
    });

    it('should emit VendorSettingsUpdatedEvent with correct payload', () => {
      const entity = VendorSettingsEntity.create({ vendorId: VENDOR_ID });
      entity.update(
        { autoSendBillsEnabled: true, autoSendBillsTime: '21:00' },
        { correlationId: 'corr-1' }
      );
      const events = entity.pullEvents();
      expect(events).toHaveLength(1);
      const event = events[0] as VendorSettingsUpdatedEvent;
      expect(event.type).toBe('vendor-settings.updated');
      expect(event.payload.changed).toEqual(
        expect.arrayContaining(['autoSendBillsEnabled', 'autoSendBillsTime'])
      );
      expect(event.payload.autoSendBillsEnabled).toBe(true);
      expect(event.metadata.correlationId).toBe('corr-1');
    });

    it('should throw InvalidTimeOfDayError for invalid time in update', () => {
      const entity = VendorSettingsEntity.create({ vendorId: VENDOR_ID });
      expect(() => entity.update({ autoSendBillsTime: 'bad:time' })).toThrow(InvalidTimeOfDayError);
    });

    it('should not add unchanged fields to the changed list', () => {
      const entity = VendorSettingsEntity.create({ vendorId: VENDOR_ID });
      // autoMarkEnabled is already true — no change
      entity.update({ autoMarkEnabled: true });
      const events = entity.pullEvents();
      expect(events[0]?.payload.changed).not.toContain('autoMarkEnabled');
    });

    it('should pull events and clear the queue', () => {
      const entity = VendorSettingsEntity.create({ vendorId: VENDOR_ID });
      entity.update({ autoMarkEnabled: false });
      expect(entity.pullEvents()).toHaveLength(1);
      // Queue is now empty
      expect(entity.pullEvents()).toHaveLength(0);
    });
  });

  describe('validate() — invariants', () => {
    it('should reject invalid time via create', () => {
      expect(() =>
        VendorSettingsEntity.create({ vendorId: VENDOR_ID, autoSendBillsTime: '99:99' })
      ).toThrow(InvalidTimeOfDayError);
    });
  });
});
