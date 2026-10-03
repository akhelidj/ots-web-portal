import { Component, inject, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { SessionService } from '@portal/core/auth/services/session.service';
import { RoleLandingService } from '@portal/core/auth/services/role-landing.service';

@Component({
  selector: 'app-landing',
  standalone: true,
  template: '',
})
export class LandingComponent implements OnInit {
  private session = inject(SessionService);
  private router = inject(Router);
  private roleLanding = inject(RoleLandingService);

  ngOnInit() {
    if (!this.session.isAuthenticated()) {
      this.router.navigate(['/login']);
      return;
    }

    if (this.session.mustChangePassword()) {
      this.router.navigate(['/change-password']);
      return;
    }

    // Fallback to RoleLandingService for the proper redirect
    const currentRole = this.session.profile()?.role;

    if (currentRole) {
      this.router.navigate(this.roleLanding.getLandingRoute(currentRole));
    } else {
      this.router.navigate(['/login']);
    }
  }
}
