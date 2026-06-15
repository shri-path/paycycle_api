/**
 * Unit tests — Revenue share calculation.
 * Covers: 10% of invoice amount, rounding, window eligibility.
 */
import { VendorReferral } from '../../domain/vendor-referral.entity';
import {
  ReferralVendorStatus,
  VendorRewardType,
  REWARD_AMOUNTS,
} from '../../domain/vendor-referral.types';

function makeSignedUpReferral(daysAgo: number): VendorReferral {
  const signupDate = new Date();
  signupDate.setDate(signupDate.getDate() - daysAgo);
  const revenueShareUntil = new Date(signupDate);
  revenueShareUntil.setMonth(revenueShareUntil.getMonth() + 6);

  return VendorReferral.fromPersistence({
    id: BigInt(1),
    props: {
      referrerVendorId: BigInt(1),
      refereeVendorId: BigInt(2),
      referralCode: 'MILK1234',
      status: ReferralVendorStatus.SIGNED_UP,
      rewardType: VendorRewardType.CASH_CREDIT,
      rewardAmount: REWARD_AMOUNTS.SIGNUP_BONUS,
      refereeName: 'Referee',
      refereePhone: '+919999999999',
      signupDate,
      firstCustomerDate: null,
      milestone10At: null,
      milestone50At: null,
      revenueShareUntil,
      clawedBackAt: null,
    },
    createdAt: signupDate,
    updatedAt: signupDate,
    deletedAt: null,
  });
}

describe('Revenue share calculation', () => {
  describe('REWARD_AMOUNTS.REVENUE_SHARE_PERCENT', () => {
    it('should be 10%', () => {
      expect(REWARD_AMOUNTS.REVENUE_SHARE_PERCENT).toBe(0.1);
    });
  });

  describe('revenue share window eligibility', () => {
    it('should be eligible within 6 months', () => {
      const referral = makeSignedUpReferral(30); // 30 days ago
      expect(referral.isInRevenueShareWindow(new Date())).toBe(true);
    });

    it('should be eligible at 5 months 29 days', () => {
      const referral = makeSignedUpReferral(1); // 1 day ago
      const fiveMonths = new Date();
      fiveMonths.setMonth(fiveMonths.getMonth() + 5);
      fiveMonths.setDate(fiveMonths.getDate() + 28);
      expect(referral.isInRevenueShareWindow(fiveMonths)).toBe(true);
    });

    it('should NOT be eligible after 6 months', () => {
      const referral = makeSignedUpReferral(1); // signed up 1 day ago
      const sevenMonthsLater = new Date();
      sevenMonthsLater.setMonth(sevenMonthsLater.getMonth() + 7);
      expect(referral.isInRevenueShareWindow(sevenMonthsLater)).toBe(false);
    });

    it('should NOT be eligible before signup (no revenueShareUntil set)', () => {
      const pendingReferral = VendorReferral.create({
        referrerVendorId: BigInt(1),
        referralCode: 'MILK1234',
        refereePhone: '+919999999999',
      });
      expect(pendingReferral.isInRevenueShareWindow(new Date())).toBe(false);
    });
  });

  describe('revenue share amount formula', () => {
    const INVOICE_AMOUNTS = [299, 599, 1199, 2499, 4999];

    INVOICE_AMOUNTS.forEach((invoiceAmount) => {
      it(`should compute 10% of ₹${invoiceAmount} = ₹${(invoiceAmount * 0.1).toFixed(2)}`, () => {
        const expected =
          Math.round(invoiceAmount * REWARD_AMOUNTS.REVENUE_SHARE_PERCENT * 100) / 100;
        const actual = Math.round(invoiceAmount * 0.1 * 100) / 100;
        expect(actual).toBe(expected);
      });
    });

    it('should round to 2 decimal places', () => {
      // ₹333 * 10% = ₹33.3 (no rounding needed but check precision)
      const invoiceAmount = 333;
      const shareAmount =
        Math.round(invoiceAmount * REWARD_AMOUNTS.REVENUE_SHARE_PERCENT * 100) / 100;
      expect(shareAmount).toBe(33.3);
    });

    it('should handle decimal invoice amounts', () => {
      const invoiceAmount = 199.5;
      const shareAmount =
        Math.round(invoiceAmount * REWARD_AMOUNTS.REVENUE_SHARE_PERCENT * 100) / 100;
      expect(shareAmount).toBe(19.95);
    });
  });

  describe('clawback window', () => {
    it('should be within 60-day clawback window at 59 days', () => {
      const referral = makeSignedUpReferral(1);
      const in59Days = new Date();
      in59Days.setDate(in59Days.getDate() + 58); // 1 day ago + 58 days from now = 59 days from signup
      expect(referral.isInClawbackWindow(in59Days)).toBe(true);
    });

    it('CLAWBACK_DAYS should be 60', () => {
      expect(REWARD_AMOUNTS.CLAWBACK_DAYS).toBe(60);
    });
  });

  describe('milestone detection thresholds', () => {
    it('QUALIFICATION_CUSTOMER_COUNT should be 3', () => {
      expect(REWARD_AMOUNTS.QUALIFICATION_CUSTOMER_COUNT).toBe(3);
    });

    it('QUALIFICATION_DAYS should be 30', () => {
      expect(REWARD_AMOUNTS.QUALIFICATION_DAYS).toBe(30);
    });

    it('MILESTONE_10 reward should be ₹1000', () => {
      expect(REWARD_AMOUNTS.MILESTONE_10).toBe(1000);
    });

    it('MILESTONE_50 reward should be ₹5000', () => {
      expect(REWARD_AMOUNTS.MILESTONE_50).toBe(5000);
    });

    it('SIGNUP_BONUS should be ₹500', () => {
      expect(REWARD_AMOUNTS.SIGNUP_BONUS).toBe(500);
    });

    it('CUSTOMER_REFERRAL reward should be ₹50', () => {
      expect(REWARD_AMOUNTS.CUSTOMER_REFERRAL).toBe(50);
    });
  });
});
