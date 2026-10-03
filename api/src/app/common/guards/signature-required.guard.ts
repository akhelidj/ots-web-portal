import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedRequest } from '../../auth/authenticated-request';
import { ALLOW_WITHOUT_SIGNATURE_KEY } from '../decorators/allow-without-signature.decorator';

const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Machine-readable code on the 403 body so the portal can tell this apart from RBAC denials. */
export const SIGNATURE_REQUIRED = 'SIGNATURE_REQUIRED';

/**
 * Global gate: an INSPECTOR account with no registered signature cannot perform any
 * state-changing call. Reads stay open (the portal blurs the UI and shows a "register
 * your signature" prompt). Registered as an APP_GUARD AFTER `DefaultDenyGuard`, so by
 * the time it runs `req.user` is populated for every non-public route.
 *
 * Default-closed on purpose: a future inspector-reachable mutation is gated without
 * anyone remembering to opt in. The only exemptions are the explicit
 * `@AllowWithoutSignature()` routes.
 *
 * Cost: one indexed `count` per INSPECTOR mutation; other roles and all reads
 * short-circuit before touching the DB.
 */
@Injectable()
export class SignatureRequiredGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Partial<AuthenticatedRequest>>();

    // Public routes never populate `req.user`; nothing to gate.
    const user = request.user;
    if (!user || user.role !== UserRole.INSPECTOR) {
      return true;
    }
    if (READ_ONLY_METHODS.has(String(request.method).toUpperCase())) {
      return true;
    }

    const exempt = this.reflector.getAllAndOverride<boolean>(
      ALLOW_WITHOUT_SIGNATURE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (exempt) {
      return true;
    }

    const count = await this.prisma.userSignature.count({
      where: { userId: user.id },
    });
    if (count === 0) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        code: SIGNATURE_REQUIRED,
        message:
          'A signature must be registered on your account before you can perform this action.',
      });
    }
    return true;
  }
}
