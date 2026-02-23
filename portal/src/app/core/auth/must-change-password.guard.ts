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
        // If they don't need to change password, they shouldn't be going to /change-password explicitly
        if (isNavigatingToChangePassword) {
            // Send them back to root, LandingComponent will figure it out
            return router.parseUrl('/'); 
        }
        return true;
      }
    })
  );
};
