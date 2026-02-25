import { Component, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, NgForm } from '@angular/forms';
import { ViewChild } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { SessionService, UserProfile } from '../core/auth/session.service';
import { ConnectivityService } from '../core/offline/connectivity.service';import { environment } from '../../environments/environment';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.component.html',
})
export class LoginComponent {
  private cdr = inject(ChangeDetectorRef);
  private http = inject(HttpClient);
  private session = inject(SessionService);
  private router = inject(Router);
  public connectivity = inject(ConnectivityService);

  public email = '';
  public password = '';
  public formError = '';
  public isLoading = false;
  public showPassword = false;

  @ViewChild('loginForm') loginForm!: NgForm;

  public togglePassword() {
    this.showPassword = !this.showPassword;
  }

  public async onSubmit() {
    this.formError = '';

    if (!this.connectivity.isOnline()) {
      this.formError = 'Connection required to sign in.';
      return;
    }

    if (this.loginForm && this.loginForm.invalid) {
      Object.values(this.loginForm.controls).forEach(control => {
        control.markAsTouched();
      });
      return;
    }

    if (!this.email || !this.password) {
      this.formError = 'Email and password are required.';
      return;
    }

    this.isLoading = true;

    try {
      const normalizedEmail = this.email.toLowerCase().trim();
      const response = await firstValueFrom(this.http.post<{ user: UserProfile, accessToken: string, refreshToken: string }>(`${environment.apiUrl}/auth/login`, {
        email: normalizedEmail,
        password: this.password,
      }));

      this.session.setSession(response.accessToken, response.refreshToken, response.user);

      if (response.user.mustChangePassword) {
        this.router.navigate(['/change-password']);
      } else {
        this.router.navigate(['/admin']);
      }
    } catch (err: unknown) {
      const error = err as { error?: { message?: string | string[], error?: string }, message?: string };
      console.error('Login error:', error);
      let errorMsg = 'Login failed. Please check your credentials.';
      if (error && error.error) {
        if (Array.isArray(error.error.message)) {
          errorMsg = error.error.message.join(', ');
        } else if (typeof error.error.message === 'string') {
          errorMsg = error.error.message;
        } else if (typeof error.error.error === 'string') {
          errorMsg = error.error.error;
        }
      } else if (error && error.message) {
        errorMsg = error.message;
      }
      this.formError = errorMsg;
    } finally {
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }
}
