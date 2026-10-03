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
        Follow-up (rework) reports
      </h2>
      <ul class="mt-4 space-y-2 text-sm text-neutral-700">
        <li>
          <strong>Automatic creation:</strong> The report's template can define
          a rework rule (a field and the value that triggers it). Serials that
          match are gathered automatically into one child report whose number is
          the parent's plus a suffix. If a serial stops matching it is removed,
          and an untouched child report with no serials disappears.
        </li>
        @if (role === 'CUSTOMER') {
          <li>
            <strong>Visibility:</strong> Child reports appear as chips in your
            report list (type, serial count, status) and in a "Child Reports"
            section of the report. Open one to read it; you only see those
            belonging to your organization's reports.
          </li>
        } @else {
          <li>
            <strong>Own workflow:</strong> A child report has its own status
            (Draft, In Inspection, Pending Approval, Approved, Closed) and its
            own serial inspection forms and dispositions. Open it from the
            Rework Status card on the parent.
          </li>
        }
        @if (role === 'INSPECTOR' || role === 'ADMIN') {
          <li>
            <strong>Inspection:</strong> Use the Actions button on the child
            report to start it, inspect each target serial, then select them and
            submit for approval in a batch.
          </li>
        }
        @if (role === 'SUPERVISOR' || role === 'ADMIN') {
          <li>
            <strong>Approval:</strong> Child batches appear in the parent's
            Approvals tab marked "Source: Child Report". Approving all its
            serials approves the child report. The parent report is approved on
            its own serials and is not held back by the child.
          </li>
        }
        <li>
          <strong>Export:</strong> A child report can be exported once the child
          (or its parent) is Approved or Closed.
        </li>
      </ul>
    </section>
  `,
})
export class HelpChildReportsSectionComponent {
  @Input() role!: AppRole;
}
