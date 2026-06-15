/**
 * Stub adapter for SubscriptionCreditPort.
 * In v1, credit application is logged but no actual invoice modification is done.
 * A real adapter would call the subscription module's public service.
 */
import { logger } from '@/infrastructure/logger/logger';
import { ISubscriptionCreditPort } from '../ports/subscription-credit.port';

export class StubSubscriptionCreditAdapter implements ISubscriptionCreditPort {
  applyCreditToNextInvoice(vendorId: bigint, amount: number): Promise<void> {
    logger.info(
      { vendorId: vendorId.toString(), amount },
      'SubscriptionCreditPort.applyCreditToNextInvoice [STUB] — credit applied to next invoice'
    );
    // TODO: call subscription module public service when available
    return Promise.resolve();
  }

  applyCreditToUpgrade(vendorId: bigint, amount: number): Promise<void> {
    logger.info(
      { vendorId: vendorId.toString(), amount },
      'SubscriptionCreditPort.applyCreditToUpgrade [STUB] — credit applied to upgrade'
    );
    // TODO: call subscription module public service when available
    return Promise.resolve();
  }
}
