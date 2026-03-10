import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AppRoutes } from '@portal/core/navigation/routes.constants';

@Component({
  selector: 'app-access-denied',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div style="padding: 20px; text-align: center;">
      <h1 style="color: red;">Access Denied</h1>
      <p>You do not have permission to view this page.</p>
      <button (click)="goHome()" style="margin-top: 20px;">Return to Home</button>
    </div>
  `
})
export class AccessDeniedComponent {
  private router = inject(Router);

  goHome() {
    this.router.navigate(['/', AppRoutes.LOGIN]);
  }
}
