import { Component, Input } from '@angular/core';
import { AppRole } from '@portal/core/constants/app.constants';

@Component({
  selector: 'app-help-child-reports-section',
  standalone: true,
  template: `
    <section
      class="rounded-2xl border border-neutral-200 bg-white p-6 sm:p-8 shadow-sm"
    >
      <p class="text-xs uppercase tracking-[0.1em] text-neutral-500">
        Child Reports
      </p>
      <h2 class="mt-2 text-xl tracking-tight text-neutral-900">
        Rework branch handling
      </h2>
      <ul class="mt-4 space-y-2 text-sm text-neutral-700">
        <li>
          <strong>Rework Routing:</strong> All serials marked as "Rework" during
          the main inspection are grouped into a single dedicated Child Report.
        </li>
        @if (role === 'INSPECTOR' || role === 'ADMIN') {
          <li>
            <strong>Child Submission:</strong> Repaired child serials must be
            submitted strictly via the batch action bar interface within the
            child report.
          </li>
        }
        @if (role === 'SUPERVISOR' || role === 'ADMIN') {
          <li>
            <strong>Child Approvals:</strong> As a reviewer, you must approve
            the child report batches before the parent report can be fully
            closed out.
          </li>
        }
        <li>
          <strong>Workflow Constraints:</strong> Transitions like 'Submit for
          Approval' must be accessed via the central 'Workflow Actions' button
          in the header.
        </li>
        <li>
          <strong>File Locking:</strong> Child report PDF exports and document
          attachments remain locked until the child report is fully approved.
        </li>
      </ul>
    </section>
  `,
})
export class HelpChildReportsSectionComponent {
  @Input() role!: AppRole;
}
