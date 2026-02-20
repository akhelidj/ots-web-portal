import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { SessionService } from '../core/auth/session.service';
import { ConnectivityService } from '../core/offline/connectivity.service';import { environment } from '../../environments/environment';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.component.html',
})
export class LoginComponent {
  private http = inject(HttpClient);
  private session = inject(SessionService);
  private router = inject(Router);
  public connectivity = inject(ConnectivityService);

  public email = '';
  public password = '';
  public formError = '';
  public isLoading = false;

  public async onSubmit() {
    this.formError = '';

    if (!this.connectivity.isOnline()) {
      this.formError = 'Connection required to sign in.';
      return;
    }

    if (!this.email || !this.password) {
      this.formError = 'Email and password are required.';
      return;
    }

    this.isLoading = true;

    try {
      const response = await this.http.post<any>(`${environment.apiUrl}/auth/login`, {
        email: this.email,
        password: this.password,
      }).toPromise();

      this.session.setSession(response.accessToken, response.refreshToken, response.user);

      if (response.user.mustChangePassword) {
        this.router.navigate(['/change-password']);
      } else {
        this.router.navigate(['/admin']);
      }
    } catch (e: any) {
      this.formError = e.error?.message || 'Login failed. Please check your credentials.';
    } finally {
      this.isLoading = false;
    }
  }
}
