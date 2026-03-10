import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessionService } from '@portal/core/auth/services/session.service';

export const mustChangePasswordGuard: CanActivateFn = (route, state) => {
  const session = inject(SessionService);
  const router = inject(Router);

  const mustChange = session.mustChangePassword();
  const isNavigatingToChangePassword = state.url.includes('/change-password');

  if (mustChange) {
    if (isNavigatingToChangePassword) {
      return true; 
    }
    return router.parseUrl('/change-password');
  } else {
    return true;
  }
};
