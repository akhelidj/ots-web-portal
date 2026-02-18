import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';

@Injectable()
export class DefaultDenyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    
    // Whitelist /health endpoint
    if (request.path === '/health') {
      return true;
    }

    throw new ForbiddenException('Access denied by default security policy');
  }
}
