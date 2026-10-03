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
        Batch review and approval workflow
      </h2>
      <ul class="mt-4 space-y-2 text-sm text-neutral-700">
        @if (role === 'INSPECTOR' || role === 'ADMIN') {
          <li>
            <strong>Submission:</strong> Select inspected serials in the Pipes
            tab and submit them as a batch. Only inspected, not yet submitted
            serials can be selected.
          </li>
          <li>
            <strong>Returned items:</strong> A returned serial comes back to you
            with the reviewer's notes; fix it and submit it again.
          </li>
        }
        @if (role === 'SUPERVISOR' || role === 'ADMIN') {
          <li>
            <strong>Review:</strong> The Approvals tab lists submitted batches
            (marked as coming from the parent or a child report). Tick the
            serials you want and choose Approve or Return.
          </li>
          <li>
            <strong>Returning:</strong> A return needs a reason. It is stored as
            a return note on each serial.
          </li>
          <li>
            <strong>Automatic approval:</strong> When every serial of the report
            has been approved and every batch is approved, the report becomes
            Approved on its own and appears in Activity. A child report is
            approved the same way when all of its serials are.
          </li>
          <li>
            <strong>Your signature:</strong> Approving applies your account
            signature to any supervisor-signed field of the template. If a
            required one has no registered signature, the approval is refused
            until you register it in Settings.
          </li>
        }
        <li>
          <strong>Traceability:</strong> Returns and status changes are
          recorded; use the History icon on a serial for its return notes and
          the Activity tab for the report.
        </li>
      </ul>
    </section>
  `,
})
export class HelpApprovalsSectionComponent {
  @Input() role!: AppRole;
}
