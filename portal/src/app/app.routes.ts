import { Route } from '@angular/router';
import { ShellComponent } from './shared/shell/shell.component';
import { AdminUsersComponent } from './admin/admin-users.component';
import { AdminCustomersComponent } from './admin/admin-customers.component';
import { AdminTemplatesComponent } from './admin/admin-templates.component';
import { SupervisorWorkspaceComponent } from './supervisor/supervisor-workspace.component';
import { InspectionReportListComponent } from './inspector/inspection-report-list.component';
import { CreateInspectionReportComponent } from './inspector/create-inspection-report.component';
import { InspectionReportDetailComponent } from './inspector/inspection-report-detail.component';
import { ChildReportDetailComponent } from './inspector/child-report-detail.component';

import { CustomerWorkspaceComponent } from './customer/customer-workspace.component';
import { roleGuard } from './core/auth/role.guard';
import { authGuard } from './core/auth/auth.guard';
import { mustChangePasswordGuard } from './core/auth/must-change-password.guard';
import { LoginComponent } from './auth/login.component';
import { ChangePasswordComponent } from './auth/change-password.component';
import { LandingComponent } from './landing.component';
import { AppRoutes } from './core/navigation/routes.constants';
import { AccessDeniedComponent } from './shared/access-denied.component';
import { ReceiverWorkspaceComponent } from './receiver/receiver-workspace.component';

export const appRoutes: Route[] = [
  {
    path: AppRoutes.LOGIN,
    component: LoginComponent,
    canActivate: [mustChangePasswordGuard],
  },
  {
    path: AppRoutes.CHANGE_PASSWORD,
    component: ChangePasswordComponent,
    canActivate: [authGuard, mustChangePasswordGuard],
  },
  {
    path: AppRoutes.ACCESS_DENIED,
    component: AccessDeniedComponent,
  },
  {
    path: '',
    component: ShellComponent,
    canActivate: [authGuard, mustChangePasswordGuard],
    children: [
      { path: '', component: LandingComponent, pathMatch: 'full' },
      { 
        path: AppRoutes.ADMIN, 
        canActivate: [roleGuard],
        data: { roles: ['ADMIN'] },
        children: [
          { path: '', redirectTo: 'users', pathMatch: 'full' },
          { path: 'reports', component: InspectionReportListComponent },
          { path: 'reports/:id', component: InspectionReportDetailComponent },
          { path: 'reports/:id/child', component: ChildReportDetailComponent },
          { path: 'users', component: AdminUsersComponent },
          { path: 'customers', component: AdminCustomersComponent },
          { path: 'templates', component: AdminTemplatesComponent },
        ]
      },
      { 
        path: AppRoutes.RECEIVER, 
        canActivate: [roleGuard],
        data: { roles: ['RECEIVER'] },
        children: [
          { path: '', component: ReceiverWorkspaceComponent, pathMatch: 'full' },
          { path: 'reports/create', component: CreateInspectionReportComponent },
          { path: ':id', component: InspectionReportDetailComponent },
          { path: 'reports/:id/child', component: ChildReportDetailComponent }
        ]
      },
      { 
        path: AppRoutes.INSPECTOR, 
        canActivate: [roleGuard],
        data: { roles: ['INSPECTOR'] },
        children: [
          { path: '', redirectTo: 'reports', pathMatch: 'full' },
          { path: 'reports', component: InspectionReportListComponent },
          { path: 'reports/:id', component: InspectionReportDetailComponent },
          { path: 'reports/:id/child', component: ChildReportDetailComponent },
        ]
      },
      { 
        path: AppRoutes.SUPERVISOR, 
        canActivate: [roleGuard],
        data: { roles: ['SUPERVISOR'] },
        children: [
          { path: '', component: SupervisorWorkspaceComponent, pathMatch: 'full' },
          { path: ':id', component: InspectionReportDetailComponent },
          { path: 'reports/:id/child', component: ChildReportDetailComponent }
        ]
      },
      { 
        path: AppRoutes.CUSTOMER, 
        canActivate: [roleGuard],
        data: { roles: ['CUSTOMER'] },
        children: [
          { path: '', component: CustomerWorkspaceComponent, pathMatch: 'full' },
          { path: ':id', component: InspectionReportDetailComponent },
          { path: 'reports/:id/child', component: ChildReportDetailComponent }
        ]
      },
    ],
  },
];
