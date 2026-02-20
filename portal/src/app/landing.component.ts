import { Component, inject, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { SessionService } from './core/auth/session.service';

@Component({
  selector: 'app-landing',
  standalone: true,
  template: '',
})
export class LandingComponent implements OnInit {
  private session = inject(SessionService);
  private router = inject(Router);

  ngOnInit() {
    if (!this.session.isAuthenticated) {
      this.router.navigate(['/login']);
      return;
    }

    if (this.session.mustChangePassword) {
      this.router.navigate(['/change-password']);
      return;
    }

    // Default authenticated route (Admin for demo purposes)
    this.router.navigate(['/admin']);
  }
}
