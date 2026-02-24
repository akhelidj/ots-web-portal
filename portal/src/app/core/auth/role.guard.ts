import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessionService } from './session.service';
import { RoleLandingService } from './role-landing.service';
import { AppRoutes } from '../navigation/routes.constants';

export const roleGuard: CanActivateFn = async (route) => {
  const session = inject(SessionService);
  const router = inject(Router);
  const roleLandingService = inject(RoleLandingService);

  if (!session.isAuthenticated) {
    return router.parseUrl('/' + AppRoutes.LOGIN);
  }

  // Use a snapshot approach since functional guards execute eagerly and we want the current immediate state.
  let currentRole: string | undefined;
  // Given SessionService profile subject emits synchronously the initial getStoredProfile()
  session.profile$.subscribe(p => {
    currentRole = p?.role;
  }).unsubscribe();

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
