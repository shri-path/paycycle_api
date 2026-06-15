/**
 * Unit tests — VendorCreditEntity.
 * Covers: earn, use, adjust (clawback), invariants.
 */
import { VendorCreditEntity } from '../../domain/vendor-credit.entity';

describe('VendorCreditEntity', () => {
  const vendorId = BigInt(1);

  describe('create()', () => {
    it('should start with zero balances', () => {
      const entity = VendorCreditEntity.create(vendorId);
      expect(entity.availableCredits).toBe(0);
      expect(entity.lifetimeCreditsEarned).toBe(0);
      expect(entity.lifetimeCreditsUsed).toBe(0);
    });
  });

  describe('earn()', () => {
    it('should increase available and lifetime earned', () => {
      const entity = VendorCreditEntity.create(vendorId);
      entity.earn(500);
      expect(entity.availableCredits).toBe(500);
      expect(entity.lifetimeCreditsEarned).toBe(500);
    });

    it('should accumulate correctly', () => {
      const entity = VendorCreditEntity.create(vendorId);
      entity.earn(500);
      entity.earn(1000);
      expect(entity.availableCredits).toBe(1500);
      expect(entity.lifetimeCreditsEarned).toBe(1500);
    });

    it('should throw if amount is zero', () => {
      const entity = VendorCreditEntity.create(vendorId);
      expect(() => entity.earn(0)).toThrow('Earn amount must be positive');
    });

    it('should throw if amount is negative', () => {
      const entity = VendorCreditEntity.create(vendorId);
      expect(() => entity.earn(-100)).toThrow('Earn amount must be positive');
    });
  });

  describe('use()', () => {
    it('should decrease available and increase used', () => {
      const entity = VendorCreditEntity.create(vendorId);
      entity.earn(1000);
      entity.use(300);
      expect(entity.availableCredits).toBe(700);
      expect(entity.lifetimeCreditsUsed).toBe(300);
    });

    it('should throw if insufficient balance', () => {
      const entity = VendorCreditEntity.create(vendorId);
      entity.earn(100);
      expect(() => entity.use(200)).toThrow('Insufficient credits');
    });

    it('should throw if amount is zero', () => {
      const entity = VendorCreditEntity.create(vendorId);
      entity.earn(500);
      expect(() => entity.use(0)).toThrow('Use amount must be positive');
    });

    it('should allow using exact balance', () => {
      const entity = VendorCreditEntity.create(vendorId);
      entity.earn(500);
      entity.use(500);
      expect(entity.availableCredits).toBe(0);
    });
  });

  describe('adjust() — clawback', () => {
    it('should deduct from available credits', () => {
      const entity = VendorCreditEntity.create(vendorId);
      entity.earn(1000);
      entity.adjust(300);
      expect(entity.availableCredits).toBe(700);
    });

    it('should clamp to zero if adjustment exceeds balance', () => {
      const entity = VendorCreditEntity.create(vendorId);
      entity.earn(200);
      entity.adjust(500); // more than available
      expect(entity.availableCredits).toBe(0);
    });

    it('should increase lifetimeCreditsUsed by clamped amount', () => {
      const entity = VendorCreditEntity.create(vendorId);
      entity.earn(200);
      entity.adjust(500); // clamped to 200
      expect(entity.lifetimeCreditsUsed).toBe(200);
    });

    it('should throw if amount is zero', () => {
      const entity = VendorCreditEntity.create(vendorId);
      entity.earn(500);
      expect(() => entity.adjust(0)).toThrow('Adjustment amount must be positive');
    });
  });

  describe('fromPersistence()', () => {
    it('should throw if availableCredits is negative', () => {
      expect(() =>
        VendorCreditEntity.fromPersistence({
          id: BigInt(1),
          props: {
            vendorId,
            availableCredits: -1,
            lifetimeCreditsEarned: 100,
            lifetimeCreditsUsed: 101,
          },
        })
      ).toThrow('Available credits cannot be negative');
    });
  });
});
