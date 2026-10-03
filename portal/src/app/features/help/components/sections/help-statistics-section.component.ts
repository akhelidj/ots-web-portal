import { Component, Input } from '@angular/core';
import { AppRole } from '@portal/core/constants/app.constants';

@Component({
  selector: 'app-help-statistics-section',
  standalone: true,
  template: `
    <section
      class="rounded-2xl border border-neutral-200 bg-white p-6 sm:p-8 shadow-sm"
    >
      <p class="text-xs uppercase tracking-[0.1em] text-neutral-500">
        Statistics
      </p>
      <h2 class="mt-2 text-xl tracking-tight text-neutral-900">
        Report statistics
      </h2>
      <ul class="mt-4 space-y-2 text-sm text-neutral-700">
        <li>
          <strong>Free entry:</strong> Statistics are typed by the inspector — a
          label (e.g. "Accepted") and a value (e.g. "15"). Nothing is computed
          automatically from dispositions.
        </li>
        @if (
          role === 'INSPECTOR' || role === 'SUPERVISOR' || role === 'ADMIN'
        ) {
          <li>
            <strong>Editing:</strong> Use the statistics editor on the report
            while it is still editable: add rows, optionally attach the serials
            each one concerns (filter, "Select shown", or tick individually),
            then "Save statistics". The whole list is saved at once; saving an
            empty list clears them. Every row needs a label and a value.
          </li>
          <li>
            <strong>Locked after approval:</strong> Statistics cannot be changed
            once the report is Approved.
          </li>
        }
        <li>
          <strong>Serials:</strong> A statistic that lists serials is clickable
          and opens the list of those serials; one without is a plain figure.
        </li>
        @if (role === 'CUSTOMER') {
          <li>
            <strong>Your view:</strong> Statistics appear as a read-only grid on
            the report detail.
          </li>
        }
      </ul>
    </section>
  `,
})
export class HelpStatisticsSectionComponent {
  @Input() role!: AppRole;
}
