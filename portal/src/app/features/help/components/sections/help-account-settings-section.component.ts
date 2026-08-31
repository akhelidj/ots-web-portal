import { Component, Input } from '@angular/core';
import { AppRole } from '@portal/core/constants/app.constants';

@Component({
  selector: 'app-help-account-settings-section',
  standalone: true,
  template: `
    <section
      class="rounded-2xl border border-neutral-200 bg-white p-6 sm:p-8 shadow-sm"
    >
      <p class="text-xs uppercase tracking-[0.1em] text-neutral-500">Account</p>
      <h2 class="mt-2 text-xl tracking-tight text-neutral-900">
        Settings and access hygiene
      </h2>
      <ul class="mt-4 space-y-2 text-sm text-neutral-700">
        <li>
          <strong>Profile:</strong> Update your personal information and adjust
          workspace preferences from the Settings screen.
        </li>
        <li>
          <strong>Security:</strong> Change your password and verify your secure
          session integrity.
        </li>
        <li>
          <strong>Permissions:</strong> Your account role ({{ role }}) is
          statically assigned by administrators. Contact them for escalated
          access needs.
        </li>
      </ul>
    </section>
  `,
})
export class HelpAccountSettingsSectionComponent {
  @Input() role!: AppRole;
}
