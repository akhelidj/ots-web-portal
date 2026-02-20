import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { SessionService } from './session.service';

export const authGuard: CanActivateFn = () => {
  const session = inject(SessionService);
  const router = inject(Router);

  // Still leveraging the existing `isAuthenticated$` stream, but using `map`
  // so we can return a `UrlTree` instead of bare `false` while preserving the fallback safety
  return session.isAuthenticated$.pipe(
    map((isAuthenticated) => {
      if (!isAuthenticated) {
        return router.parseUrl('/login');
      }
      return true;
    })
  );
};
