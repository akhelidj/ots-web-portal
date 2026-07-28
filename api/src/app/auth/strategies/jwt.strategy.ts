import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { AuthenticatedUser } from '../authenticated-request';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: any): Promise<AuthenticatedUser> {
    // `payload` is an untrusted token claim (passport-jwt types it `any`), so
    // verify `role` is a real UserRole at the trust boundary rather than passing
    // an unvalidated string through as if it were the enum.
    if (!Object.values(UserRole).includes(payload.role)) {
      throw new UnauthorizedException('Invalid role claim in access token');
    }
    return {
      id: payload.sub,
      userId: payload.sub,
      email: payload.email,
      tenantId: payload.tenantId,
      role: payload.role,
      customerId: payload.customerId,
    };
  }
}
