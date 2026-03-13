import { Component, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, NgForm } from '@angular/forms';
import { ViewChild } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import {
  SessionService,
  UserProfile,
} from '@portal/core/auth/services/session.service';
import { ConnectivityService } from '@portal/core/offline/services/connectivity.service';
import { environment } from '@app-env/environment';

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
      Object.values(this.loginForm.controls).forEach((control) => {
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
      const response = await firstValueFrom(
        this.http.post<{
          user: UserProfile;
          accessToken: string;
          refreshToken: string;
        }>(`${environment.apiUrl}/auth/login`, {
          email: this.email.toLowerCase().trim(),
          password: this.password,
        }),
      );

      this.session.setSession(
        response.accessToken,
        response.refreshToken,
        response.user,
      );

      if (response.user.mustChangePassword) {
        this.router.navigate(['/change-password']);
      } else {
        this.router.navigate(['/admin']);
      }
    } catch (err: unknown) {
      const error = err as Error;
      console.error('Login error:', err);
      this.formError = error.message;
    } finally {
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }
}
