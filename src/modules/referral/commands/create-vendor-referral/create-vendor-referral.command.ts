/**
 * CreateVendorReferralCommand — create a vendor-to-vendor referral.
 * Rate-limited: max 10/day per vendor.
 * Lazily generates referral_code if not set on the vendor.
 */
import { Logger } from 'pino';
import { ConflictError, ForbiddenError, TooManyRequestsError } from '@/common/errors/app-error';
import { IReferralRepository } from '../../database/referral.repository.port';
import { VendorReferral } from '../../domain/vendor-referral.entity';
import { ReferralCode } from '../../domain/value-objects/referral-code.vo';
import { REWARD_AMOUNTS } from '../../domain/vendor-referral.types';

export interface CreateVendorReferralInput {
  referrerVendorId: bigint;
  vendorName: string;
  refereePhone: string;
  refereeName?: string;
}

export interface CreateVendorReferralResult {
  referralId: string;
  referralCode: string;
  referralLink: string;
  message: string;
  status: string;
  createdAt: string;
}

export class CreateVendorReferralCommand {
  constructor(
    private readonly repository: IReferralRepository,
    private readonly logger: Logger
  ) {}

  async execute(input: CreateVendorReferralInput): Promise<CreateVendorReferralResult> {
    this.logger.info(
      { vendorId: input.referrerVendorId.toString() },
      'CreateVendorReferralCommand: creating referral'
    );

    // Rate limit: max 10 referrals per day
    const todayCount = await this.repository.countTodayReferrals(input.referrerVendorId);
    if (todayCount >= REWARD_AMOUNTS.REFERRAL_DAILY_LIMIT) {
      this.logger.warn(
        { vendorId: input.referrerVendorId.toString(), count: todayCount },
        'Referral rate limit exceeded'
      );
      throw new TooManyRequestsError('Referral creation limit reached (10/day)');
    }

    // Self-referral check: if the referee's phone matches the referrer's vendor phone
    const referrerVendorName = await this.repository.getVendorName(input.referrerVendorId);
    const referrerPhone = await this.getReferrerPhone(input.referrerVendorId);
    if (referrerPhone && referrerPhone === input.refereePhone) {
      this.logger.warn({ vendorId: input.referrerVendorId.toString() }, 'Self-referral blocked');
      throw new ForbiddenError('You cannot refer yourself');
    }

    // Duplicate check: open referral to same phone
    const existingReferral = await this.repository.findVendorReferralByPhone(
      input.referrerVendorId,
      input.refereePhone
    );
    if (existingReferral) {
      this.logger.warn(
        { vendorId: input.referrerVendorId.toString(), phone: input.refereePhone },
        'Duplicate referral blocked'
      );
      throw new ConflictError('An open referral to this phone number already exists');
    }

    // Lazily generate referral code if needed
    let referralCode = await this.repository.getVendorReferralCode(input.referrerVendorId);
    if (!referralCode) {
      referralCode = await this.generateUniqueCode(input.vendorName, input.referrerVendorId);
      await this.repository.setVendorReferralCode(input.referrerVendorId, referralCode);
    }

    // Create domain entity
    const referral = VendorReferral.create({
      referrerVendorId: input.referrerVendorId,
      referralCode,
      refereeName: input.refereeName ?? null,
      refereePhone: input.refereePhone,
    });

    const row = await this.repository.insertVendorReferral(referral);

    const referralLink = `https://paycycle.app/join?ref=${referralCode}`;
    const message = this.buildInviteMessage(
      referrerVendorName ?? 'A vendor',
      referralCode,
      referralLink
    );

    return {
      referralId: row.id.toString(),
      referralCode,
      referralLink,
      message,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async generateUniqueCode(vendorName: string, vendorId: bigint): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = ReferralCode.generate(vendorName).value;
      const isUnique = await this.repository.isReferralCodeUnique(code, vendorId);
      if (isUnique) return code;
    }
    // Fallback: use vendorId-based code
    return `REF${String(vendorId).padStart(6, '0')}`;
  }

  private async getReferrerPhone(vendorId: bigint): Promise<string | null> {
    // Read vendor phone via prisma directly for self-referral guard
    // (acceptable — same bounded context)
    try {
      const { prisma } = await import('@/infrastructure/database/prisma.client');
      const v = await prisma.vendor.findUnique({
        where: { id: vendorId },
        select: { phone: true },
      });
      return v?.phone ?? null;
    } catch {
      return null;
    }
  }

  private buildInviteMessage(vendorName: string, code: string, link: string): string {
    return `Hello! ${vendorName} is inviting you to join PayCycle — the easiest app to manage your daily milk/newspaper/water delivery business. Use code ${code} when signing up to get started: ${link}`;
  }
}
