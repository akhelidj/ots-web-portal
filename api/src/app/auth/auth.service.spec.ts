import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { UserRole } from '@prisma/client';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { PASSWORD_HASH_ROUNDS } from './password';

const PASSWORD = 'correct-horse';

function makeService(user: Record<string, unknown> | null) {
  const prisma = {
    user: { findFirst: jest.fn(async () => user), update: jest.fn() },
    refreshToken: {
      findFirst: jest.fn(async () =>
        user
          ? {
              id: 'rt-1',
              userId: 'u1',
              revokedAt: null,
              expiresAt: new Date(Date.now() + 60_000),
              user,
            }
          : null,
      ),
      update: jest.fn(),
      create: jest.fn(),
    },
  } as unknown as PrismaService;
  const jwt = { sign: jest.fn(() => 'signed') } as unknown as JwtService;
  const config = { get: jest.fn() } as unknown as ConfigService;
  return { service: new AuthService(prisma, jwt, config), prisma };
}

async function account(isActive: boolean) {
  return {
    id: 'u1',
    email: 'a@b.co',
    tenantId: 't1',
    role: UserRole.INSPECTOR,
    customerId: null,
    isActive,
    passwordHash: await bcrypt.hash(PASSWORD, 4),
  };
}

describe('AuthService — deactivated accounts', () => {
  it('signs an active user in', async () => {
    const { service } = makeService(await account(true));
    const user = await service.validateUser('a@b.co', PASSWORD);
    expect(user?.id).toBe('u1');
    expect(user).not.toHaveProperty('passwordHash');
  });

  it('upgrades a weaker stored hash to the current work factor after a successful login', async () => {
    const { service, prisma } = makeService(await account(true)); // rounds=4 < 12
    await service.validateUser('a@b.co', PASSWORD);
    const update = prisma.user.update as jest.Mock;
    expect(update).toHaveBeenCalledTimes(1);
    const newHash = update.mock.calls[0][0].data.passwordHash as string;
    expect(bcrypt.getRounds(newHash)).toBe(PASSWORD_HASH_ROUNDS);
    expect(await bcrypt.compare(PASSWORD, newHash)).toBe(true);
  });

  it('does not rehash a hash that is already current', async () => {
    const current = {
      ...(await account(true)),
      passwordHash: await bcrypt.hash(PASSWORD, PASSWORD_HASH_ROUNDS),
    };
    const { service, prisma } = makeService(current);
    await service.validateUser('a@b.co', PASSWORD);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('refuses a deactivated user even with the right password', async () => {
    const { service } = makeService(await account(false));
    expect(await service.validateUser('a@b.co', PASSWORD)).toBeNull();
  });

  it('still refuses a wrong password', async () => {
    const { service } = makeService(await account(true));
    expect(await service.validateUser('a@b.co', 'nope')).toBeNull();
  });

  it('does not rotate a refresh token for a deactivated user', async () => {
    const { service, prisma } = makeService(await account(false));
    const token = crypto.randomBytes(8).toString('hex');
    await expect(service.refreshTokens(token)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(prisma.refreshToken.update).not.toHaveBeenCalled();
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
  });
});
