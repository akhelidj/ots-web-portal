import { inject } from '@angular/core';
import { CanActivateFn } from '@angular/router';
import { SessionService } from './session.service';

export const authGuard: CanActivateFn = () => {
  const session = inject(SessionService);
  
  // If no valid session exists, return false to block route activation in place.
  // The ShellComponent UI will handle displaying the authentication placeholder.
  return session.isAuthenticated$;
};
