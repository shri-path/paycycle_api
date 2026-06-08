import type { RoleContext } from '@/infrastructure/middlewares/rbac/role-context';

declare global {
  namespace Express {
    interface Request {
      id?: string;
      user?: {
        userId: bigint;
        phone: string;
        vendorIds: bigint[];
        /** US-002 (OQ-2): per-vendor role + permission claims from the access token. */
        vendors?: Array<{ vendorId: bigint; role: string; permissions: string[] }>;
      };
      /** US-002: resolved role context for the :vendorId on the route. */
      roleContext?: RoleContext;
    }
  }
}

export {};
