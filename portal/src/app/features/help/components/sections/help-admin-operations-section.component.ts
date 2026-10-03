import { Component, Input } from '@angular/core';
import { AppRole } from '@portal/core/constants/app.constants';

@Component({
  selector: 'app-help-admin-operations-section',
  standalone: true,
  template: `
    <section
      class="rounded-2xl border border-neutral-200 bg-white p-6 sm:p-8 shadow-sm"
    >
      <p class="text-xs uppercase tracking-[0.1em] text-neutral-500">
        Administration
      </p>
      <h2 class="mt-2 text-xl tracking-tight text-neutral-900">
        Platform operations available to Admin
      </h2>
      <div
        class="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm text-neutral-700"
      >
        <div class="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
          <p class="font-semibold text-neutral-900">Users</p>
          <p class="mt-1">
            Create users with an email, temporary password and role (Admin,
            Receiver, Inspector, Supervisor or Customer). A Customer user must
            be linked to a customer company. Edit a user's name or use "Force
            Reset Password" to set a new one. The list shows whether each user
            is active and synced.
          </p>
        </div>
        <div class="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
          <p class="font-semibold text-neutral-900">Customers</p>
          <p class="mt-1">
            Register customer companies (name, optional code, email, phone). The
            code prefixes generated report numbers. Edit details, or deactivate
            a customer with a mandatory reason.
          </p>
        </div>
        <div class="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
          <p class="font-semibold text-neutral-900">Templates &amp; reports</p>
          <p class="mt-1">
            Upload and define templates, approve or reject supervisors' uploads
            and deprecate obsolete versions (see Templates). Under Reports you
            can create, oversee and override any report.
          </p>
        </div>
      </div>
    </section>
  `,
})
export class HelpAdminOperationsSectionComponent {
  @Input() role!: AppRole;
}
