import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { OutcomeBucket } from '@portal/features/templates/schemas/definition-to-form-schema';

/**
 * The ops/customer summary KPI strip — one card per OUTCOME bucket, counts supplied by the
 * detail component's classifier-driven KPIs. Clicking a bucket card emits its `OutcomeBucket`
 * so the parent can open the drill-down list for exactly that bucket. `hold` and `other` cards
 * appear only when non-zero, so a fully-mapped template's strip stays clean; Total and Pass
 * Rate always bookend. No hardcoded disposition tokens — the bucket contract is the only
 * vocabulary here.
 */
@Component({
  selector: 'app-inspection-report-kpi-overview',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './inspection-report-kpi-overview.component.html',
  host: {
    class: 'block w-full',
  },
})
export class InspectionReportKpiOverviewComponent {
  @Input() total = 0;
  @Input() pass = 0;
  @Input() actionRequired = 0;
  @Input() rejected = 0;
  @Input() hold = 0;
  @Input() other = 0;
  @Input() passRate = 0;

  @Output() bucketOpen = new EventEmitter<OutcomeBucket>();

  /** Visible card count — the five fixed cards plus each optional bucket that has serials.
   *  Drives the responsive column count so the strip never leaves a ragged gap. */
  protected get visibleCols(): number {
    return 5 + (this.hold > 0 ? 1 : 0) + (this.other > 0 ? 1 : 0);
  }

  protected open(bucket: OutcomeBucket): void {
    this.bucketOpen.emit(bucket);
  }
}
