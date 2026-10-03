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
      <h2 class="mt-2 text-xl tracking-tight text-neutral-900">
        Inspection report lifecycle
      </h2>
      <p class="mt-3 text-sm text-neutral-600">
        Reports move through controlled statuses: Draft, Received, Ready for
        Cleaning, Ready for Inspection, In Inspection, Pending Approval,
        Approved, On Hold and Closed. Status changes are made from the
        <strong>Workflow Actions</strong> panel on the report; an action that
        needs a reason (Hold, Reopen) asks for it and the reason is kept in the
        Activity tab.
      </p>
      <ul class="mt-4 space-y-2 text-sm text-neutral-700">
        @if (role === 'RECEIVER' || role === 'ADMIN') {
          <li>
            <strong>Creation:</strong> Use "Create Report": choose the Customer,
            enter the PO Number and pick a Template (only approved, defined
            templates are offered). The report number is generated
            automatically.
          </li>
          <li>
            <strong>Prep workflow:</strong> Draft &rarr; Received &rarr; Ready
            for Cleaning &rarr; Ready for Inspection. While the report is in
            Draft, Received or Ready for Cleaning you can add serial numbers
            (paste one per line in "Register Inventory"), rename and remove
            them.
          </li>
        }
        @if (role === 'INSPECTOR' || role === 'ADMIN') {
          <li>
            <strong>Inspection:</strong> "Start Inspection" moves a report from
            Ready for Inspection to In Inspection, where you can log data. You
            can also place an In Inspection report On Hold (reason required).
          </li>
        }
        @if (role === 'SUPERVISOR' || role === 'ADMIN') {
          <li>
            <strong>Prep &amp; start:</strong> You can move a report through
            Received &rarr; Ready for Cleaning &rarr; Ready for Inspection
            &rarr; In Inspection, and put it On Hold (reason required) at any
            active status. The only intake step reserved to Receivers and Admins
            is Draft &rarr; Received.
          </li>
          <li>
            <strong>Review:</strong> From Pending Approval you can Approve,
            return the report to In Inspection, put it On Hold or Close it.
            Approved reports can be put On Hold or Closed. Reports also become
            Approved automatically once every submitted batch is approved (see
            Approvals).
          </li>
          <li>
            <strong>On Hold:</strong> "Release Hold" returns the report to the
            status it was in before the hold; it can also be Closed.
          </li>
        }
        @if (role === 'ADMIN') {
          <li>
            <strong>Overrides &amp; revisions:</strong> Admins can Close a
            report from any status (Supervisors only from Pending Approval,
            Approved or On Hold). Only Admins can reopen: an Approved report
            back to In Inspection, or a Closed report back to Approved or In
            Inspection (reason required). Reopening starts a new revision;
            earlier revisions stay available for export.
          </li>
        }
        @if (role === 'CUSTOMER') {
          <li>
            <strong>Visibility:</strong> You see every report of your
            organization, in any status, read-only. Total, Open (not Closed) and
            Closed counts at the top filter the list; search by PO or serial
            number, and sort by last update, PO or status.
          </li>
          <li>
            <strong>Report page:</strong> One scrolling document: summary,
            specifications, findings (statistics), serials, child reports,
            documents and history.
          </li>
        } @else {
          <li>
            <strong>Report page tabs:</strong> Summary (header details and
            inspector comments), Pipes (the serial list), Approvals (appears
            once a batch has been submitted), Specs (the template's job data)
            and Activity (status history).
          </li>
          <li>
            <strong>Locked reports:</strong> Once Approved or Closed, a report's
            data, statistics and attachments cannot be edited. Only an Admin
            reopening it unlocks it.
          </li>
        }
      </ul>
    </section>
  `,
})
export class HelpReportLifecycleSectionComponent {
  @Input() role!: AppRole;
}
