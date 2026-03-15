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
  @Input() hasGeneratedChildReport = false;
  @Input() isGenerating = false;

  @Output() generateChildReport = new EventEmitter<void>();

  protected readonly APP_ROLES = APP_ROLES;

  protected canGenerate(): boolean {
    return (
      !this.hasGeneratedChildReport &&
      this.items.length > 0 &&
      (this.userRole === APP_ROLES.INSPECTOR ||
        this.userRole === APP_ROLES.SUPERVISOR ||
        this.userRole === APP_ROLES.ADMIN)
    );
  }

  protected areAllSerialsApproved(): boolean {
    return this.items.length > 0 && this.items.every(
      (item) => item.sn.approvalStatus === 'APPROVED'
    );
  }

  protected isWaitingForApproval(): boolean {
    return this.canGenerate() && !this.areAllSerialsApproved();
  }

  protected missingChildCount(): number {
    return this.items.filter((item) => !item.childLinked).length;
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
