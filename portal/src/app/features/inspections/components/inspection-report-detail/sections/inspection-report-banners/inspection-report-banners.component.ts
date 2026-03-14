import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

type InspectionBanner = {
  type: 'info' | 'warning' | 'error' | 'success';
  message: string;
};

@Component({
  selector: 'app-inspection-report-banners',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './inspection-report-banners.component.html',
  host: {
    class: 'block w-full',
  },
})
export class InspectionReportBannersComponent {
  @Input() banners: InspectionBanner[] = [];
}
