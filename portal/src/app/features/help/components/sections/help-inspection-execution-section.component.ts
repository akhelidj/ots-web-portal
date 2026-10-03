import { Component, Input } from '@angular/core';
import { AppRole } from '@portal/core/constants/app.constants';

@Component({
  selector: 'app-help-inspection-execution-section',
  standalone: true,
  template: `
    <section
      class="rounded-2xl border border-neutral-200 bg-white p-6 sm:p-8 shadow-sm"
    >
      <p class="text-xs uppercase tracking-[0.1em] text-neutral-500">
        Inspection
      </p>
      <h2 class="mt-2 text-xl tracking-tight text-neutral-900">
        Serial execution during inspection
      </h2>
      <ul class="mt-4 space-y-2 text-sm text-neutral-700">
        @if (role === 'INSPECTOR') {
          <li>
            <strong>Signature first:</strong> Register your signature before
            working on reports (see Signatures). Until then the workspace is
            blocked by a "Signature required" prompt.
          </li>
        }
        <li>
          <strong>Data entry:</strong> In the Pipes tab, use "Inspect" on a
          serial to open its inspection form. The fields come from the report's
          template; required ones must be filled before the report can reach
          Pending Approval. "View Inspection" shows a serial that is already
          submitted or approved.
        </li>
        <li>
          <strong>Dispositions:</strong> Set each serial's disposition (Pass,
          Rework, Scrap, Hold) as part of its form. Every serial needs one
          before the report can be submitted.
        </li>
        <li>
          <strong>Rework:</strong> Serials matching the template's rework rule
          are collected automatically into a child report (see Child Reports);
          the Rework Status card on the report lists them.
        </li>
        <li>
          <strong>Batching:</strong> Tick the serials that are ready (or the
          header checkbox to select all eligible ones), then use the "Submit N
          for Approval" bar. Serials are reviewed in batches.
        </li>
        <li>
          <strong>Locking:</strong> Once submitted, a serial is locked until a
          supervisor returns it. Returned serials show the supervisor's reason
          (the History icon on the serial shows the return history).
        </li>
        <li>
          <strong>Comments &amp; documents:</strong> Add overall inspector
          comments in the Summary tab and attach files to the report while it is
          still editable.
        </li>
      </ul>
    </section>
  `,
})
export class HelpInspectionExecutionSectionComponent {
  @Input() role!: AppRole;
}
