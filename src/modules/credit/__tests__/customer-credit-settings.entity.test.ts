/**
 * Unit tests for CustomerCreditSettingsEntity aggregate root.
 */
import { CustomerCreditSettingsEntity } from '../domain/customer-credit-settings.entity';
import { CreditTypeEnum, CreditBreachActionEnum } from '../domain/credit.types';
import { ArgumentInvalidException } from '@/common/errors/app-error';

const CUSTOMER_ID = 42n;

describe('CustomerCreditSettingsEntity', () => {
  // ── create() ──────────────────────────────────────────────────────────────

  describe('create()', () => {
    it('should apply defaults when only customerId is given', () => {
      const entity = CustomerCreditSettingsEntity.create({ customerId: CUSTOMER_ID });
      const props = entity.getProps();
      expect(props.customerId).toBe(CUSTOMER_ID);
      expect(props.creditType).toBe(CreditTypeEnum.NORMAL);
      expect(props.warningThresholdPercent).toBe(90);
      expect(props.actionOnBreach).toBe(CreditBreachActionEnum.WARN);
      expect(props.minimumBalanceWarning).toBeNull();
    });

    it('should accept all fields when supplied', () => {
      const entity = CustomerCreditSettingsEntity.create({
        customerId: CUSTOMER_ID,
        creditType: CreditTypeEnum.PREPAID,
        warningThresholdPercent: 75,
        actionOnBreach: CreditBreachActionEnum.PAUSE,
        minimumBalanceWarning: 500,
      });
      const props = entity.getProps();
      expect(props.creditType).toBe(CreditTypeEnum.PREPAID);
      expect(props.warningThresholdPercent).toBe(75);
      expect(props.actionOnBreach).toBe(CreditBreachActionEnum.PAUSE);
      expect(props.minimumBalanceWarning).toBe(500);
    });

    it('should force actionOnBreach=WARN when creditType=UNLIMITED', () => {
      const entity = CustomerCreditSettingsEntity.create({
        customerId: CUSTOMER_ID,
        creditType: CreditTypeEnum.UNLIMITED,
        actionOnBreach: CreditBreachActionEnum.BLOCK,
      });
      // Invariant 4: UNLIMITED forces WARN
      expect(entity.getProps().actionOnBreach).toBe(CreditBreachActionEnum.WARN);
    });

    it('should throw when warningThresholdPercent is out of range', () => {
      expect(() =>
        CustomerCreditSettingsEntity.create({
          customerId: CUSTOMER_ID,
          warningThresholdPercent: 101,
        })
      ).toThrow(ArgumentInvalidException);

      expect(() =>
        CustomerCreditSettingsEntity.create({
          customerId: CUSTOMER_ID,
          warningThresholdPercent: -1,
        })
      ).toThrow(ArgumentInvalidException);
    });

    it('should throw when PREPAID with negative minimumBalanceWarning', () => {
      expect(() =>
        CustomerCreditSettingsEntity.create({
          customerId: CUSTOMER_ID,
          creditType: CreditTypeEnum.PREPAID,
          minimumBalanceWarning: -1,
        })
      ).toThrow(ArgumentInvalidException);
    });

    it('should accept minimumBalanceWarning=0 for PREPAID', () => {
      const entity = CustomerCreditSettingsEntity.create({
        customerId: CUSTOMER_ID,
        creditType: CreditTypeEnum.PREPAID,
        minimumBalanceWarning: 0,
      });
      expect(entity.getProps().minimumBalanceWarning).toBe(0);
    });

    it('should start with id=0n (not yet persisted)', () => {
      const entity = CustomerCreditSettingsEntity.create({ customerId: CUSTOMER_ID });
      expect(entity.id).toBe(0n);
    });
  });

  // ── reconstitute() ───────────────────────────────────────────────────────

  describe('reconstitute()', () => {
    it('should reconstitute from persisted data', () => {
      const now = new Date();
      const entity = CustomerCreditSettingsEntity.reconstitute({
        id: 10n,
        createdAt: now,
        updatedAt: now,
        props: {
          customerId: CUSTOMER_ID,
          creditType: CreditTypeEnum.PREPAID,
          warningThresholdPercent: 80,
          actionOnBreach: CreditBreachActionEnum.PAUSE,
          minimumBalanceWarning: 200,
        },
      });
      const props = entity.getProps();
      expect(entity.id).toBe(10n);
      expect(props.creditType).toBe(CreditTypeEnum.PREPAID);
      expect(props.minimumBalanceWarning).toBe(200);
    });

    it('should throw when reconstituting invalid data', () => {
      expect(() =>
        CustomerCreditSettingsEntity.reconstitute({
          id: 1n,
          createdAt: new Date(),
          updatedAt: new Date(),
          props: {
            customerId: CUSTOMER_ID,
            creditType: CreditTypeEnum.UNLIMITED,
            warningThresholdPercent: 90,
            actionOnBreach: CreditBreachActionEnum.BLOCK, // violates invariant 4
            minimumBalanceWarning: null,
          },
        })
      ).toThrow(ArgumentInvalidException);
    });
  });

  // ── getProps() ────────────────────────────────────────────────────────────

  describe('getProps()', () => {
    it('should return a frozen object', () => {
      const entity = CustomerCreditSettingsEntity.create({ customerId: CUSTOMER_ID });
      const props = entity.getProps();
      expect(Object.isFrozen(props)).toBe(true);
    });
  });

  // ── equals() ─────────────────────────────────────────────────────────────

  describe('equals()', () => {
    it('should be equal when IDs match', () => {
      const now = new Date();
      const base = {
        id: 5n,
        createdAt: now,
        updatedAt: now,
        props: {
          customerId: CUSTOMER_ID,
          creditType: CreditTypeEnum.NORMAL,
          warningThresholdPercent: 90,
          actionOnBreach: CreditBreachActionEnum.WARN,
          minimumBalanceWarning: null,
        },
      };
      const a = CustomerCreditSettingsEntity.reconstitute(base);
      const b = CustomerCreditSettingsEntity.reconstitute(base);
      expect(a.equals(b)).toBe(true);
    });

    it('should not be equal when IDs differ', () => {
      const now = new Date();
      const props = {
        customerId: CUSTOMER_ID,
        creditType: CreditTypeEnum.NORMAL,
        warningThresholdPercent: 90,
        actionOnBreach: CreditBreachActionEnum.WARN,
        minimumBalanceWarning: null,
      };
      const a = CustomerCreditSettingsEntity.reconstitute({
        id: 1n,
        createdAt: now,
        updatedAt: now,
        props,
      });
      const b = CustomerCreditSettingsEntity.reconstitute({
        id: 2n,
        createdAt: now,
        updatedAt: now,
        props,
      });
      expect(a.equals(b)).toBe(false);
    });

    it('should return false when other is undefined', () => {
      const entity = CustomerCreditSettingsEntity.create({ customerId: CUSTOMER_ID });
      expect(entity.equals(undefined)).toBe(false);
    });
  });

  // ── setPolicy() ──────────────────────────────────────────────────────────

  describe('setPolicy()', () => {
    it('should update a single field', () => {
      const entity = CustomerCreditSettingsEntity.create({ customerId: CUSTOMER_ID });
      entity.setPolicy({ warningThresholdPercent: 50 });
      expect(entity.getProps().warningThresholdPercent).toBe(50);
    });

    it('should force actionOnBreach=WARN when switching to UNLIMITED', () => {
      const entity = CustomerCreditSettingsEntity.create({
        customerId: CUSTOMER_ID,
        actionOnBreach: CreditBreachActionEnum.BLOCK,
      });
      entity.setPolicy({ creditType: CreditTypeEnum.UNLIMITED });
      expect(entity.getProps().actionOnBreach).toBe(CreditBreachActionEnum.WARN);
    });

    it('should throw when patch produces invalid state', () => {
      const entity = CustomerCreditSettingsEntity.create({ customerId: CUSTOMER_ID });
      expect(() => entity.setPolicy({ warningThresholdPercent: 200 })).toThrow(
        ArgumentInvalidException
      );
    });

    it('should update updatedAt on each call', () => {
      const entity = CustomerCreditSettingsEntity.create({ customerId: CUSTOMER_ID });
      const before = entity.updatedAt;
      entity.setPolicy({ warningThresholdPercent: 60 });
      expect(entity.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });
  });

  // ── enablePrepaid() ───────────────────────────────────────────────────────

  describe('enablePrepaid()', () => {
    it('should flip creditType to PREPAID', () => {
      const entity = CustomerCreditSettingsEntity.create({ customerId: CUSTOMER_ID });
      entity.enablePrepaid(100);
      expect(entity.getProps().creditType).toBe(CreditTypeEnum.PREPAID);
      expect(entity.getProps().minimumBalanceWarning).toBe(100);
    });

    it('should accept null minimumBalanceWarning', () => {
      const entity = CustomerCreditSettingsEntity.create({ customerId: CUSTOMER_ID });
      entity.enablePrepaid(null);
      expect(entity.getProps().minimumBalanceWarning).toBeNull();
    });
  });

  // ── evaluateBreach() ──────────────────────────────────────────────────────

  describe('evaluateBreach()', () => {
    it('should report breached when balance > creditLimit for NORMAL', () => {
      const entity = CustomerCreditSettingsEntity.create({
        customerId: CUSTOMER_ID,
        creditType: CreditTypeEnum.NORMAL,
        warningThresholdPercent: 80,
      });
      const result = entity.evaluateBreach(1200, 1000);
      expect(result.breached).toBe(true);
      expect(result.utilizationPercent).toBe(120);
      expect(result.nearLimit).toBe(true);
    });

    it('should report nearLimit when utilization >= threshold without breach', () => {
      const entity = CustomerCreditSettingsEntity.create({
        customerId: CUSTOMER_ID,
        warningThresholdPercent: 80,
      });
      const result = entity.evaluateBreach(900, 1000);
      expect(result.breached).toBe(false);
      expect(result.nearLimit).toBe(true);
      expect(result.utilizationPercent).toBe(90);
    });

    it('should never breach for UNLIMITED', () => {
      const entity = CustomerCreditSettingsEntity.create({
        customerId: CUSTOMER_ID,
        creditType: CreditTypeEnum.UNLIMITED,
      });
      const result = entity.evaluateBreach(999999, 100);
      expect(result.breached).toBe(false);
      expect(result.nearLimit).toBe(false);
      expect(result.utilizationPercent).toBe(0);
    });

    it('should handle zero creditLimit without division error', () => {
      const entity = CustomerCreditSettingsEntity.create({ customerId: CUSTOMER_ID });
      const result = entity.evaluateBreach(500, 0);
      expect(result.utilizationPercent).toBe(0);
    });
  });
});
