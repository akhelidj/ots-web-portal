import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessionService } from './session.service';
import { map } from 'rxjs';

export const mustChangePasswordGuard: CanActivateFn = (route, state) => {
  const session = inject(SessionService);
  const router = inject(Router);

  return session.mustChangePassword$.pipe(
    map((mustChange) => {
      const isNavigatingToChangePassword = state.url.includes('/change-password');

      if (mustChange) {
        // If they must change password, they can ONLY go to /change-password
        if (isNavigatingToChangePassword) {
          return true; 
        }
        return router.parseUrl('/change-password');
      } else {
        // They can go anywhere, including /change-password explicitly via settings
        return true;
      }
    })
  );
};
