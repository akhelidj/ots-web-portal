import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AppRoutes } from '@portal/core/navigation/constants/routes.constants';

@Component({
  selector: 'app-access-denied',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './access-denied.component.html'
})
export class AccessDeniedComponent {
  private router = inject(Router);

  goHome() {
    this.router.navigate(['/', AppRoutes.LOGIN]);
  }
}
