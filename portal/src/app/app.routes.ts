import { Route } from '@angular/router';
import { ShellComponent } from './shared/shell/shell.component';
import { AdminUsersComponent } from './admin/admin-users.component';
import { ReceiverPlaceholderComponent } from './shared/placeholders/receiver-placeholder.component';
import { InspectorPlaceholderComponent } from './shared/placeholders/inspector-placeholder.component';
import { SupervisorPlaceholderComponent } from './shared/placeholders/supervisor-placeholder.component';

import { authGuard } from './core/auth/auth.guard';
import { mustChangePasswordGuard } from './core/auth/must-change-password.guard';
import { LoginComponent } from './auth/login.component';
import { ChangePasswordComponent } from './auth/change-password.component';
import { LandingComponent } from './landing.component';

export const appRoutes: Route[] = [
  {
    path: 'login',
    component: LoginComponent,
    canActivate: [mustChangePasswordGuard],
  },
  {
    path: 'change-password',
    component: ChangePasswordComponent,
    canActivate: [authGuard, mustChangePasswordGuard],
  },
  {
    path: '',
    component: ShellComponent,
    children: [
      { path: '', component: LandingComponent, pathMatch: 'full' },
      { path: 'admin', component: AdminUsersComponent, canActivate: [authGuard, mustChangePasswordGuard] },
      { path: 'receiver', component: ReceiverPlaceholderComponent, canActivate: [authGuard, mustChangePasswordGuard] },
      { path: 'inspector', component: InspectorPlaceholderComponent, canActivate: [authGuard, mustChangePasswordGuard] },
      { path: 'supervisor', component: SupervisorPlaceholderComponent, canActivate: [authGuard, mustChangePasswordGuard] },
    ],
  },
];
