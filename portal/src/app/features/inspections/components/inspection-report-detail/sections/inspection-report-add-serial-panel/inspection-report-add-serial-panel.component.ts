import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-inspection-report-add-serial-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './inspection-report-add-serial-panel.component.html',
  host: {
    class: 'block w-full xl:w-[320px] shrink-0',
  },
})
export class InspectionReportAddSerialPanelComponent {
  @Input() value = '';
  @Input() enabled = false;

  @Output() valueChange = new EventEmitter<string>();
  @Output() addSerials = new EventEmitter<void>();

  protected onSubmit(): void {
    this.addSerials.emit();
  }
}
