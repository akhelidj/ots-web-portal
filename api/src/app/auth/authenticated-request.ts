import { Request } from 'express';

/**
 * Shape attached to `req.user` by the JWT strategy (`JwtStrategy.validate`)
 * after successful authentication.
 */
export interface AuthenticatedUser {
  id: string;
  userId: string;
  email: string;
  tenantId: string;
  role: string;
  customerId: string | null;
  /** Raw JWT subject; read defensively by some handlers. */
  sub?: string;
}

/** An Express request that has passed the JWT guard, so `user` is populated. */
export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}
