import { Injectable, signal } from '@angular/core';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** `danger` styles the confirm button as destructive. */
  tone?: 'default' | 'danger';
  /** Adds a reason textarea; the confirm button stays disabled while it is blank. */
  reason?: { label: string; placeholder?: string };
}

export interface ConfirmResult {
  confirmed: boolean;
  /** Trimmed reason text — only set when the dialog asked for one. */
  reason: string;
}

export interface ConfirmRequest extends ConfirmOptions {
  resolve: (result: ConfirmResult) => void;
}

/**
 * In-app replacement for the browser's `confirm()` / `prompt()`. One dialog at a time,
 * rendered by `<app-confirm-dialog>` in the app root; callers just await the answer.
 */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  public readonly request = signal<ConfirmRequest | null>(null);

  /** Resolves true on confirm, false on cancel / Escape / backdrop click. */
  public async confirm(options: ConfirmOptions): Promise<boolean> {
    return (await this.ask(options)).confirmed;
  }

  /** Confirm with a required reason. Resolves the reason, or null when cancelled. */
  public async confirmWithReason(
    options: ConfirmOptions & { reason: NonNullable<ConfirmOptions['reason']> },
  ): Promise<string | null> {
    const result = await this.ask(options);
    return result.confirmed ? result.reason : null;
  }

  public close(result: ConfirmResult): void {
    const current = this.request();
    if (!current) return;
    this.request.set(null);
    current.resolve(result);
  }

  private ask(options: ConfirmOptions): Promise<ConfirmResult> {
    // A dialog already open is dismissed as "cancelled" rather than stacked.
    this.close({ confirmed: false, reason: '' });
    return new Promise((resolve) => this.request.set({ ...options, resolve }));
  }
}
