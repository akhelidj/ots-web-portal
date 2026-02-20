import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { SessionService, UserProfile } from '../core/auth/session.service';
import { ConnectivityService } from '../core/offline/connectivity.service';
import { environment } from '../../environments/environment';

@Component({
  selector: 'app-change-password',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './change-password.component.html',
})
export class ChangePasswordComponent {
  private http = inject(HttpClient);
  private session = inject(SessionService);
  private router = inject(Router);
  public connectivity = inject(ConnectivityService);

  public currentPassword = '';
  public newPassword = '';
  public confirmPassword = '';
  
  public formError = '';
  public formSuccess = '';
  public isLoading = false;

  public async onSubmit() {
    this.formError = '';
    this.formSuccess = '';

    if (!this.connectivity.isOnline()) {
      this.formError = 'A network connection is required to change your password.';
      return;
    }

    if (!this.currentPassword || !this.newPassword || !this.confirmPassword) {
      this.formError = 'All fields are required.';
      return;
    }

    if (this.newPassword !== this.confirmPassword) {
      this.formError = 'New passwords do not match.';
      return;
    }

    if (this.newPassword.length < 8) {
      this.formError = 'New password must be at least 8 characters long.';
      return;
    }

    this.isLoading = true;

    try {
       const response = await this.http.post<any>(`${environment.apiUrl}/auth/change-password`, {
         currentPassword: this.currentPassword,
         newPassword: this.newPassword
       }).toPromise();

       // Store fresh tokens and profile where mustChangePassword is now false
       const userProfile: UserProfile = {
           id: response.user.id,
           email: response.user.email,
           role: response.user.role,
           tenantId: response.user.tenantId,
           mustChangePassword: response.user.mustChangePassword
       };

       this.session.setSession(response.accessToken, response.refreshToken, userProfile);
       
       this.formSuccess = 'Password changed successfully. Redirecting...';
       
       // Force a tiny visual delay for UX
       setTimeout(() => {
           this.router.navigate(['/']); 
       }, 1000);

    } catch (e: any) {
       this.formError = e.error?.message || 'Failed to change password. Ensure your current password is correct.';
    } finally {
       this.isLoading = false;
    }
  }
}
