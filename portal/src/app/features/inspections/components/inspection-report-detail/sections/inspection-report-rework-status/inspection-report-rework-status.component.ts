import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { RouterModule } from '@angular/router';
import { APP_ROLES } from '@portal/core/constants/app.constants';
import {
  LocalChildReport,
  LocalInspectionReport,
  LocalSerialNumber,
} from '@portal/core/offline/models/types';

type ReworkItem = {
  sn: LocalSerialNumber;
  childLinked: LocalChildReport | null;
};

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
  @Input() items: ReworkItem[] = [];
  /**
   * True when the report's definition carries an authored rework rule (#8a). The card and
   * the Generate button surface off THIS as well as off `items`, because the server
   * evaluates the rule on demand against every serial — so a configured rule must stay
   * discoverable even before (or without) any serial the client already reads as REWORK.
   */
  @Input() reworkConfigured = false;
  @Input() hasGeneratedChildReport = false;
  @Input() isGenerating = false;
  @Input() isCompactMode = false;

  @Output() generateChildReport = new EventEmitter<void>();

  protected readonly APP_ROLES = APP_ROLES;

  /** Show the whole card when there are rework serials OR a rule is configured. */
  protected get isVisible(): boolean {
    return this.items.length > 0 || this.reworkConfigured;
  }

  protected canGenerate(): boolean {
    return (
      !this.hasGeneratedChildReport &&
      (this.items.length > 0 || this.reworkConfigured) &&
      (this.userRole === APP_ROLES.INSPECTOR ||
        this.userRole === APP_ROLES.SUPERVISOR ||
        this.userRole === APP_ROLES.ADMIN)
    );
  }

  protected areAllSerialsApproved(): boolean {
    return (
      this.items.length > 0 &&
      this.items.every((item) => item.sn.approvalStatus === 'APPROVED')
    );
  }

  protected isWaitingForApproval(): boolean {
    // Approval-gating only applies when there ARE rework serials to approve. With a rule
    // configured but no client-side REWORK serials, there is nothing to wait on — the
    // server evaluates the rule against every serial when the button fires.
    return (
      this.items.length > 0 &&
      this.canGenerate() &&
      !this.areAllSerialsApproved()
    );
  }

  protected missingChildCount(): number {
    return this.items.filter((item) => !item.childLinked).length;
  }

  protected childRoute(childId: string): string[] {
    return ['/', this.userRole.toLowerCase(), 'reports', childId, 'child'];
  }

  protected get existingChildReportId(): string | null {
    const item = this.items.find((i) => i.childLinked);
    return item?.childLinked?.id ?? null;
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
