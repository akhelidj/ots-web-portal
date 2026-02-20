import { Route } from '@angular/router';
import { ShellComponent } from './shared/shell/shell.component';
import { AdminPlaceholderComponent } from './shared/placeholders/admin-placeholder.component';
import { ReceiverPlaceholderComponent } from './shared/placeholders/receiver-placeholder.component';
import { InspectorPlaceholderComponent } from './shared/placeholders/inspector-placeholder.component';
import { SupervisorPlaceholderComponent } from './shared/placeholders/supervisor-placeholder.component';

import { authGuard } from './core/auth/auth.guard';

export const appRoutes: Route[] = [
  {
    path: '',
    component: ShellComponent,
    children: [
      { path: 'admin', component: AdminPlaceholderComponent, canActivate: [authGuard] },
      { path: 'receiver', component: ReceiverPlaceholderComponent, canActivate: [authGuard] },
      { path: 'inspector', component: InspectorPlaceholderComponent, canActivate: [authGuard] },
      { path: 'supervisor', component: SupervisorPlaceholderComponent, canActivate: [authGuard] },
    ],
  },
];
