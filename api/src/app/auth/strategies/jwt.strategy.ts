import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { AuthenticatedUser } from '../authenticated-request';

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
  constructor(configService: ConfigService) {
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
    return {
      id: payload.sub,
      userId: payload.sub,
      email: payload.email,
      tenantId: payload.tenantId,
      role,
      customerId: payload.customerId,
    };
  }
}
