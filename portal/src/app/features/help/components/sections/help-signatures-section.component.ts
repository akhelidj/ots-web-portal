import { Component, Input } from '@angular/core';
import { AppRole } from '@portal/core/constants/app.constants';

@Component({
  selector: 'app-help-signatures-section',
  standalone: true,
  template: `
    <section
      class="rounded-2xl border border-neutral-200 bg-white p-6 sm:p-8 shadow-sm"
    >
      <p class="text-xs uppercase tracking-[0.1em] text-neutral-500">
        Signatures
      </p>
      <h2 class="mt-2 text-xl tracking-tight text-neutral-900">
        Signing reports
      </h2>
      <ul class="mt-4 space-y-2 text-sm text-neutral-700">
        @if (role === 'INSPECTOR') {
          <li>
            <strong>Account signature:</strong> Draw your signature once. Until
            you do, a "Signature required" prompt blocks the workspace. It is
            applied automatically when you submit; you can replace it in
            Settings.
          </li>
          <li>
            <strong>Frozen at submission:</strong> The export embeds the
            signature you had when you submitted, even if you change it later.
          </li>
        }
        @if (role === 'SUPERVISOR' || role === 'ADMIN') {
          <li>
            <strong>Supervisor fields:</strong> You never sign per report.
            Approving applies your account signature (Settings &rarr; My
            Signature) to the template's supervisor-signed fields.
          </li>
        }
        @if (role === 'ADMIN') {
          <li>
            <strong>Inspectors:</strong> Inspector signatures are mandatory in
            every template and are registered by each inspector.
          </li>
        }
        @if (role === 'CUSTOMER') {
          <li>
            <strong>Signing:</strong> Once a report is Approved (or Closed),
            signature fields assigned to the customer show a "Sign" button in
            the report's Signatures panel. Draw in the box and confirm; the
            signature applies to that report only.
          </li>
          <li>
            <strong>Signature pending:</strong> Your workspace lists approved
            reports waiting for your signature, with a button per field.
          </li>
        } @else {
          <li>
            <strong>Report signatures:</strong> The report's Signatures panel
            shows who signed each field and when. If a report is reopened, field
            signatures are cleared for the new revision; earlier revisions keep
            theirs.
          </li>
        }
        <li>
          <strong>Export:</strong> A required field that is still unsigned
          blocks the export of the current revision.
        </li>
      </ul>
    </section>
  `,
})
export class HelpSignaturesSectionComponent {
  @Input() role!: AppRole;
}
