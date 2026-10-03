import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  SIGNATURE_REQUIRED,
  SignatureRequiredGuard,
} from './signature-required.guard';

function ctx(
  request: { user?: { id: string; role: UserRole }; method: string },
  exempt = false,
) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(exempt),
  } as unknown as Reflector;
  const count = jest.fn();
  const prisma = { userSignature: { count } } as unknown as PrismaService;
  const guard = new SignatureRequiredGuard(reflector, prisma);
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
  return { guard, context, count };
}

describe('SignatureRequiredGuard', () => {
  const inspector = { id: 'u1', role: UserRole.INSPECTOR };

  it('lets a public request through (no req.user)', async () => {
    const { guard, context, count } = ctx({ method: 'POST' });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(count).not.toHaveBeenCalled();
  });

  it.each([
    UserRole.ADMIN,
    UserRole.SUPERVISOR,
    UserRole.RECEIVER,
    UserRole.CUSTOMER,
  ])('never gates %s, without a DB hit', async (role) => {
    const { guard, context, count } = ctx({
      user: { id: 'x', role },
      method: 'POST',
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(count).not.toHaveBeenCalled();
  });

  it.each(['GET', 'HEAD', 'OPTIONS'])(
    'lets an unsigned inspector %s (read-only), without a DB hit',
    async (method) => {
      const { guard, context, count } = ctx({ user: inspector, method });
      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(count).not.toHaveBeenCalled();
    },
  );

  it.each(['POST', 'PATCH', 'PUT', 'DELETE'])(
    'blocks an unsigned inspector %s with a SIGNATURE_REQUIRED 403',
    async (method) => {
      const { guard, context, count } = ctx({ user: inspector, method });
      count.mockResolvedValue(0);
      const error = await guard.canActivate(context).catch((e) => e);
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        code: SIGNATURE_REQUIRED,
      });
    },
  );

  it('lets a signed inspector mutate', async () => {
    const { guard, context, count } = ctx({ user: inspector, method: 'POST' });
    count.mockResolvedValue(1);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(count).toHaveBeenCalledWith({ where: { userId: 'u1' } });
  });

  it('lets an unsigned inspector through an @AllowWithoutSignature route', async () => {
    const { guard, context, count } = ctx(
      { user: inspector, method: 'PUT' },
      true,
    );
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(count).not.toHaveBeenCalled();
  });
});
