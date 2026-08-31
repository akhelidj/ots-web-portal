import { Component, Input } from '@angular/core';
import { AppRole } from '@portal/core/constants/app.constants';

@Component({
  selector: 'app-help-exports-section',
  standalone: true,
  template: `
    <section
      class="rounded-2xl border border-neutral-200 bg-white p-6 sm:p-8 shadow-sm"
    >
      <p class="text-xs uppercase tracking-[0.1em] text-neutral-500">Exports</p>
      <h2 class="mt-2 text-xl tracking-tight text-neutral-900">
        Approved report document export
      </h2>
      <ul class="mt-4 space-y-2 text-sm text-neutral-700">
        <li>
          <strong>Availability:</strong> Exports are securely available only
          when the report status reaches Approved or Closed.
        </li>
        <li>
          <strong>Connectivity:</strong> Online connectivity is strictly
          required to generate and download export documents from the server.
        </li>
        <li>
          <strong>Format:</strong> Export snapshots permanently embed all final
          inspection variables, timestamp history, and approval attribution
          fields for total operational traceability.
        </li>
      </ul>
    </section>
  `,
})
export class HelpExportsSectionComponent {
  @Input() role!: AppRole;
}
