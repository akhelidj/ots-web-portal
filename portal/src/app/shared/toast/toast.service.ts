import { Injectable, signal } from '@angular/core';

export interface ToastMessage {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
  title?: string;
}

@Injectable({
  providedIn: 'root'
})
export class ToastService {
  public readonly toasts = signal<ToastMessage[]>([]);
  private toastId = 0;

  showError(message: string, title = 'Error') {
    this.addToast({ id: this.toastId++, message, title, type: 'error' });
  }

  showSuccess(message: string, title?: string) {
    this.addToast({ id: this.toastId++, message, title, type: 'success' });
  }

  showInfo(message: string, title?: string) {
    this.addToast({ id: this.toastId++, message, title, type: 'info' });
  }

  showWarning(message: string, title?: string) {
    this.addToast({ id: this.toastId++, message, title, type: 'warning' });
  }

  private addToast(toast: ToastMessage) {
    this.toasts.update(current => {
      const updated = [toast, ...current];
      if (updated.length > 3) {
        updated.pop();
      }
      return updated;
    });
    setTimeout(() => this.removeToast(toast.id), 5000);
  }

  removeToast(id: number) {
    this.toasts.update(current => current.filter(t => t.id !== id));
  }
}
