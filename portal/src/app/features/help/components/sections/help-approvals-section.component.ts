import { Component, Input } from '@angular/core';
import { AppRole } from '@portal/core/constants/app.constants';

@Component({
  selector: 'app-help-approvals-section',
  standalone: true,
  template: `
    <section
      class="rounded-2xl border border-neutral-200 bg-white p-6 sm:p-8 shadow-sm"
    >
      <p class="text-xs uppercase tracking-[0.1em] text-neutral-500">
        Approvals
      </p>
      <h2 class="mt-2 text-xl tracking-tight text-neutral-900">
        Batch review and publish workflow
      </h2>
      <ul class="mt-4 space-y-2 text-sm text-neutral-700">
        @if (role === 'INSPECTOR' || role === 'ADMIN') {
          <li>
            <strong>Submission:</strong> Select completed serial numbers and
            submit them for approval via the batch action bar.
          </li>
        }
        @if (role === 'SUPERVISOR' || role === 'ADMIN') {
          <li>
            <strong>Review:</strong> Evaluate submitted batches inside the
            'Pipes' tab and explicitly approve or return them with required
            notes.
          </li>
          <li>
            <strong>Publishing Blockers:</strong> Publishing the final report is
            strictly blocked until all submitted batches evaluate to approved.
          </li>
        }
        <li>
          <strong>Traceability:</strong> Returned decisions and transition
          history are tracked and can be viewed per-item by clicking the
          "History" button.
        </li>
      </ul>
    </section>
  `,
})
export class HelpApprovalsSectionComponent {
  @Input() role!: AppRole;
}
