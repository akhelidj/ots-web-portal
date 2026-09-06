import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { RouterModule } from '@angular/router';
import {
  LocalChildReport,
  LocalInspectionReport,
} from '@portal/core/offline/models/types';

/**
 * Read-only status for the report's rework child. Rework is collected AUTOMATICALLY: when the
 * template defines a rework rule, the parent re-syncs the child after every serial save, so
 * matching serials — including ones inspected later — are folded in without any action here.
 * This card therefore only reports state (the child and its serials, a link to open it); it
 * has no generate button. It surfaces whenever a rule is configured OR a child already exists.
 */
@Component({
  selector: 'app-inspection-report-rework-status',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './inspection-report-rework-status.component.html',
  host: {
    class: 'block w-full',
  },
})
export class InspectionReportReworkStatusComponent {
  @Input() report: LocalInspectionReport | null = null;
  @Input() userRole = '';
  /** The auto-generated rework child report (or null). Its `serialNumbers` are the
   *  authoritative "what's currently in rework". */
  @Input() reworkChild: LocalChildReport | null = null;

  /** Show the card only when at least one serial actually needs rework. A configured rule
   *  with no matching serial (or a retained-but-empty child) stays hidden — nothing to show. */
  protected get isVisible(): boolean {
    return this.reworkSerials.length > 0;
  }

  /** Serials the server's rule actually matched into the child (empty until one matches). */
  protected get reworkSerials(): LocalChildReport['serialNumbers'] {
    return this.reworkChild?.serialNumbers ?? [];
  }

  protected childRoute(childId: string): string[] {
    return ['/', this.userRole.toLowerCase(), 'reports', childId, 'child'];
  }

  protected reportLabel(): string {
    if (!this.report) {
      return '';
    }

    return (
      this.report.reportNumber || this.report.id.substring(0, 8).toUpperCase()
    );
  }
}
