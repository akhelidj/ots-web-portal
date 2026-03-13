import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { InspectionReportListComponent } from '@portal/features/inspections/components/inspection-report-list/inspection-report-list.component';

@Component({
  selector: 'app-receiver-workspace',
  standalone: true,
  imports: [CommonModule, InspectionReportListComponent],
  templateUrl: './receiver-workspace.component.html',
})
export class ReceiverWorkspaceComponent {}
