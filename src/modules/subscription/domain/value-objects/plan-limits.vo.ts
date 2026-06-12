/**
 * PlanLimits value object.
 * maxCustomers/maxStaff/maxSupplyLists: integer >= 0; 0 = unlimited (canonical).
 */
import { ArgumentInvalidException } from '@/common/errors/app-error';

export type LimitResource = 'customers' | 'staff' | 'supplyLists';

export class PlanLimitsVO {
  private constructor(
    private readonly _maxCustomers: number,
    private readonly _maxStaff: number,
    private readonly _maxSupplyLists: number
  ) {}

  static create(maxCustomers: number, maxStaff: number, maxSupplyLists: number): PlanLimitsVO {
    if (!Number.isInteger(maxCustomers) || maxCustomers < 0) {
      throw new ArgumentInvalidException('maxCustomers must be a non-negative integer');
    }
    if (!Number.isInteger(maxStaff) || maxStaff < 0) {
      throw new ArgumentInvalidException('maxStaff must be a non-negative integer');
    }
    if (!Number.isInteger(maxSupplyLists) || maxSupplyLists < 0) {
      throw new ArgumentInvalidException('maxSupplyLists must be a non-negative integer');
    }
    return new PlanLimitsVO(maxCustomers, maxStaff, maxSupplyLists);
  }

  /** 0 = unlimited for the given resource */
  isUnlimited(resource: LimitResource): boolean {
    return this.max(resource) === 0;
  }

  /** Returns true if the given count is below the limit (or unlimited). */
  allows(resource: LimitResource, currentCount: number): boolean {
    if (this.isUnlimited(resource)) return true;
    return currentCount < this.max(resource);
  }

  max(resource: LimitResource): number {
    switch (resource) {
      case 'customers':
        return this._maxCustomers;
      case 'staff':
        return this._maxStaff;
      case 'supplyLists':
        return this._maxSupplyLists;
    }
  }

  get maxCustomers(): number {
    return this._maxCustomers;
  }

  get maxStaff(): number {
    return this._maxStaff;
  }

  get maxSupplyLists(): number {
    return this._maxSupplyLists;
  }
}
