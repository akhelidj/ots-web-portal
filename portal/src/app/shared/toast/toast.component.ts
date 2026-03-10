import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { trigger, transition, style, animate } from '@angular/animations';
import { ToastService } from '@portal/shared/toast/toast.service';

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
export class ToastComponent {
  public toastService = inject(ToastService);
}
