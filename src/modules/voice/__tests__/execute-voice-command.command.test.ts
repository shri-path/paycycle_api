/**
 * Unit tests for ExecuteVoiceCommandCommand.
 * Covers: mark_delivered, mark_leave, mark_all, unknown → 422, no delivery → 404.
 */
/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
import { ExecuteVoiceCommandCommand } from '../commands/execute-voice-command/execute-voice-command.command';
import { IDeliveryActionPort } from '../ports/delivery-action.port';
import { ICustomerLookupPort } from '../ports/customer-lookup.port';
import { IVoiceCommandLogRepository } from '../database/voice-command-log.repository.port';
import { VoiceCommandLogEntity } from '../domain/voice-command-log.entity';
import { UnprocessableVoiceCommandError } from '../domain/voice.errors';
import { NotFoundError } from '@/common/errors/app-error';
import { Logger } from '@/infrastructure/logger/logger';
import { RoleContext } from '@/infrastructure/middlewares/rbac/role-context';

const USER_ID = 1n;
const VENDOR_ID = 10n;
const SUPPLY_LIST_ID = 5n;
const CUSTOMER_ID = 100n;
const DELIVERY_ID = 200n;

const MOCK_ROLE_CTX: RoleContext = {
  role: 'owner',
  roleName: 'vendor_owner',
  vendorId: VENDOR_ID,
  userId: USER_ID,
  staffId: 1n,
  permissions: [],
};

