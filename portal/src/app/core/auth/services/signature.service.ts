import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '@app-env/environment';
import { SessionService } from '@portal/core/auth/services/session.service';
import { ConnectivityService } from '@portal/core/offline/services/connectivity.service';

export interface SignatureStatus {
  hasSignature: boolean;
  updatedAt: string | null;
}

/** Roles that own an account signature (mirrors the API's SignaturesController). */
const SIGNATURE_ROLES = ['INSPECTOR', 'SUPERVISOR', 'ADMIN'];

/**
 * The caller's own account signature. Online-only by nature: the image lives in the
 * server's storage and the "has one" flag is authoritative there. The result is mirrored
 * into the cached profile so the shell gate survives reloads and offline sessions.
 */
@Injectable({ providedIn: 'root' })
export class SignatureService {
  private http = inject(HttpClient);
  private session = inject(SessionService);
  private connectivity = inject(ConnectivityService);

  private readonly url = `${environment.apiUrl}/me/signature`;

  /** Bumped on every successful save so open previews refetch the image. */
  public readonly version = signal(0);

  public getStatus(): Promise<SignatureStatus> {
    return firstValueFrom(this.http.get<SignatureStatus>(this.url));
  }

  /** The current signature as an object URL (caller must revoke it). */
  public async getImageUrl(): Promise<string> {
    const blob = await firstValueFrom(
      this.http.get(`${this.url}/image`, { responseType: 'blob' }),
    );
    return URL.createObjectURL(blob);
  }

  public async save(png: Blob): Promise<SignatureStatus> {
    const form = new FormData();
    form.append('file', png, 'signature.png');
    const status = await firstValueFrom(
      this.http.put<SignatureStatus>(this.url, form),
    );
    this.session.setHasSignature(true);
    this.version.update((v) => v + 1);
    return status;
  }

  /**
   * Resolves the flag for a profile cached before the feature (or gone stale). Silent on
   * failure: offline or a transient error leaves the cached value, and the API still
   * enforces the gate (the error interceptor re-raises it on a 403 SIGNATURE_REQUIRED).
   */
  public async refreshStatus(): Promise<void> {
    const role = this.session.profile()?.role;
    if (!role || !SIGNATURE_ROLES.includes(role)) return;
    if (!this.connectivity.isOnline()) return;
    try {
      const status = await this.getStatus();
      this.session.setHasSignature(status.hasSignature);
    } catch (e) {
      console.warn('Could not refresh signature status', e);
    }
  }
}
