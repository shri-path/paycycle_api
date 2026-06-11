import { SupplyListEntity } from '../../domain/supply-list.entity';
import { CreateSupplyListProps, SupplyFrequency } from '../../domain/supply-list.types';

function baseProps(overrides: Partial<CreateSupplyListProps> = {}): CreateSupplyListProps {
  return {
    vendorId: 1n,
    name: 'Morning Milk',
    supplyType: 'Milk',
    unit: 'ltr',
    defaultQuantity: 1,
    ratePerUnit: 60,
    startTime: '06:30',
    frequency: SupplyFrequency.DAILY,
    scheduleDays: [],
    staffIds: [],
    primaryStaffId: null,
    createdByUserId: 9n,
    correlationId: 'cid',
    ...overrides,
  };
}

describe('SupplyListEntity.create', () => {
  it('creates a DAILY list and emits SupplyListCreatedEvent', () => {
    const entity = SupplyListEntity.create(baseProps());
    expect(entity.name).toBe('Morning Milk');
    const types = entity.getDomainEvents().map((e) => e.type);
    expect(types).toContain('SupplyListCreatedEvent');
  });

  it('WEEKLY requires schedule days', () => {
    expect(() =>
      SupplyListEntity.create(baseProps({ frequency: SupplyFrequency.WEEKLY, scheduleDays: [] }))
    ).toThrow();
    const ok = SupplyListEntity.create(
      baseProps({ frequency: SupplyFrequency.WEEKLY, scheduleDays: [1, 3, 5] })
    );
    expect(ok.getProps().schedule).toHaveLength(3);
  });

  it('rejects a primary not within staffIds via factory event flow', () => {
    const e = SupplyListEntity.create(baseProps({ staffIds: [10n, 11n], primaryStaffId: 10n }));
    const primaries = e.getProps().staff.filter((s) => s.isPrimary);
    expect(primaries).toHaveLength(1);
    expect(primaries[0]!.vendorUserId).toBe(10n);
  });

  it('emits a StaffAssignedToListEvent per staff and a PrimaryStaffChangedEvent', () => {
    const e = SupplyListEntity.create(baseProps({ staffIds: [10n, 11n], primaryStaffId: 11n }));
    const types = e.getDomainEvents().map((ev) => ev.type);
    expect(types.filter((t) => t === 'StaffAssignedToListEvent')).toHaveLength(2);
    expect(types).toContain('PrimaryStaffChangedEvent');
  });
});

describe('SupplyListEntity invariants', () => {
  it('enforces at most one primary on assignStaff', () => {
    const e = SupplyListEntity.create(baseProps({ staffIds: [10n], primaryStaffId: 10n }));
    e.assignStaff(11n, true, 9n, 'cid');
    const primaries = e.getProps().staff.filter((s) => s.isPrimary);
    expect(primaries).toHaveLength(1);
    expect(primaries[0]!.vendorUserId).toBe(11n);
  });

  it('rejects duplicate staff assignment', () => {
    const e = SupplyListEntity.create(baseProps({ staffIds: [10n] }));
    expect(() => e.assignStaff(10n, false, 9n, 'cid')).toThrow();
  });

  it('leaves no primary when the primary is unassigned', () => {
    const e = SupplyListEntity.create(baseProps({ staffIds: [10n], primaryStaffId: 10n }));
    e.unassignStaff(10n, 'cid');
    expect(e.getProps().staff).toHaveLength(0);
  });
});

describe('SupplyListEntity.archive', () => {
  it('sets isActive=false, deletedAt, emits archived event', () => {
    const e = SupplyListEntity.create(baseProps());
    e.clearDomainEvents();
    e.archive('cid');
    expect(e.isActive).toBe(false);
    expect(e.getProps().deletedAt).not.toBeNull();
    expect(e.getDomainEvents().map((ev) => ev.type)).toContain('SupplyListArchivedEvent');
  });
});

describe('SupplyListEntity.updateDetails', () => {
  it('changing frequency to WEEKLY without days throws', () => {
    const e = SupplyListEntity.create(baseProps());
    expect(() => e.updateDetails({ frequency: SupplyFrequency.WEEKLY }, 'cid')).toThrow();
  });
  it('updates price without touching schedule', () => {
    const e = SupplyListEntity.create(baseProps());
    e.updateDetails({ ratePerUnit: 70 }, 'cid');
    expect(e.ratePerUnit).toBe(70);
  });
});
