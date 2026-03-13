import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { InspectionReportListComponent } from '@portal/features/inspections/components/inspection-report-list/inspection-report-list.component';
import { REPORT_STATUSES } from '@portal/core/constants/app.constants';

@Component({
  selector: 'app-supervisor-workspace',
  standalone: true,
  imports: [CommonModule, InspectionReportListComponent],
  template: `
    <app-inspection-report-list [initialStatusFilter]="REPORT_STATUSES.IN_INSPECTION"></app-inspection-report-list>
  `
})
export class SupervisorWorkspaceComponent {
  protected REPORT_STATUSES = REPORT_STATUSES;
}
