import { Route } from '@angular/router';
import { APP_ROLES } from '@portal/core/constants/app.constants';
import { ShellComponent } from '@portal/shared/shell/shell.component';
import { AdminUsersComponent } from '@portal/features/users/components/admin-users/admin-users.component';
import { AdminCustomersComponent } from '@portal/features/customers/components/admin-customers/admin-customers.component';
import { AdminTemplatesComponent } from '@portal/features/templates/components/admin-templates/admin-templates.component';
import { SupervisorWorkspaceComponent } from '@portal/features/workspaces/supervisor/supervisor-workspace.component';
import { InspectionReportListComponent } from '@portal/features/inspections/components/inspection-report-list/inspection-report-list.component';
import { CreateInspectionReportComponent } from '@portal/features/inspections/components/create-inspection-report/create-inspection-report.component';
import { InspectionReportDetailComponent } from '@portal/features/inspections/components/inspection-report-detail/inspection-report-detail.component';
import { ChildReportDetailComponent } from '@portal/features/inspections/components/child-report-detail/child-report-detail.component';

import { CustomerWorkspaceComponent } from '@portal/features/workspaces/customer/customer-workspace.component';
import { roleGuard } from '@portal/core/auth/guards/role.guard';
import { authGuard } from '@portal/core/auth/guards/auth.guard';
import { mustChangePasswordGuard } from '@portal/core/auth/guards/must-change-password.guard';
import { LoginComponent } from '@portal/features/auth/components/login/login.component';
import { SettingsComponent } from '@portal/features/auth/components/settings/settings.component';
import { LandingComponent } from '@portal/features/landing/components/landing/landing.component';
import { AppRoutes } from '@portal/core/navigation/constants/routes.constants';
import { AccessDeniedComponent } from '@portal/features/errors/components/access-denied/access-denied.component';
import { ReceiverWorkspaceComponent } from '@portal/features/workspaces/receiver/receiver-workspace.component';

export const appRoutes: Route[] = [
  {
    path: AppRoutes.LOGIN,
    component: LoginComponent,
    canActivate: [mustChangePasswordGuard],
  },
  {
    path: AppRoutes.CHANGE_PASSWORD,
    redirectTo: AppRoutes.SETTINGS,
    pathMatch: 'full',
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
        path: AppRoutes.SETTINGS,
        component: SettingsComponent,
        canActivate: [authGuard, mustChangePasswordGuard],
      },
      { 
        path: AppRoutes.ADMIN, 
        canActivate: [roleGuard],
        data: { roles: [APP_ROLES.ADMIN] },
        children: [
          { path: '', redirectTo: 'users', pathMatch: 'full' },
          { path: 'reports', component: InspectionReportListComponent },
          { path: 'reports/create', component: CreateInspectionReportComponent },
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
        data: { roles: [APP_ROLES.RECEIVER] },
        children: [
          { path: '', redirectTo: 'reports', pathMatch: 'full' },
          { path: 'reports', component: ReceiverWorkspaceComponent },
          { path: 'reports/create', component: CreateInspectionReportComponent },
          { path: 'reports/:id', component: InspectionReportDetailComponent },
          { path: 'reports/:id/child', component: ChildReportDetailComponent }
        ]
      },
      { 
        path: AppRoutes.INSPECTOR, 
        canActivate: [roleGuard],
        data: { roles: [APP_ROLES.INSPECTOR] },
        children: [
          { path: '', redirectTo: 'reports', pathMatch: 'full' },
          { path: 'reports', component: InspectionReportListComponent },
          { path: 'reports/create', component: CreateInspectionReportComponent },
          { path: 'reports/:id', component: InspectionReportDetailComponent },
          { path: 'reports/:id/child', component: ChildReportDetailComponent },
        ]
      },
      { 
        path: AppRoutes.SUPERVISOR, 
        canActivate: [roleGuard],
        data: { roles: [APP_ROLES.SUPERVISOR] },
        children: [
          { path: '', redirectTo: 'reports', pathMatch: 'full' },
          { path: 'reports', component: SupervisorWorkspaceComponent },
          { path: 'reports/create', component: CreateInspectionReportComponent },
          { path: 'reports/:id', component: InspectionReportDetailComponent },
          { path: 'reports/:id/child', component: ChildReportDetailComponent }
        ]
      },
      { 
        path: AppRoutes.CUSTOMER, 
        canActivate: [roleGuard],
        data: { roles: [APP_ROLES.CUSTOMER] },
        children: [
          { path: '', redirectTo: 'reports', pathMatch: 'full' },
          { path: 'reports', component: CustomerWorkspaceComponent },
          { path: 'reports/:id', component: InspectionReportDetailComponent },
          { path: 'reports/:id/child', component: ChildReportDetailComponent }
        ]
      },
    ],
  },
];
