/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { SupplyFrequency } from '@prisma/client';
import { SupplyListMapper } from '../database/supply-list.mapper';
import { SubscriptionMapper } from '../database/subscription.mapper';
import { TodayStatsDto, MonthStatsDto } from '../supply-list.types';

const todayStats: TodayStatsDto = {
  date: '2025-01-01',
  delivered: 0,
  onLeave: 0,
  pending: 0,
  totalQuantity: 0,
};
const monthStats: MonthStatsDto = {
  month: '2025-01',
  daysCompleted: 0,
  totalQuantity: 0,
  revenue: 0,
};

function listRecord(overrides: any = {}): any {
  return {
    id: 100n,
    vendorId: 1n,
    name: 'Morning Milk',
    supplyType: 'Milk',
    unit: 'ltr',
    defaultQuantity: { toString: () => '1.000' },
    ratePerUnit: { toString: () => '60.00' },
    startTime: '06:30',
    frequency: SupplyFrequency.WEEKLY,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: new Date('2025-01-01'),
    staff: [],
    schedule: [{ dayOfWeek: 1, dayOfMonth: null }],
    ...overrides,
  };
}

describe('SupplyListMapper.toResponse', () => {
  it('whitelists fields and never leaks deletedAt', () => {
    const entity = SupplyListMapper.toDomain(listRecord({ deletedAt: null }));
    const dto = SupplyListMapper.toResponse(entity, {
      assignedStaff: [],
      customerCount: 3,
      todayStats,
      monthStats,
      includePhone: true,
    });
    expect(dto).not.toHaveProperty('deletedAt');
    expect(dto).not.toHaveProperty('vendorId');
    expect(dto.id).toBe('100');
    expect(dto.frequencyDays).toEqual([1]);
    expect(dto.customerCount).toBe(3);
  });

  it('derives status active/archived', () => {
    const active = SupplyListMapper.toDomain(listRecord({ isActive: true, deletedAt: null }));
    const archived = SupplyListMapper.toDomain(listRecord({ isActive: false, deletedAt: null }));
    expect(
      SupplyListMapper.toListResponse(active, { assignedStaff: [], customerCount: 0, todayStats })
        .status
    ).toBe('active');
    expect(
      SupplyListMapper.toListResponse(archived, { assignedStaff: [], customerCount: 0, todayStats })
        .status
    ).toBe('archived');
  });

  it('omits phoneNumber when includePhone is false', () => {
    const entity = SupplyListMapper.toDomain(listRecord({ deletedAt: null }));
    const dto = SupplyListMapper.toListResponse(entity, {
      assignedStaff: [{ vendorUserId: 5n, name: 'Asha', phone: '+91', isPrimary: true }],
      customerCount: 0,
      todayStats,
      includePhone: false,
    });
    expect(dto.assignedStaff[0]).not.toHaveProperty('phoneNumber');
  });
});

function subRecord(overrides: any = {}): any {
  return {
    id: 200n,
    vendorId: 1n,
    supplyListId: 100n,
    customerId: 3n,
    customQuantity: { toString: () => '2.000' },
    customRatePerUnit: null,
    startDate: new Date('2025-01-01'),
    endDate: null,
    isActive: true,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('SubscriptionMapper.toResponse', () => {
  it('computes amount override-first and caps otherLists at 5', () => {
    const entity = SubscriptionMapper.toDomain(subRecord());
    const dto = SubscriptionMapper.toResponse(
      entity,
      { defaultQuantity: 1, ratePerUnit: 60 },
      { name: 'Ramesh', phone: '+91', address: 'A' },
      ['L1', 'L2', 'L3', 'L4', 'L5', 'L6']
    );
    expect(dto.quantity).toBe(2);
    expect(dto.ratePerUnit).toBe(60);
    expect(dto.amount).toBe(120);
    expect(dto.isCustomQuantity).toBe(true);
    expect(dto.isCustomRate).toBe(false);
    expect(dto.otherLists).toHaveLength(5);
    expect(dto.otherListsCount).toBe(6);
    expect(dto).not.toHaveProperty('vendorId');
  });

  it('derives ended status from endDate', () => {
    const entity = SubscriptionMapper.toDomain(subRecord({ endDate: new Date(), isActive: false }));
    const dto = SubscriptionMapper.toResponse(
      entity,
      { defaultQuantity: 1, ratePerUnit: 60 },
      { name: null, phone: null, address: null },
      []
    );
    expect(dto.status).toBe('ended');
  });
});
