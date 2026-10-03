import { Component, Input } from '@angular/core';
import { AppRole } from '@portal/core/constants/app.constants';

/**
 * The template authoring workflow — shown to the two roles that can reach the Templates
 * page: ADMIN and SUPERVISOR. Both walk the same upload → define path; they differ only
 * at the validation gate, so the third card branches on the role instead of this being
 * two near-identical sections.
 */
@Component({
  selector: 'app-help-templates-section',
  standalone: true,
  template: `
    <section
      class="rounded-2xl border border-neutral-200 bg-white p-6 sm:p-8 shadow-sm"
    >
      <p class="text-xs uppercase tracking-[0.1em] text-neutral-500">
        Templates
      </p>
      <h2 class="mt-2 text-xl tracking-tight text-neutral-900">
        Uploading and defining inspection templates
      </h2>
      <div
        class="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm text-neutral-700"
      >
        <div class="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
          <p class="font-semibold text-neutral-900">1. Upload the workbook</p>
          <p class="mt-1">
            Give the template a key and a change note, and attach the Excel
            workbook (.xlsx). Each upload creates a new version of that key —
            existing versions are never edited in place. Uploads need a
            connection.
          </p>
        </div>
        <div class="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
          <p class="font-semibold text-neutral-900">2. Define the form</p>
          <p class="mt-1">
            Open the version's definition wizard: <em>Detect Tokens</em> (the
            fields found in the workbook), <em>Metadata</em> (fields that
            describe the whole report, with system roles such as customer,
            report number, PO number, inspector, supervisor, inspection date and
            inspector signature), <em>Serial</em> (fields recorded for every
            serial; exactly one is the Serial Number) and
            <em>Review &amp; Save</em>. Metadata fields can also be
            <em>signature</em> fields, signed by the Customer or by the
            Supervisor, optionally required for export. The review step can add
            a display name and a rework trigger rule (field, value, child report
            type, number suffix). A saved definition is read-only. A version
            with no definition can never back a report.
          </p>
        </div>
        @if (role === 'SUPERVISOR') {
          <div
            class="rounded-xl border border-warning/40 bg-warning-light/20 p-4"
          >
            <p class="font-semibold text-neutral-900">
              3. Wait for admin validation
            </p>
            <p class="mt-1">
              Versions you upload start as <strong>Pending</strong>. An admin
              has to approve one before reports can be created against it — and
              the version currently in service stays live until they do. If it
              is rejected you will see the reason on the list; upload a new
              version to retry.
            </p>
          </div>
        } @else {
          <div class="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
            <p class="font-semibold text-neutral-900">3. Validate uploads</p>
            <p class="mt-1">
              A supervisor's upload waits as <strong>Pending</strong> until you
              approve it. Approving makes it available for new reports and
              retires the version it replaces; rejecting needs a reason, is
              final for that version, and leaves the live one untouched. Your
              own uploads are approved on upload. You can also Deprecate a
              version.
            </p>
          </div>
        }
      </div>
      <p class="mt-4 text-sm text-neutral-600">
        Receivers and Admins pick among approved, defined templates when
        creating a report; the report stays bound to the version it was created
        with. Statistics are not part of a template: inspectors type them on
        each report.
      </p>
    </section>
  `,
})
export class HelpTemplatesSectionComponent {
  @Input() role!: AppRole;
}
