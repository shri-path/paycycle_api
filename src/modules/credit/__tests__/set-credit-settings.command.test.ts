/**
 * Unit tests for SetCreditSettingsCommand — mocks all ports.
 */
import { SetCreditSettingsCommand } from '../commands/set-credit-settings/set-credit-settings.command';
import { ICreditSettingsRepository } from '../database/credit-settings.repository.port';
import { ICreditBalancePort } from '../ports/credit-balance.port';
import { ICreditCustomerPort, CustomerCreditRow } from '../ports/credit-customer.port';
import { IDeliveryControlPort } from '../ports/delivery-control.port';
import { CustomerCreditSettingsEntity } from '../domain/customer-credit-settings.entity';
import { CreditTypeEnum, CreditBreachActionEnum } from '../domain/credit.types';
import { NotFoundError } from '@/common/errors/app-error';
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

function makeSettingsEntity(creditType = CreditTypeEnum.NORMAL) {
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

describe('SetCreditSettingsCommand', () => {
  let settingsRepo: jest.Mocked<ICreditSettingsRepository>;
  let balancePort: jest.Mocked<ICreditBalancePort>;
  let customerPort: jest.Mocked<ICreditCustomerPort>;
  let deliveryControl: jest.Mocked<IDeliveryControlPort>;
  let logger: jest.Mocked<Logger>;
  let cmd: SetCreditSettingsCommand;

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
      setCreditLimit: jest.fn().mockResolvedValue(undefined),
    };
    deliveryControl = {
      pauseCustomer: jest.fn().mockResolvedValue(undefined),
    };
    logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<Logger>;

    cmd = new SetCreditSettingsCommand(
      settingsRepo,
      balancePort,
      customerPort,
      deliveryControl,
      logger
    );
  });

  it('should throw NotFoundError when customer does not belong to vendor', async () => {
    customerPort.getCustomer.mockResolvedValue(null);
    await expect(cmd.execute({ customerId: CUSTOMER_ID, vendorId: VENDOR_ID })).rejects.toThrow(
      NotFoundError
    );
  });

  it('should create new settings when none exist', async () => {
    settingsRepo.findByCustomer.mockResolvedValue(null);
    const result = await cmd.execute({
      customerId: CUSTOMER_ID,
      vendorId: VENDOR_ID,
      creditType: CreditTypeEnum.NORMAL,
      warningThreshold: 80,
    });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(settingsRepo.upsert).toHaveBeenCalledTimes(1);
    expect(result.creditType).toBe('normal');
    expect(result.warningThreshold).toBe(80);
  });

  it('should patch existing settings when a row exists', async () => {
    settingsRepo.findByCustomer.mockResolvedValue(makeSettingsEntity());
    const result = await cmd.execute({
      customerId: CUSTOMER_ID,
      vendorId: VENDOR_ID,
      warningThreshold: 60,
    });
    expect(result.warningThreshold).toBe(60);
  });

  it('should delegate credit limit write to customerPort', async () => {
    settingsRepo.findByCustomer.mockResolvedValue(makeSettingsEntity());
    await cmd.execute({
      customerId: CUSTOMER_ID,
      vendorId: VENDOR_ID,
      creditLimit: 8000,
    });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(customerPort.setCreditLimit).toHaveBeenCalledWith(CUSTOMER_ID, VENDOR_ID, 8000);
  });

  it('should return warning="limit_below_outstanding" when limit < outstanding', async () => {
    balancePort.getCustomerBalance.mockResolvedValue(3000);
    settingsRepo.findByCustomer.mockResolvedValue(makeSettingsEntity());
    const result = await cmd.execute({
      customerId: CUSTOMER_ID,
      vendorId: VENDOR_ID,
      creditLimit: 1000, // below balance of 3000
    });
    expect(result.warning).toBe('limit_below_outstanding');
  });

  it('should pause deliveries and set deliveriesPaused=true on breach with PAUSE action', async () => {
    balancePort.getCustomerBalance.mockResolvedValue(6000); // > creditLimit of 5000
    const entity = makeSettingsEntity();
    entity.setPolicy({ actionOnBreach: CreditBreachActionEnum.PAUSE });
    settingsRepo.findByCustomer.mockResolvedValue(entity);
    settingsRepo.upsert.mockImplementation((e) => Promise.resolve(e));

    const result = await cmd.execute({ customerId: CUSTOMER_ID, vendorId: VENDOR_ID });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(deliveryControl.pauseCustomer).toHaveBeenCalledWith(CUSTOMER_ID, VENDOR_ID);
    expect(result.deliveriesPaused).toBe(true);
  });

  it('should NOT pause deliveries for WARN action even if breached', async () => {
    balancePort.getCustomerBalance.mockResolvedValue(6000); // breached
    settingsRepo.findByCustomer.mockResolvedValue(makeSettingsEntity()); // WARN by default
    settingsRepo.upsert.mockImplementation((e) => Promise.resolve(e));

    const result = await cmd.execute({ customerId: CUSTOMER_ID, vendorId: VENDOR_ID });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(deliveryControl.pauseCustomer).not.toHaveBeenCalled();
    expect(result.deliveriesPaused).toBe(false);
  });

  it('should NOT breach for UNLIMITED even with very high balance', async () => {
    balancePort.getCustomerBalance.mockResolvedValue(999999);
    settingsRepo.findByCustomer.mockResolvedValue(makeSettingsEntity(CreditTypeEnum.UNLIMITED));
    settingsRepo.upsert.mockImplementation((e) => Promise.resolve(e));

    const result = await cmd.execute({ customerId: CUSTOMER_ID, vendorId: VENDOR_ID });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(deliveryControl.pauseCustomer).not.toHaveBeenCalled();
    expect(result.breached).toBe(false);
  });
});
