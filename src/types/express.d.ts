declare global {
  namespace Express {
    interface Request {
      id?: string;
      user?: {
        userId: bigint;
        phone: string;
        vendorIds: bigint[];
      };
    }
  }
}

export {};
