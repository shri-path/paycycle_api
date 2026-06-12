/**
 * Domain types for the Customer aggregate.
 * No framework imports — pure TypeScript.
 */

import type { CustomerNameVO } from './value-objects/customer-name.vo';
import type { CustomerPhoneVO } from './value-objects/customer-phone.vo';
import type { CreditLimitVO } from './value-objects/credit-limit.vo';
import type { PaymentScoreVO } from './value-objects/payment-score.vo';

export enum CustomerStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export enum PaymentMethod {
  CASH = 'CASH',
  ONLINE = 'ONLINE',
  UPI = 'UPI',
  OTHER = 'OTHER',
}

export interface CustomerProps {
  // Vendor relationship (via VendorCustomer join table — resolved at service layer)
  vendorId: bigint;
  // Profile
  name: CustomerNameVO;
  phone: CustomerPhoneVO;
  phoneCountryCode: string;
  email: string | null;
  address: string | null;
  area: string | null;
  languagePreference: string;
  // Financial
  creditLimit: CreditLimitVO;
  paymentScore: PaymentScoreVO;
  // Lifecycle
  customerSince: Date | null;
  status: CustomerStatus;
  createdByUserId: bigint | null;
  deletedAt: Date | null;
}

export interface CreateCustomerProps {
  vendorId: bigint;
  name: string;
  phone: string;
  phoneCountryCode?: string | undefined;
  email?: string | null | undefined;
  address?: string | null | undefined;
  area?: string | null | undefined;
  languagePreference?: string | undefined;
  creditLimit?: number | undefined;
  createdByUserId?: bigint | null | undefined;
}

export interface UpdateCustomerProps {
  name?: string | undefined;
  phone?: string | undefined;
  phoneCountryCode?: string | undefined;
  email?: string | null | undefined;
  address?: string | null | undefined;
  area?: string | null | undefined;
  languagePreference?: string | undefined;
  status?: CustomerStatus | undefined;
}

export interface PaymentProps {
  customerId: bigint;
  vendorId: bigint;
  amount: number;
  paymentDate: Date;
  paymentMethod: PaymentMethod;
  referenceNumber: string | null;
  recordedByUserId: bigint | null;
}
