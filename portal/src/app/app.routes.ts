import { Route } from '@angular/router';
import { APP_ROLES } from '@portal/core/constants/app.constants';
import { ShellComponent } from '@portal/shared/shell/shell.component';
import { roleGuard } from '@portal/core/auth/guards/role.guard';
import { authGuard } from '@portal/core/auth/guards/auth.guard';
import { mustChangePasswordGuard } from '@portal/core/auth/guards/must-change-password.guard';
import { LoginComponent } from '@portal/features/auth/components/login/login.component';
import { AppRoutes } from '@portal/core/navigation/constants/routes.constants';

/*
 * Only the login page and the shell are in the initial bundle; every feature screen is a
 * lazy chunk. Offline still works: the service worker (ngsw-config.json, `/*.js` prefetch)
 * downloads every chunk at install, so an unvisited screen opens without a connection.
 */
const reportList = () =>
  import('@portal/features/inspections/components/inspection-report-list/inspection-report-list.component').then(
    (m) => m.InspectionReportListComponent,
  );
const createReport = () =>
  import('@portal/features/inspections/components/create-inspection-report/create-inspection-report.component').then(
    (m) => m.CreateInspectionReportComponent,
  );
const reportDetail = () =>
  import('@portal/features/inspections/components/inspection-report-detail/inspection-report-detail.component').then(
    (m) => m.InspectionReportDetailComponent,
  );
const childReportDetail = () =>
  import('@portal/features/inspections/components/child-report-detail/child-report-detail.component').then(
    (m) => m.ChildReportDetailComponent,
  );
const adminTemplates = () =>
  import('@portal/features/templates/components/admin-templates/admin-templates.component').then(
    (m) => m.AdminTemplatesComponent,
  );
const templateDefine = () =>
  import('@portal/features/templates/components/template-define/template-define.component').then(
    (m) => m.TemplateDefineComponent,
  );

export const appRoutes: Route[] = [
  {
    path: AppRoutes.LOGIN,
    component: LoginComponent,
    canActivate: [mustChangePasswordGuard],
  },
  {
    path: AppRoutes.CHANGE_PASSWORD,
    loadComponent: () =>
      import('@portal/features/auth/components/change-password/change-password.component').then(
        (m) => m.ChangePasswordComponent,
      ),
    canActivate: [authGuard, mustChangePasswordGuard],
  },
  {
    path: AppRoutes.ACCESS_DENIED,
    loadComponent: () =>
      import('@portal/features/errors/components/access-denied/access-denied.component').then(
        (m) => m.AccessDeniedComponent,
      ),
  },
  {
    path: '',
    component: ShellComponent,
    canActivate: [authGuard, mustChangePasswordGuard],
    children: [
      {
        path: '',
        pathMatch: 'full',
        loadComponent: () =>
          import('@portal/features/landing/components/landing/landing.component').then(
            (m) => m.LandingComponent,
          ),
      },
      {
        path: AppRoutes.SETTINGS,
        loadComponent: () =>
          import('@portal/features/auth/components/settings/settings.component').then(
            (m) => m.SettingsComponent,
          ),
        canActivate: [authGuard, mustChangePasswordGuard],
      },
      {
        path: AppRoutes.HELP,
        loadComponent: () =>
          import('@portal/features/help/components/help/help.component').then(
            (m) => m.HelpComponent,
          ),
        canActivate: [authGuard, mustChangePasswordGuard],
      },
      {
        path: AppRoutes.ADMIN,
        canActivate: [roleGuard],
        data: { roles: [APP_ROLES.ADMIN] },
        children: [
          { path: '', redirectTo: 'users', pathMatch: 'full' },
          { path: 'reports', loadComponent: reportList },
          { path: 'reports/create', loadComponent: createReport },
          { path: 'reports/:id', loadComponent: reportDetail },
          { path: 'reports/:id/child', loadComponent: childReportDetail },
          {
            path: 'users',
            loadComponent: () =>
              import('@portal/features/users/components/admin-users/admin-users.component').then(
                (m) => m.AdminUsersComponent,
              ),
          },
          {
            path: 'customers',
            loadComponent: () =>
              import('@portal/features/customers/components/admin-customers/admin-customers.component').then(
                (m) => m.AdminCustomersComponent,
              ),
          },
          {
            path: 'metrics',
            loadComponent: () =>
              import('@portal/features/metrics/admin-metrics.component').then(
                (m) => m.AdminMetricsComponent,
              ),
          },
          { path: 'templates', loadComponent: adminTemplates },
          { path: 'templates/:id/define', loadComponent: templateDefine },
        ],
      },
      {
        path: AppRoutes.RECEIVER,
        canActivate: [roleGuard],
        data: { roles: [APP_ROLES.RECEIVER] },
        children: [
          { path: '', redirectTo: 'reports', pathMatch: 'full' },
          {
            path: 'reports',
            loadComponent: () =>
              import('@portal/features/workspaces/receiver/receiver-workspace.component').then(
                (m) => m.ReceiverWorkspaceComponent,
              ),
          },
          { path: 'reports/create', loadComponent: createReport },
          { path: 'reports/:id', loadComponent: reportDetail },
          { path: 'reports/:id/child', loadComponent: childReportDetail },
        ],
      },
      {
        path: AppRoutes.INSPECTOR,
        canActivate: [roleGuard],
        data: { roles: [APP_ROLES.INSPECTOR] },
        children: [
          { path: '', redirectTo: 'reports', pathMatch: 'full' },
          { path: 'reports', loadComponent: reportList },
          { path: 'reports/create', loadComponent: createReport },
          { path: 'reports/:id', loadComponent: reportDetail },
          { path: 'reports/:id/child', loadComponent: childReportDetail },
        ],
      },
      {
        path: AppRoutes.SUPERVISOR,
        canActivate: [roleGuard],
        data: { roles: [APP_ROLES.SUPERVISOR] },
        children: [
          { path: '', redirectTo: 'reports', pathMatch: 'full' },
          {
            path: 'reports',
            loadComponent: () =>
              import('@portal/features/workspaces/supervisor/supervisor-workspace.component').then(
                (m) => m.SupervisorWorkspaceComponent,
              ),
          },
          { path: 'reports/create', loadComponent: createReport },
          { path: 'reports/:id', loadComponent: reportDetail },
          { path: 'reports/:id/child', loadComponent: childReportDetail },
          { path: 'templates', loadComponent: adminTemplates },
          { path: 'templates/:id/define', loadComponent: templateDefine },
        ],
      },
      {
        path: AppRoutes.CUSTOMER,
        canActivate: [roleGuard],
        data: { roles: [APP_ROLES.CUSTOMER] },
        children: [
          { path: '', redirectTo: 'reports', pathMatch: 'full' },
          {
            path: 'reports',
            loadComponent: () =>
              import('@portal/features/workspaces/customer/customer-workspace.component').then(
                (m) => m.CustomerWorkspaceComponent,
              ),
          },
          // `appFrame`: the shell hands this screen the full remaining viewport (no page
          // padding, no page scroll) — the report renders as a desktop-app window.
          {
            path: 'reports/:id',
            loadComponent: reportDetail,
            data: { appFrame: true },
          },
          { path: 'reports/:id/child', loadComponent: childReportDetail },
        ],
      },
    ],
  },
];
