// Unit spec for the JWT trust-boundary check (passport validate()).
//
// This is the FIRST spec that exercises the real passport `validate()` path.
// Every existing integration spec constructs services directly and never touches
// passport, so there was no coverage of the enum-membership guard on `payload.role`.
//
// Level: UNIT (strategy-level), not integration. `validate()` is pure — it reads
// token claims and checks `role` against the `UserRole` enum, with no DB and no
// HTTP. So we construct `new JwtStrategy(stubConfig)` and call `.validate()` with
// hand-built payloads, the direct-construction analogue of the existing pattern,
// minus the database. Lands under the DB-free `test` target (jest.config.ts).
//
// These are BASELINE assertions: the guard is correct as designed — this pins
// intended behavior, not a bug.

import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { JwtStrategy } from './jwt.strategy';

// Minimal ConfigService stub: the strategy constructor only calls
// getOrThrow('JWT_ACCESS_SECRET') to seed passport-jwt's secret. Any non-empty
// string satisfies passport-jwt's option validation; no token is ever verified
// here because we invoke validate() directly.
const stubConfig = {
  getOrThrow: () => 'test-access-secret',
} as unknown as ConfigService;

const basePayload = {
  sub: 'user-123',
  email: 'inspector@example.com',
  tenantId: 'tenant-abc',
  customerId: null as string | null,
};

describe('JwtStrategy.validate — token trust boundary', () => {
  let strategy: JwtStrategy;

  beforeEach(() => {
    strategy = new JwtStrategy(stubConfig);
  });

  describe('valid role claim (baseline: resolves to AuthenticatedUser)', () => {
    it.each(Object.values(UserRole))(
      'accepts role=%s and maps claims onto the AuthenticatedUser',
      async (role) => {
        const user = await strategy.validate({ ...basePayload, role });

        expect(user).toEqual({
          id: 'user-123',
          userId: 'user-123',
          email: 'inspector@example.com',
          tenantId: 'tenant-abc',
          role,
          customerId: null,
        });
      },
    );

    it('passes customerId through when present (CUSTOMER claim)', async () => {
      const user = await strategy.validate({
        ...basePayload,
        role: UserRole.CUSTOMER,
        customerId: 'cust-777',
      });

      expect(user.customerId).toBe('cust-777');
      expect(user.role).toBe(UserRole.CUSTOMER);
    });
  });

  describe('invalid role claim (baseline: throws UnauthorizedException)', () => {
    it('rejects a role that is not a UserRole member', async () => {
      await expect(
        strategy.validate({ ...basePayload, role: 'SUPERADMIN' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects an empty-string role', async () => {
      await expect(
        strategy.validate({ ...basePayload, role: '' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a numeric role', async () => {
      await expect(
        strategy.validate({ ...basePayload, role: 42 }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a missing role claim', async () => {
      await expect(
        strategy.validate({ ...basePayload }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
