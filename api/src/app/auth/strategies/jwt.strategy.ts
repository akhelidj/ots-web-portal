import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { AuthenticatedUser } from '../authenticated-request';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * The claims this strategy reads out of a verified access token. `role` is
 * deliberately typed as the raw `string` claim, not `UserRole`: it is untrusted
 * until the enum-membership check in `validate()` confirms it.
 */
interface JwtPayload {
  sub: string;
  email: string;
  tenantId: string;
  role: string;
  customerId: string | null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    // `payload.role` is an untrusted token claim (typed as raw `string`), so
    // verify it is a real UserRole at the trust boundary rather than passing an
    // unvalidated string through as if it were the enum. `find` over the enum
    // values both rejects an invalid claim and yields a properly-typed UserRole
    // for the return — no `as` assertion on the untrusted value.
    const role = Object.values(UserRole).find((r) => r === payload.role);
    if (!role) {
      throw new UnauthorizedException('Invalid role claim in access token');
    }
    // The token is only proof of a past login. Re-read the account on every request so a
    // deactivated user is locked out immediately and a role / customer change takes effect
    // at once instead of when the token expires (one primary-key lookup).
    const account = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        email: true,
        tenantId: true,
        role: true,
        customerId: true,
        isActive: true,
      },
    });
    if (
      !account ||
      !account.isActive ||
      account.tenantId !== payload.tenantId
    ) {
      throw new UnauthorizedException('Account is no longer active');
    }
    return {
      id: payload.sub,
      userId: payload.sub,
      email: account.email,
      tenantId: account.tenantId,
      role: account.role,
      customerId: account.customerId,
    };
  }
}
