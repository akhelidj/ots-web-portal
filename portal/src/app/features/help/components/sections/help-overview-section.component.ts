import { Component, Input } from '@angular/core';
import { AppRole } from '@portal/core/constants/app.constants';

@Component({
  selector: 'app-help-overview-section',
  standalone: true,
  template: `
    <section
      class="rounded-2xl border border-neutral-200 bg-white p-6 sm:p-8 shadow-sm"
    >
      <p class="text-xs uppercase tracking-[0.1em] text-neutral-500">
        Getting Started
      </p>
      <h2 class="mt-2 text-xl font-semibold tracking-tight text-neutral-900">
        Daily workflow in Trackline
      </h2>
      <div class="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
        <div class="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
          <p class="font-semibold text-neutral-800">1. Open your workspace</p>
          <p class="mt-1 text-neutral-600">
            Use your role workspace to find reports that need your action.
          </p>
        </div>
        <div class="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
          <p class="font-semibold text-neutral-800">
            2. Execute assigned actions
          </p>
          <p class="mt-1 text-neutral-600">
            @if (role === 'RECEIVER') {
              Create new incoming reports, log serials, and transition them to
              inspection-ready states.
            } @else if (role === 'INSPECTOR') {
              Perform physical inspections, log dimensions, input dispositions,
              and submit batches.
            } @else if (role === 'SUPERVISOR') {
              Review submitted batches, approve or return individual items, and
              publish final reports.
            } @else if (role === 'ADMIN') {
              Manage the entire platform, oversee tenant operations, and
              override workflows if needed.
            } @else {
              View published results, monitor key performance metrics, and
              export approved documents securely.
            }
          </p>
        </div>
        <div class="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
          <p class="font-semibold text-neutral-800">3. Keep sync healthy</p>
          <p class="mt-1 text-neutral-600">
            Work offline if needed, then reconnect and let the app synchronize
            changes.
          </p>
        </div>
      </div>
    </section>
  `,
})
export class HelpOverviewSectionComponent {
  @Input() role!: AppRole;
}
