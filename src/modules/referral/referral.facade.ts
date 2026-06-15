/**
 * ReferralFacade — inbound port for other modules.
 * Auth/signup calls processVendorSignup when a new vendor signs up with a referral code.
 * Customer module calls recordCustomerReferral.
 */
import { Logger } from 'pino';
import { IReferralRepository } from './database/referral.repository.port';
import {
  ReferralVendorStatus,
  VendorRewardType,
  ReferralRewardKind,
  CreditSourceType,
  REWARD_AMOUNTS,
} from './domain/vendor-referral.types';

export class ReferralFacade {
  constructor(
    private readonly repository: IReferralRepository,
    private readonly logger: Logger
  ) {}

  /**
   * Called from auth/signup flow when a new vendor provides a referral code.
   * Attributes the signup, transitions PENDING → SIGNED_UP, awards ₹500 signup bonus.
   * Swallows errors (signup must not fail due to referral issues).
   */
  async processVendorSignup(refereeVendorId: bigint, referralCode: string): Promise<void> {
    this.logger.info(
      { refereeVendorId: refereeVendorId.toString(), referralCode },
      'ReferralFacade.processVendorSignup: attributing signup'
    );

    try {
      // Find open referral with this code
      const referralRow = await this.repository.findVendorReferralByCode(
        referralCode,
        ReferralVendorStatus.PENDING
      );

      if (!referralRow) {
        this.logger.warn({ referralCode }, 'ReferralFacade: no PENDING referral found for code');
        return;
      }

      // Guard: already attributed
      const existingAttribution =
        await this.repository.findActiveReferralsByReferee(refereeVendorId);
      if (existingAttribution) {
        this.logger.warn(
          { refereeVendorId: refereeVendorId.toString() },
          'ReferralFacade: referee already attributed — swallowing (first-wins)'
        );
        return;
      }

      // Self-referral guard
      if (referralRow.referrerVendorId === refereeVendorId) {
        this.logger.warn(
          { refereeVendorId: refereeVendorId.toString() },
          'ReferralFacade: self-referral detected — swallowing'
        );
        return;
      }

      // Reconstruct domain entity and attribute
      const { VendorReferral } = await import('./domain/vendor-referral.entity');
      const referral = VendorReferral.fromPersistence({
        id: referralRow.id,
        props: {
          referrerVendorId: referralRow.referrerVendorId,
          refereeVendorId: referralRow.refereeVendorId,
          referralCode: referralRow.referralCode,
          status: referralRow.status,
          rewardType: referralRow.rewardType as VendorRewardType | null,
          rewardAmount: referralRow.rewardAmount,
          refereeName: referralRow.refereeName,
          refereePhone: referralRow.refereePhone,
          signupDate: referralRow.signupDate,
          firstCustomerDate: referralRow.firstCustomerDate,
          milestone10At: referralRow.milestone10At,
          milestone50At: referralRow.milestone50At,
          revenueShareUntil: referralRow.revenueShareUntil,
          clawedBackAt: referralRow.clawedBackAt,
        },
        createdAt: referralRow.createdAt,
        updatedAt: referralRow.updatedAt,
        deletedAt: referralRow.deletedAt,
      });

      referral.attributeSignup(refereeVendorId);

      await this.repository.transaction(async (tx) => {
        await this.repository.updateVendorReferral(referral, tx);
        await this.repository.earnCredit({
          vendorId: referralRow.referrerVendorId,
          amount: REWARD_AMOUNTS.SIGNUP_BONUS,
          rewardKind: ReferralRewardKind.SIGNUP_BONUS,
          sourceType: CreditSourceType.VENDOR_REFERRAL,
          sourceId: referralRow.id,
          description: `Signup bonus for referral of vendor #${refereeVendorId.toString()}`,
          tx,
        });
      });

      this.logger.info(
        {
          referralId: referralRow.id.toString(),
          referrerVendorId: referralRow.referrerVendorId.toString(),
        },
        'ReferralFacade.processVendorSignup: signup attributed, ₹500 bonus earned'
      );
    } catch (err) {
      // Swallow — signup must not fail due to referral issues
      this.logger.error(
        { err, refereeVendorId: refereeVendorId.toString(), referralCode },
        'ReferralFacade.processVendorSignup: error (swallowed)'
      );
    }
  }

  /**
   * Called from customer module when a customer refers another.
   * Records a customer referral row with ₹50 bill-discount reward.
   */
  async recordCustomerReferral(input: {
    vendorId: bigint;
    referrerCustomerId: bigint;
    refereeCustomerId: bigint;
  }): Promise<void> {
    this.logger.info({ ...input }, 'ReferralFacade.recordCustomerReferral');

    try {
      await this.repository.insertCustomerReferral({
        vendorId: input.vendorId,
        referrerCustomerId: input.referrerCustomerId,
        refereeCustomerId: input.refereeCustomerId,
        referrerRewardAmount: REWARD_AMOUNTS.CUSTOMER_REFERRAL,
      });
    } catch (err) {
      this.logger.error(
        { err, ...input },
        'ReferralFacade.recordCustomerReferral: error (swallowed)'
      );
    }
  }

  /**
   * Called when an invited customer signs up.
   * Updates invite status to SIGNED_UP.
   */
  async markInviteSignedUp(vendorId: bigint, phone: string): Promise<void> {
    this.logger.info({ vendorId: vendorId.toString(), phone }, 'ReferralFacade.markInviteSignedUp');
    try {
      // Find the invite and mark it — through the repository port
      const invite = await this.repository.findActiveInviteByPhone(vendorId, phone);
      if (invite) {
        await this.repository.updateInviteStatus(invite.id, 'SIGNED_UP');
      }
    } catch (err) {
      this.logger.error(
        { err, vendorId: vendorId.toString(), phone },
        'ReferralFacade.markInviteSignedUp: error (swallowed)'
      );
    }
  }
}
