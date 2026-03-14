import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { RouterModule } from '@angular/router';
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
