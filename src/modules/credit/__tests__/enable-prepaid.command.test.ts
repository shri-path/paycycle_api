/**
 * Unit tests for EnablePrepaidCommand — mocks all ports.
 */
import { EnablePrepaidCommand } from '../commands/enable-prepaid/enable-prepaid.command';
import { ICreditSettingsRepository } from '../database/credit-settings.repository.port';
import { ICreditBalancePort } from '../ports/credit-balance.port';
import { ICreditCustomerPort, CustomerCreditRow } from '../ports/credit-customer.port';
import { CustomerCreditSettingsEntity } from '../domain/customer-credit-settings.entity';
import { CreditTypeEnum, CreditBreachActionEnum } from '../domain/credit.types';
import { NotFoundError } from '@/common/errors/app-error';
import { InvalidCreditTransitionError } from '../domain/credit.errors';
import { Logger } from '@/infrastructure/logger/logger';

const VENDOR_ID = 1n;
const CUSTOMER_ID = 2n;

const mockCustomer: CustomerCreditRow = {
  id: CUSTOMER_ID,
  name: 'Test Customer',
  phone: '+919999999999',
  creditLimit: 5000,
  paymentScore: 80,
  status: 'ACTIVE',
  lastPaymentDate: null,
};

function makeEntity(creditType = CreditTypeEnum.NORMAL) {
  return CustomerCreditSettingsEntity.reconstitute({
    id: 10n,
    createdAt: new Date(),
    updatedAt: new Date(),
    props: {
      customerId: CUSTOMER_ID,
      creditType,
      warningThresholdPercent: 90,
      actionOnBreach: CreditBreachActionEnum.WARN,
      minimumBalanceWarning: null,
    },
  });
}

describe('EnablePrepaidCommand', () => {
  let settingsRepo: jest.Mocked<ICreditSettingsRepository>;
  let balancePort: jest.Mocked<ICreditBalancePort>;
  let customerPort: jest.Mocked<ICreditCustomerPort>;
  let logger: jest.Mocked<Logger>;
  let cmd: EnablePrepaidCommand;

  beforeEach(() => {
    settingsRepo = {
      findByCustomer: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockImplementation((e) => Promise.resolve(e)),
    };
    balancePort = {
      getBulkBalances: jest.fn(),
      getCustomerBalance: jest.fn().mockResolvedValue(0),
      getOldestUnpaidServiceDate: jest.fn(),
      getMonthlyBilled: jest.fn(),
      getMonthlyCollected: jest.fn(),
      getPaymentModeBreakdown: jest.fn(),
      getCollectionTrend: jest.fn(),
      getTopPayers: jest.fn(),
    };
    customerPort = {
      listCustomersWithCredit: jest.fn(),
      getCustomer: jest.fn().mockResolvedValue(mockCustomer),
      setCreditLimit: jest.fn(),
    };
    logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<Logger>;

    cmd = new EnablePrepaidCommand(settingsRepo, balancePort, customerPort, logger);
  });

  it('should throw NotFoundError for unknown customer', async () => {
    customerPort.getCustomer.mockResolvedValue(null);
    await expect(
      cmd.execute({ customerId: CUSTOMER_ID, vendorId: VENDOR_ID, clearOutstandingFirst: false })
    ).rejects.toThrow(NotFoundError);
  });

  it('should throw InvalidCreditTransitionError when already prepaid', async () => {
    settingsRepo.findByCustomer.mockResolvedValue(makeEntity(CreditTypeEnum.PREPAID));
    await expect(
      cmd.execute({ customerId: CUSTOMER_ID, vendorId: VENDOR_ID, clearOutstandingFirst: false })
    ).rejects.toThrow(InvalidCreditTransitionError);
  });

  it('should switch to prepaid when clearOutstandingFirst=false regardless of balance', async () => {
    balancePort.getCustomerBalance.mockResolvedValue(1000); // has outstanding
    settingsRepo.findByCustomer.mockResolvedValue(makeEntity());

    const result = await cmd.execute({
      customerId: CUSTOMER_ID,
      vendorId: VENDOR_ID,
      clearOutstandingFirst: false,
      minimumBalanceWarning: 200,
    });

    expect(result.switched).toBe(true);
    if (result.switched) {
      expect(result.creditType).toBe('prepaid');
      expect(result.clearOutstandingRequired).toBe(false);
    }
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(settingsRepo.upsert).toHaveBeenCalledTimes(1);
  });

  it('should return clearOutstandingRequired=true when clearOutstandingFirst=true and balance > 0', async () => {
    balancePort.getCustomerBalance.mockResolvedValue(2500);
    settingsRepo.findByCustomer.mockResolvedValue(makeEntity());

    const result = await cmd.execute({
      customerId: CUSTOMER_ID,
      vendorId: VENDOR_ID,
      clearOutstandingFirst: true,
    });

    expect(result.switched).toBe(false);
    if (!result.switched) {
      expect(result.clearOutstandingRequired).toBe(true);
      expect(result.outstanding).toBe(2500);
    }
    // Must NOT have persisted a switch
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(settingsRepo.upsert).not.toHaveBeenCalled();
  });

  it('should switch immediately when clearOutstandingFirst=true and balance = 0', async () => {
    balancePort.getCustomerBalance.mockResolvedValue(0);
    settingsRepo.findByCustomer.mockResolvedValue(makeEntity());

    const result = await cmd.execute({
      customerId: CUSTOMER_ID,
      vendorId: VENDOR_ID,
      clearOutstandingFirst: true,
    });

    expect(result.switched).toBe(true);
  });

  it('should create new settings entity when none exist before switching', async () => {
    settingsRepo.findByCustomer.mockResolvedValue(null); // no settings yet
    balancePort.getCustomerBalance.mockResolvedValue(0);

    const result = await cmd.execute({
      customerId: CUSTOMER_ID,
      vendorId: VENDOR_ID,
      clearOutstandingFirst: false,
      minimumBalanceWarning: 100,
    });

    expect(result.switched).toBe(true);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(settingsRepo.upsert).toHaveBeenCalledTimes(1);
  });
});
