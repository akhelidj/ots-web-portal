import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import {
  SERIAL_DISPOSITIONS,
  SerialDisposition,
} from '@portal/core/constants/app.constants';

@Component({
  selector: 'app-inspection-report-kpi-overview',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './inspection-report-kpi-overview.component.html',
  host: {
    class: 'block w-full',
  },
})
export class InspectionReportKpiOverviewComponent {
  @Input() total = 0;
  @Input() passed = 0;
  @Input() rework = 0;
  @Input() scrap = 0;
  @Input() passRate = 0;

  @Output() dispositionOpen = new EventEmitter<SerialDisposition>();

  protected readonly SERIAL_DISPOSITIONS = SERIAL_DISPOSITIONS;

  protected open(status: SerialDisposition): void {
    this.dispositionOpen.emit(status);
  }
}
