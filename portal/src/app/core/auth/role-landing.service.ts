import { Injectable } from '@angular/core';
import { AppRoutes } from '../navigation/routes.constants';

@Injectable({
  providedIn: 'root'
})
export class RoleLandingService {
  getLandingRoute(role: string): string[] {
    switch (role) {
      case 'ADMIN':
        return ['/', AppRoutes.ADMIN];
      case 'RECEIVER':
        return ['/', AppRoutes.RECEIVER];
      case 'INSPECTOR':
        return ['/', AppRoutes.INSPECTOR];
      case 'SUPERVISOR':
        return ['/', AppRoutes.SUPERVISOR];
      case 'CUSTOMER':
        return ['/', AppRoutes.CUSTOMER];
      default:
        return ['/', AppRoutes.ACCESS_DENIED];
    }
  }
}
