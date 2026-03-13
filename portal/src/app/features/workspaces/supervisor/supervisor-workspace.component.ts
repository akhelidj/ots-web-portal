import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { InspectionReportListComponent } from '@portal/features/inspections/components/inspection-report-list/inspection-report-list.component';
import { REPORT_STATUSES } from '@portal/core/constants/app.constants';

@Component({
  selector: 'app-supervisor-workspace',
  standalone: true,
  imports: [CommonModule, InspectionReportListComponent],
  templateUrl: './supervisor-workspace.component.html',
})
export class SupervisorWorkspaceComponent {
  protected REPORT_STATUSES = REPORT_STATUSES;
}
