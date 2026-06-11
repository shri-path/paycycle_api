/** Delivery frequency of a supply list. Domain-native enum (no framework coupling). */
export enum SupplyFrequency {
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY',
}

/** A staff assignment owned within the SupplyList aggregate. */
export interface StaffAssignmentProps {
  /** vendor_users.id (membership id). */
  vendorUserId: bigint;
  isPrimary: boolean;
  assignedByUserId: bigint | null;
  assignedAt: Date;
}

/** A schedule rule owned within the SupplyList aggregate. */
export interface ScheduleRuleProps {
  dayOfWeek: number | null;
  dayOfMonth: number | null;
}

/** Internal aggregate state for a SupplyList. */
export interface SupplyListProps {
  vendorId: bigint;
  name: string;
  supplyType: string | null;
  unit: string;
  defaultQuantity: number | null;
  ratePerUnit: number | null;
  startTime: string | null; // HH:mm
  frequency: SupplyFrequency;
  isActive: boolean;
  deletedAt: Date | null;
  staff: StaffAssignmentProps[];
  schedule: ScheduleRuleProps[];
}

/** Factory input for creating a new SupplyList. */
export interface CreateSupplyListProps {
  vendorId: bigint;
  name: string;
  supplyType: string | null;
  unit: string;
  defaultQuantity: number | null;
  ratePerUnit: number | null;
  startTime: string | null;
  frequency: SupplyFrequency;
  /** WEEKLY → 1..7, MONTHLY → 1..31, DAILY → []. */
  scheduleDays: number[];
  /** Staff membership ids to assign on creation. */
  staffIds: bigint[];
  /** Must be within staffIds when present. */
  primaryStaffId: bigint | null;
  createdByUserId: bigint | null;
  correlationId: string;
}

/** Reconstitution input from persistence. */
export interface ReconstituteSupplyListData {
  id: bigint;
  createdAt: Date;
  updatedAt: Date;
  props: SupplyListProps;
}

/** Patch applied by updateDetails — every field optional. */
export interface UpdateSupplyListPatch {
  name?: string;
  supplyType?: string | null;
  unit?: string;
  defaultQuantity?: number | null;
  ratePerUnit?: number | null;
  startTime?: string | null;
  frequency?: SupplyFrequency;
  scheduleDays?: number[];
}
