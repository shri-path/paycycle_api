/**
 * BulkInviteCommand — send WhatsApp invites to customers not yet on PayCycle.
 * USER DECISION: onPaycycle/isAppUser = skip customers already linked to a User
 * (i.e., customer.userId IS NOT NULL = already on PayCycle).
 */
import { Logger } from 'pino';
import { BadRequestError } from '@/common/errors/app-error';
import { IReferralRepository } from '../../database/referral.repository.port';
import { IInviteMessagePort } from '../../ports/invite-message.port';

export type BulkInviteTargetType = 'all_not_on_paycycle' | 'specific';

export interface BulkInviteInput {
  vendorId: bigint;
  targetType: BulkInviteTargetType;
  customerIds?: bigint[];
  messageLanguage?: string;
  customMessage?: string;
  autoResend?: boolean;
  maxAttempts?: number;
}

export interface BulkInviteResult {
  totalSent: number;
  delivered: number;
  failed: number;
  skippedAlreadyOnPaycycle: number;
}

export class BulkInviteCommand {
  constructor(
    private readonly repository: IReferralRepository,
    private readonly messagePort: IInviteMessagePort,
    private readonly logger: Logger
  ) {}

  async execute(input: BulkInviteInput): Promise<BulkInviteResult> {
    this.logger.info(
      { vendorId: input.vendorId.toString(), targetType: input.targetType },
      'BulkInviteCommand: sending bulk invites'
    );

    const autoResend = input.autoResend ?? true;
    const maxAttempts = input.maxAttempts ?? 3;
    const language = input.messageLanguage ?? 'hi';

    // Get vendor referral code for the message
    let referralCode = await this.repository.getVendorReferralCode(input.vendorId);
    if (!referralCode) {
      const vendorName = await this.repository.getVendorName(input.vendorId);
      referralCode = await this.generateCodeForVendor(input.vendorId, vendorName ?? 'Vendor');
    }
    const referralLink = `https://paycycle.app/join?ref=${referralCode}`;

    // Resolve target customers
    let targetCustomers: Array<{
      id: bigint;
      phone: string;
      userId: bigint | null;
      name: string | null;
    }>;

    if (input.targetType === 'specific') {
      if (!input.customerIds || input.customerIds.length === 0) {
        throw new BadRequestError('customerIds required when targetType is "specific"');
      }
      targetCustomers = await this.repository.findCustomersForInvite(input.vendorId, {
        customerIds: input.customerIds,
        excludeOnPaycycle: false,
      });
    } else {
      // all_not_on_paycycle: customers of this vendor where userId IS NULL
      targetCustomers = await this.repository.findCustomersForInvite(input.vendorId, {
        excludeOnPaycycle: true,
        limit: 200,
      });
    }

    // Filter: skip those already on PayCycle (userId IS NOT NULL)
    const eligible = targetCustomers.filter((c) => c.userId === null);
    const skippedAlreadyOnPaycycle = targetCustomers.length - eligible.length;

    if (eligible.length === 0) {
      return { totalSent: 0, delivered: 0, failed: 0, skippedAlreadyOnPaycycle };
    }

    // Persist invite rows
    await this.repository.insertInvites(
      eligible.map((c) => ({
        vendorId: input.vendorId,
        customerId: c.id,
        phone: c.phone,
        messageLanguage: language,
        autoResend,
        maxAttempts,
      }))
    );

    // Send messages (batch — stub in v1 always succeeds)
    let totalSent = 0;
    let delivered = 0;
    let failed = 0;

    for (const customer of eligible) {
      const body = input.customMessage
        ? `${input.customMessage} Join using code: ${referralCode} — ${referralLink}`
        : `Hi ${customer.name ?? 'there'}! Join PayCycle using code ${referralCode}: ${referralLink}`;

      const result = await this.messagePort.send({ phone: customer.phone, body, language });
      totalSent++;
      if (result.success) {
        delivered++;
      } else {
        failed++;
      }
    }

    return { totalSent, delivered, failed, skippedAlreadyOnPaycycle };
  }

  private async generateCodeForVendor(vendorId: bigint, vendorName: string): Promise<string> {
    const { ReferralCode } = await import('../../domain/value-objects/referral-code.vo');
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = ReferralCode.generate(vendorName).value;
      const isUnique = await this.repository.isReferralCodeUnique(code, vendorId);
      if (isUnique) {
        await this.repository.setVendorReferralCode(vendorId, code);
        return code;
      }
    }
    return `REF${String(vendorId).padStart(6, '0')}`;
  }
}
