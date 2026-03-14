import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { LocalTransitionLog } from '@portal/core/offline/models/types';

@Component({
  selector: 'app-inspection-report-transition-history',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './inspection-report-transition-history.component.html',
  host: {
    class: 'block w-full',
  },
})
export class InspectionReportTransitionHistoryComponent {
  @Input() logs: LocalTransitionLog[] = [];
}
