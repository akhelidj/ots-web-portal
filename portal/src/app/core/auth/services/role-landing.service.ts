import { Injectable } from '@angular/core';
import { AppRoutes } from '@portal/core/navigation/constants/routes.constants';
import { APP_ROLES } from '@portal/core/constants/app.constants';

@Injectable({
  providedIn: 'root',
})
export class RoleLandingService {
  getLandingRoute(role: string): string[] {
    switch (role) {
      case APP_ROLES.ADMIN:
        return ['/', AppRoutes.ADMIN];
      case APP_ROLES.RECEIVER:
        return ['/', AppRoutes.RECEIVER];
      case APP_ROLES.INSPECTOR:
        return ['/', AppRoutes.INSPECTOR];
      case APP_ROLES.SUPERVISOR:
        return ['/', AppRoutes.SUPERVISOR];
      case APP_ROLES.CUSTOMER:
        return ['/', AppRoutes.CUSTOMER];
      default:
        return ['/', AppRoutes.ACCESS_DENIED];
    }
  }
}
