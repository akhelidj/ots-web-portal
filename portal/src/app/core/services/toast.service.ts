import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

export interface ToastMessage {
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
  title?: string;
}

@Injectable({
  providedIn: 'root'
})
export class ToastService {
  private toastSubject = new Subject<ToastMessage>();
  public toast$ = this.toastSubject.asObservable();

  showError(message: string, title = 'Error') {
    this.toastSubject.next({ message, title, type: 'error' });
  }

  showSuccess(message: string, title?: string) {
    this.toastSubject.next({ message, title, type: 'success' });
  }

  showInfo(message: string, title?: string) {
    this.toastSubject.next({ message, title, type: 'info' });
  }

  showWarning(message: string, title?: string) {
    this.toastSubject.next({ message, title, type: 'warning' });
  }
}
