import { Component, input, computed } from '@angular/core';
import { NgClass } from '@angular/common';

export type BadgeSeverity =
  | 'success'
  | 'warning'
  | 'error'
  | 'info'
  | 'neutral';

@Component({
  selector: 'app-status-badge',
  standalone: true,
  imports: [NgClass],
  templateUrl: './status-badge.component.html',
  styleUrl: './status-badge.component.scss',
})
export class StatusBadgeComponent {
  label = input.required<string>();
  severity = input<BadgeSeverity>('neutral');

  classes = computed(() => {
    switch (this.severity()) {
      case 'success':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'warning':
        return 'bg-amber-100 text-amber-800 border-amber-200';
      case 'error':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'info':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'neutral':
      default:
        return 'bg-neutral-100 text-neutral-800 border-neutral-200';
    }
  });
}
