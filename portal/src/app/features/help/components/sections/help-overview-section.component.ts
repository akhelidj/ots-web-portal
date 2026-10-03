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
      <h2 class="mt-2 text-xl tracking-tight text-neutral-900">
        Daily workflow in Trackline
      </h2>
      <div class="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
        <div class="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
          <p class="font-semibold text-neutral-800">1. Open your workspace</p>
          <p class="mt-1 text-neutral-600">
            @if (role === 'RECEIVER') {
              Receiver Workspace: the intake queue. Search by PO or serial,
              filter by status or customer, and open a report.
            } @else if (role === 'INSPECTOR') {
              Inspector Workspace: the inspection queue. Search by PO or serial,
              filter by status or customer, and open a report.
            } @else if (role === 'SUPERVISOR') {
              Approval Workspace: the review queue. Search by PO or serial,
              filter by status or customer, and open a report.
            } @else if (role === 'ADMIN') {
              Use the top navigation: Users, Customers, Reports and Templates.
            } @else {
              Customer Portal: your organization's reports, with Total, Open and
              Closed counts you can click to filter.
            }
          </p>
        </div>
        <div class="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
          <p class="font-semibold text-neutral-800">
            2. Execute assigned actions
          </p>
          <p class="mt-1 text-neutral-600">
            @if (role === 'RECEIVER') {
              Create reports, register the serial numbers received, and move
              them from Draft to Ready for Inspection.
            } @else if (role === 'INSPECTOR') {
              Start the inspection, fill in each serial's form, set
              dispositions, add report statistics, and submit serials for
              approval.
            } @else if (role === 'SUPERVISOR') {
              Review submitted batches, approve or return serials, place reports
              on hold, and manage template uploads.
            } @else if (role === 'ADMIN') {
              Manage users, customers and templates, create reports, and
              override or reopen reports when needed.
            } @else {
              Open a report to read its specifications, findings, serials, child
              reports, statistics and documents; sign when asked; export once it
              is approved.
            }
          </p>
        </div>
        <div class="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
          <p class="font-semibold text-neutral-800">3. Keep sync healthy</p>
          <p class="mt-1 text-neutral-600">
            @if (role === 'CUSTOMER') {
              Reports you have opened stay readable offline and refresh when you
              reconnect.
            } @else {
              Work offline if needed, then reconnect and let the app
              synchronize. Exports, signatures and file uploads need a
              connection.
            }
          </p>
        </div>
      </div>
    </section>
  `,
})
export class HelpOverviewSectionComponent {
  @Input() role!: AppRole;
}
