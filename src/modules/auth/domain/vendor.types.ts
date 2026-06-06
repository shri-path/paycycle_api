export interface VendorProps {
  name: string;
  phone?: string | null;
  category?: string | null;
  referralCode?: string | null;
  referredByVendorId?: bigint | null;
  autoMarkEnabled: boolean;
  autoSendBills: boolean;
  autoSendTime?: string | null;
  upiId?: string | null;
  bankDetails?: unknown;
  deletedAt?: Date | null;
}

export interface CreateVendorProps {
  name: string;
}

export interface ReconstituteVendorData {
  id: bigint;
  createdAt: Date;
  updatedAt: Date;
  props: VendorProps;
}
