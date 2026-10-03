import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { InspectionReportListComponent } from '@portal/features/inspections/components/inspection-report-list/inspection-report-list.component';
import { CustomerSignaturePendingComponent } from './customer-signature-pending.component';

@Component({
  selector: 'app-customer-workspace',
  standalone: true,
  imports: [
    CommonModule,
    InspectionReportListComponent,
    CustomerSignaturePendingComponent,
  ],
  templateUrl: './customer-workspace.component.html',
})
export class CustomerWorkspaceComponent {}
