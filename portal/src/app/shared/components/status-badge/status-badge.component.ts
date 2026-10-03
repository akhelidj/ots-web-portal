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
  /**
   * Label typeface. Defaults to `'condensed'` (Barlow Condensed) so every
   * existing call site — including the ops-shared header-field "System" badge —
   * renders exactly as before. The customer document surfaces opt into `'sans'`
   * (IBM Plex) so their status labels match that surface's IBM-Plex label
   * treatment without changing the badge anywhere else.
   */
  font = input<'condensed' | 'sans'>('condensed');

  fontClass = computed(() =>
    this.font() === 'sans' ? 'font-sans' : 'font-condensed',
  );

  // Token-backed classes (semantic color scale from tailwind.config → :root vars),
  // never raw palette. `neutral` uses the muted surface token (solid, no alpha) with
  // `text-foreground` for the label — muted-foreground on muted is only 4.12:1 (fails AA
  // for this 10px label); foreground on muted is 12.66:1. success/warning/error use their
  // light/dark/DEFAULT token scale; `info` has no dedicated token, so it maps to primary.
  classes = computed(() => {
    switch (this.severity()) {
      case 'success':
        return 'bg-success-light text-success-dark border-success';
      case 'warning':
        return 'bg-warning-light text-warning-dark border-warning';
      case 'error':
        return 'bg-error-light text-error-dark border-error';
      case 'info':
        return 'bg-primary/10 text-primary border-primary/40';
      case 'neutral':
      default:
        return 'bg-muted text-foreground border-border';
    }
  });
}
