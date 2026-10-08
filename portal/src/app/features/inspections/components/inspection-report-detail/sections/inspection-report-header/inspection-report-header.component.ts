import {
  ExportSplitButtonComponent,
  ExportFormat,
} from '@portal/shared/components/export-split-button/export-split-button.component';
import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { RouterModule } from '@angular/router';
import { APP_ROLES } from '@portal/core/constants/app.constants';
/** The few fields the header reads — a parent report or a child report both satisfy it. */
export interface HeaderReportView {
  reportNumber?: string | null;
  status: string;
  poNumber?: string | null;
  updatedAt?: string | null;
}

@Component({
  selector: 'app-inspection-report-header',
  standalone: true,
  imports: [CommonModule, RouterModule, ExportSplitButtonComponent],
  templateUrl: './inspection-report-header.component.html',
  host: {
    class: 'block w-full',
  },
})
export class InspectionReportHeaderComponent {
  @Input({ required: true }) report!: HeaderReportView;
  /** Heading prefix: "Report" for a parent, e.g. "Rework Report" for a child. */
  @Input() titlePrefix = 'Report';
  /** Where the back arrow goes; null keeps the relative `..` used by the parent. */
  @Input() backLink: string[] | null = null;
  @Input() backTitle = 'Back to reports';
  /** When set, the PO chip links here (a child links back to its parent report). */
  @Input() poLink: string[] | null = null;
  @Input() userRole = '';
  @Input() isExporting = false;
  @Input() isOnline = false;
  @Input() isCondensed = false;
  @Input() condenseProgress = 0;
  @Input() showCustomerExport = false;
  @Input() canExport = false;
  @Input() exportDisabledReason = '';
  @Input() hasWorkflowActions = false;

  @Output() export = new EventEmitter<ExportFormat>();
  @Output() openWorkflow = new EventEmitter<void>();

  protected readonly APP_ROLES = APP_ROLES;

  protected onExport(format: ExportFormat): void {
    this.export.emit(format);
  }

  protected onOpenWorkflow(): void {
    this.openWorkflow.emit();
  }
}
