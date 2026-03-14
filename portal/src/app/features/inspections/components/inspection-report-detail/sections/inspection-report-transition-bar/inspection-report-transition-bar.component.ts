import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LocalInspectionReport } from '@portal/core/offline/models/types';
import { ValidationResult } from '@portal/core/validation/services/report-validation.service';

type TransitionChoice = {
  toStatus: string;
  requiresReason: boolean;
  enabled: boolean;
  label?: string;
  disabledReason?: string;
};

type SelectedTransition = {
  toStatus: string;
  requiresReason: boolean;
  label?: string;
};

@Component({
  selector: 'app-inspection-report-transition-bar',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './inspection-report-transition-bar.component.html',
  host: {
    class: 'block w-full',
  },
})
export class InspectionReportTransitionBarComponent {
  @Input() report: LocalInspectionReport | null = null;
  @Input() expanded = true;
  @Input() allowedTransitions: TransitionChoice[] = [];
  @Input() selectedTransition: SelectedTransition | null = null;
  @Input() formReason = '';
  @Input() formError = '';
  @Input() validationResult: ValidationResult | null = null;
  @Input() isOnline = false;
  @Input() showExport = false;
  @Input() canExport = false;
  @Input() exportDisabledReason = '';
  @Input() isExporting = false;

  @Output() expandedChange = new EventEmitter<boolean>();
  @Output() export = new EventEmitter<void>();
  @Output() showValidationDetails = new EventEmitter<void>();
  @Output() selectTransition = new EventEmitter<SelectedTransition>();
  @Output() formReasonChange = new EventEmitter<string>();
  @Output() confirmTransition = new EventEmitter<void>();
  @Output() cancelTransition = new EventEmitter<void>();

  protected toggleExpanded(): void {
    this.expandedChange.emit(!this.expanded);
  }
}
