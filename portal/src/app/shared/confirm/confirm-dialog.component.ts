import {
  Component,
  ElementRef,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConfirmService } from './confirm.service';

/** Host for {@link ConfirmService}: a modal with focus on open, Escape / backdrop to cancel. */
@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './confirm-dialog.component.html',
})
export class ConfirmDialogComponent {
  protected confirmService = inject(ConfirmService);
  protected reasonText = signal('');

  private reasonInput =
    viewChild<ElementRef<HTMLTextAreaElement>>('reasonInput');
  private confirmButton =
    viewChild<ElementRef<HTMLButtonElement>>('confirmButton');

  constructor() {
    effect(() => {
      const req = this.confirmService.request();
      this.reasonText.set('');
      if (!req) return;
      // Wait for the dialog to render, then land focus where the user acts next.
      setTimeout(() => {
        (this.reasonInput() ?? this.confirmButton())?.nativeElement.focus();
      }, 0);
    });
  }

  protected canConfirm(): boolean {
    const req = this.confirmService.request();
    return !!req && (!req.reason || this.reasonText().trim().length > 0);
  }

  protected confirm(): void {
    if (!this.canConfirm()) return;
    this.confirmService.close({
      confirmed: true,
      reason: this.reasonText().trim(),
    });
  }

  protected cancel(): void {
    this.confirmService.close({ confirmed: false, reason: '' });
  }

  protected onKeydown(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === 'Escape') this.cancel();
  }
}
