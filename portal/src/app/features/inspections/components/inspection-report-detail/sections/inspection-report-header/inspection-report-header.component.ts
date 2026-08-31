import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { RouterModule } from '@angular/router';
import { APP_ROLES } from '@portal/core/constants/app.constants';
import { LocalInspectionReport } from '@portal/core/offline/models/types';

@Component({
  selector: 'app-inspection-report-header',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './inspection-report-header.component.html',
  host: {
    class: 'block w-full',
  },
})
export class InspectionReportHeaderComponent {
  @Input({ required: true }) report!: LocalInspectionReport;
  @Input() userRole = '';
  @Input() isExporting = false;
  @Input() isOnline = false;
  @Input() isCondensed = false;
  @Input() condenseProgress = 0;
  @Input() showCustomerExport = false;
  @Input() canExport = false;
  @Input() exportDisabledReason = '';
  @Input() hasWorkflowActions = false;

  @Output() export = new EventEmitter<void>();
  @Output() openWorkflow = new EventEmitter<void>();

  protected readonly APP_ROLES = APP_ROLES;

  protected onExport(): void {
    this.export.emit();
  }

  protected onOpenWorkflow(): void {
    this.openWorkflow.emit();
  }
}
