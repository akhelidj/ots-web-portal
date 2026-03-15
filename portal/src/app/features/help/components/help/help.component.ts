import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { SessionService } from '@portal/core/auth/services/session.service';
import { APP_VERSION } from '@portal/core/config/app-version';
import { HelpContentService } from '@portal/features/help/services/help-content.service';
import { APP_ROLES, AppRole } from '@portal/core/constants/app.constants';

@Component({
  selector: 'app-help',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './help.component.html',
})
export class HelpComponent {
  private readonly session = inject(SessionService);
  private readonly helpContent = inject(HelpContentService);

  public readonly appVersion = APP_VERSION;

  public readonly role = computed<AppRole>(() => {
    const rawRole = this.session.profile()?.role || '';
    if (this.helpContent.isAppRole(rawRole)) {
      return rawRole;
    }

    return APP_ROLES.CUSTOMER;
  });

  public readonly roleLabel = computed(() => {
    const role = this.role();
    if (role === APP_ROLES.SUPERVISOR) {
      return 'Supervisor';
    }
    if (role === APP_ROLES.RECEIVER) {
      return 'Receiver';
    }
    if (role === APP_ROLES.INSPECTOR) {
      return 'Inspector';
    }
    if (role === APP_ROLES.ADMIN) {
      return 'Admin';
    }
    return 'Customer';
  });

  public readonly sections = computed(() =>
    this.helpContent.getSectionsForRole(this.role()),
  );
}
