import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessionService } from '@portal/core/auth/services/session.service';
import { RoleLandingService } from '@portal/core/auth/services/role-landing.service';
import { AppRoutes } from '@portal/core/navigation/constants/routes.constants';

export const roleGuard: CanActivateFn = async (route) => {
  const session = inject(SessionService);
  const router = inject(Router);
  const roleLandingService = inject(RoleLandingService);

  if (!session.isAuthenticated()) {
    return router.parseUrl('/' + AppRoutes.LOGIN);
  }

  const currentRole = session.profile()?.role;

  if (!currentRole) {
    return router.parseUrl('/' + AppRoutes.ACCESS_DENIED);
  }

  const allowedRoles = route.data['roles'] as string[];

  if (allowedRoles && allowedRoles.length > 0) {
    if (!allowedRoles.includes(currentRole)) {
      // Redirect to user's native home on unauthorized access attempts
      const landing = roleLandingService.getLandingRoute(currentRole).join('/');
      return router.parseUrl(landing);
    }
  }

  return true;
};
