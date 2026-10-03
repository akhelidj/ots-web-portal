import {
  Component,
  OnDestroy,
  OnInit,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import {
  SessionService,
  UserProfile,
} from '@portal/core/auth/services/session.service';
import { ConnectivityService } from '@portal/core/offline/services/connectivity.service';
import { environment } from '@app-env/environment';

import { UserPreferencesService } from '@portal/core/services/user-preferences.service';
import { SignatureService } from '@portal/core/auth/services/signature.service';
import { SignatureDialogComponent } from '@portal/shared/components/signature-dialog/signature-dialog.component';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, SignatureDialogComponent],
  templateUrl: './settings.component.html',
})
export class SettingsComponent implements OnInit, OnDestroy {
  private http = inject(HttpClient);
  private session = inject(SessionService);
  private router = inject(Router);
  private signatures = inject(SignatureService);
  public connectivity = inject(ConnectivityService);
  public prefs = inject(UserPreferencesService);

  /** Customers and receivers sign nothing from their account. */
  public hasSignatureRole = computed(() =>
    ['INSPECTOR', 'SUPERVISOR', 'ADMIN'].includes(
      this.session.profile()?.role ?? '',
    ),
  );
  public hasSignature = computed(
    () => this.session.profile()?.hasSignature === true,
  );
  public signatureDialogOpen = signal(false);
  public signaturePreviewUrl = signal<string | null>(null);

  constructor() {
    // Refetch the preview whenever a signature is saved (or the flag flips to true).
    effect(() => {
      this.signatures.version();
      if (this.hasSignature()) void this.loadPreview();
    });
  }

  ngOnInit(): void {
    void this.signatures.refreshStatus();
  }

  ngOnDestroy(): void {
    this.revokePreview();
  }

  public onSignatureSaved(): void {
    this.signatureDialogOpen.set(false);
  }

  private async loadPreview(): Promise<void> {
    if (!this.connectivity.isOnline()) return;
    try {
      const url = await this.signatures.getImageUrl();
      this.revokePreview();
      this.signaturePreviewUrl.set(url);
    } catch (e) {
      console.warn('Could not load signature preview', e);
    }
  }

  private revokePreview(): void {
    const url = this.signaturePreviewUrl();
    if (url) URL.revokeObjectURL(url);
    this.signaturePreviewUrl.set(null);
  }

  public currentPassword = '';
  public newPassword = '';
  public confirmPassword = '';

  public formError = '';
  public formSuccess = '';
  public isLoading = false;

  public showCurrentPassword = false;
  public showNewPassword = false;
  public showConfirmPassword = false;

  public toggleCurrentPassword() {
    this.showCurrentPassword = !this.showCurrentPassword;
  }
  public toggleNewPassword() {
    this.showNewPassword = !this.showNewPassword;
  }
  public toggleConfirmPassword() {
    this.showConfirmPassword = !this.showConfirmPassword;
  }

  public async onSubmit() {
    this.formError = '';
    this.formSuccess = '';

    if (!this.connectivity.isOnline()) {
      this.formError =
        'A network connection is required to change your password.';
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
      const response = await firstValueFrom(
        this.http.post<{
          user: UserProfile;
          accessToken: string;
          refreshToken: string;
        }>(`${environment.apiUrl}/auth/change-password`, {
          currentPassword: this.currentPassword,
          newPassword: this.newPassword,
        }),
      );

      // Store fresh tokens and profile where mustChangePassword is now false
      const userProfile: UserProfile = {
        id: response.user.id,
        email: response.user.email,
        name: response.user.name,
        role: response.user.role,
        tenantId: response.user.tenantId,
        tenant: response.user.tenant,
        customerId: response.user.customerId,
        customer: response.user.customer,
        mustChangePassword: response.user.mustChangePassword,
        hasSignature: response.user.hasSignature,
      };

      this.session.setSession(
        response.accessToken,
        response.refreshToken,
        userProfile,
      );

      this.formSuccess = 'Password changed successfully. Redirecting...';

      // Force a tiny visual delay for UX
      setTimeout(() => {
        this.router.navigate(['/']);
      }, 1000);
    } catch (error) {
      const e = error as Error;
      this.formError = e.message;
    } finally {
      this.isLoading = false;
    }
  }

  public onToggleCompactMode(enabled: boolean) {
    this.prefs.setCompactMode(enabled);
  }

  public isCompactMode() {
    return this.prefs.preferences().compactMode;
  }
}
