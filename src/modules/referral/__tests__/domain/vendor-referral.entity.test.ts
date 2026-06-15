/**
 * Unit tests — VendorReferral entity.
 * Covers: factory, state machine, invariants, clawback, revenue-share window.
 */
import { VendorReferral } from '../../domain/vendor-referral.entity';
import {
  ReferralVendorStatus,
  VendorRewardType,
  REWARD_AMOUNTS,
} from '../../domain/vendor-referral.types';

const referrerVendorId = BigInt(1);
const refereeVendorId = BigInt(2);

function makeReferral(): VendorReferral {
  return VendorReferral.create({
    referrerVendorId,
    referralCode: 'MILK1234',
    refereePhone: '+919999999999',
    refereeName: 'Test Referee',
  });
}

describe('VendorReferral entity', () => {
  describe('create()', () => {
    it('should start in PENDING status', () => {
      const referral = makeReferral();
      expect(referral.status).toBe(ReferralVendorStatus.PENDING);
    });

    it('should default rewardType to CASH_CREDIT and rewardAmount to signup bonus', () => {
      const referral = makeReferral();
      expect(referral.rewardType).toBe(VendorRewardType.CASH_CREDIT);
      expect(referral.rewardAmount).toBe(REWARD_AMOUNTS.SIGNUP_BONUS);
    });

    it('should store referralCode and refereePhone', () => {
      const referral = makeReferral();
      expect(referral.referralCode).toBe('MILK1234');
      expect(referral.refereePhone).toBe('+919999999999');
    });

    it('should have null refereeVendorId before attribution', () => {
      const referral = makeReferral();
      expect(referral.refereeVendorId).toBeNull();
    });
  });

  describe('attributeSignup()', () => {
    it('should transition PENDING → SIGNED_UP', () => {
      const referral = makeReferral();
      referral.attributeSignup(refereeVendorId);
      expect(referral.status).toBe(ReferralVendorStatus.SIGNED_UP);
    });

    it('should set refereeVendorId', () => {
      const referral = makeReferral();
      referral.attributeSignup(refereeVendorId);
      expect(referral.refereeVendorId).toBe(refereeVendorId);
    });

    it('should set signupDate', () => {
      const referral = makeReferral();
      referral.attributeSignup(refereeVendorId);
      expect(referral.signupDate).toBeInstanceOf(Date);
    });

    it('should set revenueShareUntil to 6 months after signup', () => {
      const before = new Date();
      const referral = makeReferral();
      referral.attributeSignup(refereeVendorId);
      const after = new Date();
      const expectedMonthsAhead = 6;
      const until = referral.revenueShareUntil!;
      // Should be between (before + 6mo) and (after + 6mo)
      const minExpected = new Date(before);
      minExpected.setMonth(minExpected.getMonth() + expectedMonthsAhead);
      const maxExpected = new Date(after);
      maxExpected.setMonth(maxExpected.getMonth() + expectedMonthsAhead);
      expect(until.getTime()).toBeGreaterThanOrEqual(minExpected.getTime() - 1000);
      expect(until.getTime()).toBeLessThanOrEqual(maxExpected.getTime() + 1000);
    });

    it('should block self-referral', () => {
      const referral = makeReferral();
      expect(() => referral.attributeSignup(referrerVendorId)).toThrow(
        'Self-referral is not allowed'
      );
    });

    it('should reject invalid transition (SIGNED_UP → PENDING)', () => {
      const referral = makeReferral();
      referral.attributeSignup(refereeVendorId);
      // Can't attribute again — no direct path, but transition guard should block
      expect(() => referral.attributeSignup(BigInt(3))).toThrow(/Cannot transition/);
    });
  });

  describe('qualify()', () => {
    it('should transition SIGNED_UP → QUALIFIED', () => {
      const referral = makeReferral();
      referral.attributeSignup(refereeVendorId);
      referral.qualify();
      expect(referral.status).toBe(ReferralVendorStatus.QUALIFIED);
    });

    it('should throw if called from PENDING', () => {
      const referral = makeReferral();
      expect(() => referral.qualify()).toThrow(/Cannot transition/);
    });
  });

  describe('markRewarded()', () => {
    it('should transition QUALIFIED → REWARDED', () => {
      const referral = makeReferral();
      referral.attributeSignup(refereeVendorId);
      referral.qualify();
      referral.markRewarded();
      expect(referral.status).toBe(ReferralVendorStatus.REWARDED);
    });

    it('should throw if already REWARDED (terminal)', () => {
      const referral = makeReferral();
      referral.attributeSignup(refereeVendorId);
      referral.qualify();
      referral.markRewarded();
      expect(() => referral.markRewarded()).toThrow(/Cannot transition/);
    });
  });

  describe('milestones', () => {
    it('should set milestone10At on first call', () => {
      const referral = makeReferral();
      referral.recordMilestone10();
      expect(referral.milestone10At).toBeInstanceOf(Date);
    });

    it('should throw if milestone10 already recorded', () => {
      const referral = makeReferral();
      referral.recordMilestone10();
      expect(() => referral.recordMilestone10()).toThrow('Milestone 10 already awarded');
    });

    it('should set milestone50At on first call', () => {
      const referral = makeReferral();
      referral.recordMilestone50();
      expect(referral.milestone50At).toBeInstanceOf(Date);
    });

    it('should throw if milestone50 already recorded', () => {
      const referral = makeReferral();
      referral.recordMilestone50();
      expect(() => referral.recordMilestone50()).toThrow('Milestone 50 already awarded');
    });

    it('should block milestone after clawback', () => {
      const referral = makeReferral();
      referral.markClawedBack();
      expect(() => referral.recordMilestone10()).toThrow(
        'Cannot award milestone — referral was clawed back'
      );
      expect(() => referral.recordMilestone50()).toThrow(
        'Cannot award milestone — referral was clawed back'
      );
    });
  });

  describe('markClawedBack()', () => {
    it('should set clawedBackAt', () => {
      const referral = makeReferral();
      referral.markClawedBack();
      expect(referral.clawedBackAt).toBeInstanceOf(Date);
    });

    it('should throw if already clawed back', () => {
      const referral = makeReferral();
      referral.markClawedBack();
      expect(() => referral.markClawedBack()).toThrow('Referral already clawed back');
    });

    it('should NOT change the status (status is independent of clawback)', () => {
      const referral = makeReferral();
      referral.attributeSignup(refereeVendorId);
      referral.markClawedBack();
      expect(referral.status).toBe(ReferralVendorStatus.SIGNED_UP);
    });
  });

  describe('isInRevenueShareWindow()', () => {
    it('should return false when revenueShareUntil is not set', () => {
      const referral = makeReferral();
      expect(referral.isInRevenueShareWindow()).toBe(false);
    });

    it('should return true when within 6-month window', () => {
      const referral = makeReferral();
      referral.attributeSignup(refereeVendorId);
      expect(referral.isInRevenueShareWindow(new Date())).toBe(true);
    });

    it('should return false when past 6-month window', () => {
      const referral = makeReferral();
      referral.attributeSignup(refereeVendorId);
      const farFuture = new Date();
      farFuture.setFullYear(farFuture.getFullYear() + 2);
      expect(referral.isInRevenueShareWindow(farFuture)).toBe(false);
    });
  });

  describe('isInClawbackWindow()', () => {
    it('should return false when signupDate not set', () => {
      const referral = makeReferral();
      expect(referral.isInClawbackWindow()).toBe(false);
    });

    it('should return true within 60 days', () => {
      const referral = makeReferral();
      referral.attributeSignup(refereeVendorId);
      const in30Days = new Date();
      in30Days.setDate(in30Days.getDate() + 30);
      expect(referral.isInClawbackWindow(in30Days)).toBe(true);
    });

    it('should return false beyond 60 days', () => {
      const referral = makeReferral();
      referral.attributeSignup(refereeVendorId);
      const after61Days = new Date();
      after61Days.setDate(after61Days.getDate() + 61);
      expect(referral.isInClawbackWindow(after61Days)).toBe(false);
    });
  });

  describe('equals()', () => {
    it('should return true for same id', () => {
      const r = VendorReferral.fromPersistence({
        id: BigInt(42),
        props: {
          referrerVendorId,
          refereeVendorId: null,
          referralCode: 'TEST1234',
          status: ReferralVendorStatus.PENDING,
          rewardType: VendorRewardType.CASH_CREDIT,
          rewardAmount: 500,
          refereeName: null,
          refereePhone: null,
          signupDate: null,
          firstCustomerDate: null,
          milestone10At: null,
          milestone50At: null,
          revenueShareUntil: null,
          clawedBackAt: null,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      });
      const r2 = VendorReferral.fromPersistence({
        id: BigInt(42),
        props: {
          referrerVendorId,
          refereeVendorId: null,
          referralCode: 'TEST1234',
          status: ReferralVendorStatus.PENDING,
          rewardType: VendorRewardType.CASH_CREDIT,
          rewardAmount: 500,
          refereeName: null,
          refereePhone: null,
          signupDate: null,
          firstCustomerDate: null,
          milestone10At: null,
          milestone50At: null,
          revenueShareUntil: null,
          clawedBackAt: null,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      });
      expect(r.equals(r2)).toBe(true);
    });
  });
});
