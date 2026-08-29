import { Component, Input } from '@angular/core';
import { AppRole } from '@portal/core/constants/app.constants';

@Component({
  selector: 'app-help-report-lifecycle-section',
  standalone: true,
  template: `
    <section
      class="rounded-2xl border border-neutral-200 bg-white p-6 sm:p-8 shadow-sm"
    >
      <p class="text-xs uppercase tracking-[0.1em] text-neutral-500">Reports</p>
      <h2 class="mt-2 text-xl font-semibold tracking-tight text-neutral-900">
        Inspection report lifecycle
      </h2>
      <p class="mt-3 text-sm text-neutral-600">
        Reports move through controlled workflow statuses: Draft, Received,
        Ready for Cleaning, Ready for Inspection, In Inspection, Pending
        Approval, Approved, On Hold, and Closed.
      </p>
      <ul class="mt-4 space-y-2 text-sm text-neutral-700">
        @if (role === 'RECEIVER' || role === 'ADMIN') {
          <li>
            <strong>Creation:</strong> Only Receivers and Admins can create new
            Draft reports and modify report metadata like PO Numbers.
          </li>
          <li>
            <strong>Prep Workflow:</strong> Responsible for transitioning
            reports through: Draft &rarr; Received &rarr; Ready for Cleaning
            &rarr; Ready for Inspection.
          </li>
        }
        @if (role === 'INSPECTOR' || role === 'ADMIN') {
          <li>
            <strong>Inspection:</strong> Can transition reports from Ready for
            Inspection &rarr; In Inspection to begin logging data.
          </li>
        }
        @if (role === 'SUPERVISOR' || role === 'ADMIN') {
          <li>
            <strong>Publishing:</strong> Supervisors and Admins can transition
            eligible reports to Approved, or place active reports On Hold.
          </li>
        }
        @if (role === 'ADMIN') {
          <li>
            <strong>Overrides & Revisions:</strong> Only Admins can force-Close,
            Reopen, or manually revert approved documents for critical
            revisions.
          </li>
        }
        @if (role === 'CUSTOMER') {
          <li>
            <strong>Visibility:</strong> Customers have secure, read-only
            visibility into reports only once they achieve an Approved or Closed
            status.
          </li>
        }
      </ul>
    </section>
  `,
})
export class HelpReportLifecycleSectionComponent {
  @Input() role!: AppRole;
}
