import { Component, Input } from '@angular/core';
import { AppRole } from '@portal/core/constants/app.constants';

@Component({
  selector: 'app-help-exports-section',
  standalone: true,
  template: `
    <section
      class="rounded-2xl border border-neutral-200 bg-white p-6 sm:p-8 shadow-sm"
    >
      <p class="text-xs uppercase tracking-[0.1em] text-neutral-500">Exports</p>
      <h2 class="mt-2 text-xl tracking-tight text-neutral-900">
        Approved report document export
      </h2>
      <ul class="mt-4 space-y-2 text-sm text-neutral-700">
        <li>
          <strong>Who:</strong> Customers, Supervisors and Admins see the
          "Export PDF" split button.
        </li>
        <li>
          <strong>Formats:</strong> The main click downloads the filled report
          as a PDF. The arrow next to it also offers the filled Excel workbook
          and the blank Template (the workbook with its tokens). PDF and Excel
          follow the availability and signature rules below; the Template needs
          only a connection.
        </li>
        <li>
          <strong>Availability:</strong> The button is enabled only when the
          report is Approved or Closed. A child report can be exported once it
          (or its parent) is Approved or Closed.
        </li>
        <li>
          <strong>Uploaded files:</strong> If the report has uploaded files (the
          Documents section), the PDF or Excel export downloads as a zip: the
          report at the top level and the original files, untouched, in an
          "attachments" folder. With no uploaded files you get the single file.
        </li>
        <li>
          <strong>Connectivity:</strong> Online connectivity is required to
          generate and download the document.
        </li>
        <li>
          <strong>Signatures:</strong> If the template has a required signature
          field that is still unsigned (typically the customer's), the export of
          the current revision is blocked with a "signature pending" message
          until it is signed. Unsigned optional fields are left blank. The
          inspector's signature is the one frozen when the report was submitted.
        </li>
        <li>
          <strong>Format:</strong> The export is built from the approved
          revision's snapshot, so it embeds the final inspection data, approval
          attribution and signatures; reopening a report creates a new revision
          without altering earlier ones.
        </li>
      </ul>
    </section>
  `,
})
export class HelpExportsSectionComponent {
  @Input() role!: AppRole;
}
