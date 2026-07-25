import { Component, Input } from '@angular/core';
import { AppRole } from '@portal/core/constants/app.constants';

@Component({
  selector: 'app-help-inspection-execution-section',
  standalone: true,
  template: `
    <section
      class="rounded-2xl border border-neutral-200 bg-white p-6 sm:p-8 shadow-sm"
    >
      <p class="text-xs uppercase tracking-[0.1em] text-neutral-500">
        Inspection
      </p>
      <h2 class="mt-2 text-xl font-semibold tracking-tight text-neutral-900">
        Serial execution during inspection
      </h2>
      <ul class="mt-4 space-y-2 text-sm text-neutral-700">
        <li>
          <strong>Data Entry:</strong> Open each pipe's drawer to complete the
          structured inspection form data.
        </li>
        <li>
          <strong>Dispositions:</strong> Set disposition outcomes (Pass, Rework,
          Scrap, Hold) as you progress through the form.
        </li>
        <li>
          <strong>Batching:</strong> Use the "Select All Approved" controls or
          manually click checkboxes to select ready serials, then submit them
          together via the sticky batch action bar at the bottom.
        </li>
        <li>
          <strong>Locking:</strong> Once submitted, a serial's data is strictly
          locked until returned or reopened by a Supervisor or Admin.
        </li>
      </ul>
    </section>
  `,
})
export class HelpInspectionExecutionSectionComponent {
  @Input() role!: AppRole;
}
