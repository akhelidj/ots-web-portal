import {
  Component,
  ElementRef,
  effect,
  inject,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ToastService } from '@portal/shared/toast/toast.service';

/**
 * Toasts render in the browser's top layer (a manual popover), so they sit above everything —
 * including native modal <dialog>s, which no z-index can beat. The popover is re-raised each
 * time a toast appears so it lands above a dialog opened after it.
 *
 * Enter/leave use Angular's native `animate.enter` / `animate.leave` (CSS classes in
 * styles.scss), not `@angular/animations`, whose provider the app does not register.
 */
@Component({
  selector: 'app-toast',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './toast.component.html',
})
export class ToastComponent {
  public toastService = inject(ToastService);
  private layer = viewChild.required<ElementRef<HTMLElement>>('layer');

  constructor() {
    effect(() => {
      const count = this.toastService.toasts().length;
      const el = this.layer().nativeElement;
      if (typeof el.showPopover !== 'function') return; // jsdom / very old browsers
      const open = el.matches(':popover-open');
      if (count > 0) {
        if (open) el.hidePopover(); // re-show → moves to the top of the top layer
        el.showPopover();
      } else if (open) {
        // Wait for the last toast's leave animation before leaving the top layer.
        setTimeout(() => {
          if (
            this.toastService.toasts().length === 0 &&
            el.matches(':popover-open')
          ) {
            el.hidePopover();
          }
        }, 200);
      }
    });
  }
}
