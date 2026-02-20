import { Route } from '@angular/router';
import { ShellComponent } from './shared/shell/shell.component';
import { AdminPlaceholderComponent } from './shared/placeholders/admin-placeholder.component';
import { ReceiverPlaceholderComponent } from './shared/placeholders/receiver-placeholder.component';
import { InspectorPlaceholderComponent } from './shared/placeholders/inspector-placeholder.component';
import { SupervisorPlaceholderComponent } from './shared/placeholders/supervisor-placeholder.component';

export const appRoutes: Route[] = [
  {
    path: '',
    component: ShellComponent,
    children: [
      { path: 'admin', component: AdminPlaceholderComponent },
      { path: 'receiver', component: ReceiverPlaceholderComponent },
      { path: 'inspector', component: InspectorPlaceholderComponent },
      { path: 'supervisor', component: SupervisorPlaceholderComponent },
    ],
  },
];
