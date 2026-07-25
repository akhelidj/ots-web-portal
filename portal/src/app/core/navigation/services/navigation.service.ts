import { Injectable } from '@angular/core';
import { AppRoutes } from '@portal/core/navigation/constants/routes.constants';
import { APP_ROLES } from '@portal/core/constants/app.constants';

export interface NavItem {
  label: string;
  route: string | string[];
  exact?: boolean;
  icon?: string;
}

@Injectable({
  providedIn: 'root',
})
export class NavigationService {
  buildNavigation(role: string): NavItem[] {
    switch (role) {
      case APP_ROLES.ADMIN:
        return [
          {
            label: 'Users',
            route: ['/', AppRoutes.ADMIN, 'users'],
            exact: false,
          },
          {
            label: 'Customers',
            route: ['/', AppRoutes.ADMIN, 'customers'],
            exact: false,
          },
          {
            label: 'Reports',
            route: ['/', AppRoutes.ADMIN, 'reports'],
            exact: false,
          },
          {
            label: 'Templates',
            route: ['/', AppRoutes.ADMIN, 'templates'],
            exact: false,
          },
        ];
      case APP_ROLES.RECEIVER:
        return [
          {
            label: 'Receiver Workspace',
            route: ['/', AppRoutes.RECEIVER],
            exact: false,
          },
        ];
      case APP_ROLES.INSPECTOR:
        return [
          {
            label: 'Inspector Workspace',
            route: ['/', AppRoutes.INSPECTOR],
            exact: false,
          },
        ];
      case APP_ROLES.SUPERVISOR:
        return [
          {
            label: 'Approval Workspace',
            route: ['/', AppRoutes.SUPERVISOR],
            exact: false,
          },
        ];
      case APP_ROLES.CUSTOMER:
        return [
          {
            label: 'Customer Portal',
            route: ['/', AppRoutes.CUSTOMER],
            exact: false,
          },
        ];
      default:
        return [];
    }
  }
}
