import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { trigger, transition, style, animate } from '@angular/animations';
import { ToastService, ToastMessage } from '@portal/core/services/toast.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-toast',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './toast.component.html',
  animations: [
    trigger('toastAnimation', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(-1rem) scale(0.95)' }),
        animate('0.2s cubic-bezier(0.4, 0, 0.2, 1)', style({ opacity: 1, transform: 'translateY(0) scale(1)' }))
      ]),
      transition(':leave', [
        animate('0.15s cubic-bezier(0.4, 0, 0.2, 1)', style({ opacity: 0, transform: 'translateY(-0.5rem) scale(0.95)' }))
      ])
    ])
  ]
})
export class ToastComponent implements OnInit, OnDestroy {
  public toasts: (ToastMessage & { id: number })[] = [];
  private toastId = 0;
  private sub?: Subscription;
  private toastService = inject(ToastService);

  ngOnInit() {
    this.sub = this.toastService.toast$.subscribe(toast => {
      setTimeout(() => {
        const newToast = { ...toast, id: this.toastId++ };
        this.toasts.unshift(newToast);

        if (this.toasts.length > 3) {
          this.toasts.pop();
        }

        setTimeout(() => this.removeToast(newToast.id), 5000);
      });
    });
  }

  ngOnDestroy() {
    this.sub?.unsubscribe();
  }

  removeToast(id: number) {
    this.toasts = this.toasts.filter(t => t.id !== id);
  }
}
