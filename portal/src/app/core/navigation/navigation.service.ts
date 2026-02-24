import { Injectable } from '@angular/core';
import { AppRoutes } from './routes.constants';

export interface NavItem {
  label: string;
  route: string | string[];
  exact?: boolean;
  icon?: string;
}

@Injectable({
  providedIn: 'root'
})
export class NavigationService {
  buildNavigation(role: string): NavItem[] {
    switch (role) {
      case 'ADMIN':
        return [
          { label: 'Admin Workspace', route: ['/', AppRoutes.ADMIN], exact: false },
        ];
      case 'RECEIVER':
        return [
          { label: 'Receiver Workspace', route: ['/', AppRoutes.RECEIVER], exact: false },
        ];
      case 'INSPECTOR':
        return [
          { label: 'Inspector Workspace', route: ['/', AppRoutes.INSPECTOR], exact: false },
        ];
      case 'SUPERVISOR':
        return [
          { label: 'Approval Workspace', route: ['/', AppRoutes.SUPERVISOR], exact: false },
        ];
      case 'CUSTOMER':
        return [
          { label: 'Customer Portal', route: ['/', AppRoutes.CUSTOMER], exact: false },
        ];
      default:
        return [];
    }
  }
}