describe('ExecuteVoiceCommandCommand', () => {
  let deliveryPort: jest.Mocked<IDeliveryActionPort>;
  let customerLookup: jest.Mocked<ICustomerLookupPort>;
  let logRepo: jest.Mocked<IVoiceCommandLogRepository>;
  let logger: jest.Mocked<Logger>;
  let cmd: ExecuteVoiceCommandCommand;

  beforeEach(() => {
    deliveryPort = {
      resolveDeliveryId: jest.fn().mockResolvedValue(DELIVERY_ID),
      markDelivery: jest.fn().mockResolvedValue(undefined),
      markAllPending: jest.fn().mockResolvedValue({ markedCount: 7 }),
    };
    customerLookup = {
      listRosterForList: jest.fn().mockResolvedValue([]),
      getCustomer: jest.fn().mockResolvedValue({ id: CUSTOMER_ID, name: 'Sharma' }),
    };
    logRepo = {
      insert: jest.fn().mockImplementation((entity: VoiceCommandLogEntity) =>
        Promise.resolve(
          VoiceCommandLogEntity.reconstitute({
            id: 99n,
            createdAt: new Date(),
            props: entity.getProps(),
          })
        )
      ),
      markExecuted: jest.fn().mockResolvedValue(undefined),
    };
    logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as jest.Mocked<Logger>;

    cmd = new ExecuteVoiceCommandCommand(deliveryPort, customerLookup, logRepo, logger);
  });

  describe('mark_delivered', () => {
    it('should mark delivery as DELIVERED and return result', async () => {
      const result = await cmd.execute({
        userId: USER_ID,
        vendorId: VENDOR_ID,
        roleCtx: MOCK_ROLE_CTX,
        interpretation: { action: 'mark_delivered', customerId: CUSTOMER_ID },
        supplyListId: SUPPLY_LIST_ID,
        serviceDate: '2024-06-15',
        logId: null,
      });

      expect(result.executed).toBe(true);
      expect(result.action).toBe('mark_delivered');
      expect(result.status).toBe('DELIVERED');
      expect(result.deliveryId).toBe(DELIVERY_ID.toString());
      expect(result.customerName).toBe('Sharma');
    });

    it('should call markDelivery with correct status', async () => {
      await cmd.execute({
        userId: USER_ID,
        vendorId: VENDOR_ID,
        roleCtx: MOCK_ROLE_CTX,
        interpretation: { action: 'mark_delivered', customerId: CUSTOMER_ID },
        supplyListId: SUPPLY_LIST_ID,
        logId: null,
      });

      expect(deliveryPort.markDelivery).toHaveBeenCalledWith(
        expect.objectContaining({ userId: USER_ID, vendorId: VENDOR_ID, roleCtx: MOCK_ROLE_CTX }),
        DELIVERY_ID,
        'DELIVERED'
      );
    });

    it('should call markExecuted on existing logId', async () => {
      const logId = 55n;
      await cmd.execute({
        userId: USER_ID,
        vendorId: VENDOR_ID,
        roleCtx: MOCK_ROLE_CTX,
        interpretation: { action: 'mark_delivered', customerId: CUSTOMER_ID },
        supplyListId: SUPPLY_LIST_ID,
        logId,
      });

      expect(logRepo.markExecuted).toHaveBeenCalledWith(
        logId,
        expect.objectContaining({ executionResult: expect.any(Object) })
      );
      expect(logRepo.insert).not.toHaveBeenCalled();
    });

    it('should insert new log when logId is null', async () => {
      await cmd.execute({
        userId: USER_ID,
        vendorId: VENDOR_ID,
        roleCtx: MOCK_ROLE_CTX,
        interpretation: { action: 'mark_delivered', customerId: CUSTOMER_ID },
        supplyListId: SUPPLY_LIST_ID,
        logId: null,
      });

      expect(logRepo.insert).toHaveBeenCalledTimes(1);
    });
  });

  describe('mark_leave', () => {
    it('should mark delivery as LEAVE', async () => {
      const result = await cmd.execute({
        userId: USER_ID,
        vendorId: VENDOR_ID,
        roleCtx: MOCK_ROLE_CTX,
        interpretation: { action: 'mark_leave', customerId: CUSTOMER_ID },
        supplyListId: SUPPLY_LIST_ID,
        logId: null,
      });

      expect(result.executed).toBe(true);
      expect(result.status).toBe('LEAVE');
    });

    it('should call markDelivery with LEAVE status', async () => {
      await cmd.execute({
        userId: USER_ID,
        vendorId: VENDOR_ID,
        roleCtx: MOCK_ROLE_CTX,
        interpretation: { action: 'mark_leave', customerId: CUSTOMER_ID },
        supplyListId: SUPPLY_LIST_ID,
        logId: null,
      });

      expect(deliveryPort.markDelivery).toHaveBeenCalledWith(
        expect.any(Object),
        DELIVERY_ID,
        'LEAVE'
      );
    });
  });

  describe('mark_all', () => {
    it('should mark all pending deliveries and return markedCount', async () => {
      const result = await cmd.execute({
        userId: USER_ID,
        vendorId: VENDOR_ID,
        roleCtx: MOCK_ROLE_CTX,
        interpretation: { action: 'mark_all' },
        supplyListId: SUPPLY_LIST_ID,
        logId: null,
      });

      expect(result.executed).toBe(true);
      expect(result.action).toBe('mark_all');
      expect(result.markedCount).toBe(7);
    });

    it('should call markAllPending with correct args', async () => {
      await cmd.execute({
        userId: USER_ID,
        vendorId: VENDOR_ID,
        roleCtx: MOCK_ROLE_CTX,
        interpretation: { action: 'mark_all' },
        supplyListId: SUPPLY_LIST_ID,
        serviceDate: '2024-06-15',
        logId: null,
      });

      expect(deliveryPort.markAllPending).toHaveBeenCalledWith(
        expect.objectContaining({ userId: USER_ID, vendorId: VENDOR_ID, roleCtx: MOCK_ROLE_CTX }),
        SUPPLY_LIST_ID,
        expect.any(Date)
      );
    });
  });

  describe('unknown action → 422', () => {
    it('should throw UnprocessableVoiceCommandError for UNKNOWN action', async () => {
      await expect(
        cmd.execute({
          userId: USER_ID,
          vendorId: VENDOR_ID,
          roleCtx: MOCK_ROLE_CTX,
          interpretation: { action: 'unknown' },
          supplyListId: SUPPLY_LIST_ID,
          logId: null,
        })
      ).rejects.toThrow(UnprocessableVoiceCommandError);
    });
  });

  describe('missing customerId → 422', () => {
    it('should throw UnprocessableVoiceCommandError when customerId missing for mark_delivered', async () => {
      await expect(
        cmd.execute({
          userId: USER_ID,
          vendorId: VENDOR_ID,
          roleCtx: MOCK_ROLE_CTX,
          interpretation: { action: 'mark_delivered', customerId: null },
          supplyListId: SUPPLY_LIST_ID,
          logId: null,
        })
      ).rejects.toThrow(UnprocessableVoiceCommandError);
    });
  });

  describe('no pending delivery → 404', () => {
    it('should throw NotFoundError when no delivery found for customer', async () => {
      deliveryPort.resolveDeliveryId.mockResolvedValue(null);

      await expect(
        cmd.execute({
          userId: USER_ID,
          vendorId: VENDOR_ID,
          roleCtx: MOCK_ROLE_CTX,
          interpretation: { action: 'mark_delivered', customerId: CUSTOMER_ID },
          supplyListId: SUPPLY_LIST_ID,
          logId: null,
        })
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('log failure does not break execution', () => {
    it('should succeed even when logRepo.markExecuted fails', async () => {
      logRepo.markExecuted.mockRejectedValue(new Error('DB error'));

      const result = await cmd.execute({
        userId: USER_ID,
        vendorId: VENDOR_ID,
        roleCtx: MOCK_ROLE_CTX,
        interpretation: { action: 'mark_delivered', customerId: CUSTOMER_ID },
        supplyListId: SUPPLY_LIST_ID,
        logId: 77n,
      });

      // Execution succeeded despite log failure
      expect(result.executed).toBe(true);
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('RBAC: real roleCtx is threaded to delivery port', () => {
    it('should pass the caller roleCtx to markDelivery (not a hardcoded owner ctx)', async () => {
      const staffCtx: RoleContext = {
        role: 'staff',
        roleName: 'vendor_staff',
        vendorId: VENDOR_ID,
        userId: USER_ID,
        staffId: 42n,
        permissions: ['mark_deliveries' as never],
      };

      await cmd.execute({
        userId: USER_ID,
        vendorId: VENDOR_ID,
        roleCtx: staffCtx,
        interpretation: { action: 'mark_delivered', customerId: CUSTOMER_ID },
        supplyListId: SUPPLY_LIST_ID,
        logId: null,
      });

      expect(deliveryPort.markDelivery).toHaveBeenCalledWith(
        expect.objectContaining({ roleCtx: staffCtx }),
        DELIVERY_ID,
        'DELIVERED'
      );
    });

    it('should pass the caller roleCtx to markAllPending (not a hardcoded owner ctx)', async () => {
      const staffCtx: RoleContext = {
        role: 'staff',
        roleName: 'vendor_staff',
        vendorId: VENDOR_ID,
        userId: USER_ID,
        staffId: 42n,
        permissions: ['mark_deliveries' as never],
      };

      await cmd.execute({
        userId: USER_ID,
        vendorId: VENDOR_ID,
        roleCtx: staffCtx,
        interpretation: { action: 'mark_all' },
        supplyListId: SUPPLY_LIST_ID,
        logId: null,
      });

      expect(deliveryPort.markAllPending).toHaveBeenCalledWith(
        expect.objectContaining({ roleCtx: staffCtx }),
        SUPPLY_LIST_ID,
        expect.any(Date)
      );
    });
  });
});
