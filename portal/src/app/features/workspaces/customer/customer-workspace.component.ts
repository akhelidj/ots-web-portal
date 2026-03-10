import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { InspectionReportListComponent } from '@portal/features/inspections/components/inspection-report-list/inspection-report-list.component';

@Component({
  selector: 'app-customer-workspace',
  standalone: true,
  imports: [CommonModule, InspectionReportListComponent],
  template: `
    <app-inspection-report-list></app-inspection-report-list>
  `
})
export class CustomerWorkspaceComponent {}
