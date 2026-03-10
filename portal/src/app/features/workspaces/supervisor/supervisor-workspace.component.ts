import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { InspectionReportListComponent } from '@portal/features/inspections/components/inspection-report-list/inspection-report-list.component';

@Component({
  selector: 'app-supervisor-workspace',
  standalone: true,
  imports: [CommonModule, InspectionReportListComponent],
  template: `
    <app-inspection-report-list [initialStatusFilter]="'PENDING_APPROVAL'"></app-inspection-report-list>
  `
})
export class SupervisorWorkspaceComponent {}
