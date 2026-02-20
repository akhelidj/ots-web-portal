import { Route } from '@angular/router';
import { ShellComponent } from './shared/shell/shell.component';
import { AdminUsersComponent } from './admin/admin-users.component';
import { ReceiverPlaceholderComponent } from './shared/placeholders/receiver-placeholder.component';
import { SupervisorPlaceholderComponent } from './shared/placeholders/supervisor-placeholder.component';
import { InspectionReportListComponent } from './inspector/inspection-report-list.component';
import { CreateInspectionReportComponent } from './inspector/create-inspection-report.component';
import { InspectionReportDetailComponent } from './inspector/inspection-report-detail.component';

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
      { 
        path: 'inspector', 
        canActivate: [authGuard, mustChangePasswordGuard],
        children: [
          { path: '', redirectTo: 'reports', pathMatch: 'full' },
          { path: 'reports', component: InspectionReportListComponent },
          { path: 'reports/create', component: CreateInspectionReportComponent },
          { path: 'reports/:id', component: InspectionReportDetailComponent },
        ]
      },
      { path: 'supervisor', component: SupervisorPlaceholderComponent, canActivate: [authGuard, mustChangePasswordGuard] },
    ],
  },
];
