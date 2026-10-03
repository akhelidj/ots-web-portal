import { Injectable, inject, signal, computed } from '@angular/core';
import { ConnectivityService } from '@portal/core/offline/services/connectivity.service';

import { DbService } from '@portal/core/offline/services/db.service';

export interface UserProfile {
  id: string;
  email: string;
  name?: string;
  role: string;
  tenantId: string;
  tenant?: { name: string };
  customerId?: string;
  customer?: { name: string };
  mustChangePassword?: boolean;
  /** Whether the account has a registered signature. Undefined on a profile cached
   *  before the signature feature — resolved by `SignatureService.refreshStatus`. */
  hasSignature?: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class SessionService {
  private readonly TOKEN_KEY = 'auth_token';
  private readonly REFRESH_TOKEN_KEY = 'refresh_token';
  private readonly PROFILE_KEY = 'session_profile';

  private connectivity = inject(ConnectivityService);
  private dbService = inject(DbService);

  public readonly isAuthenticated = signal<boolean>(this.hasValidToken());
  public readonly profile = signal<UserProfile | null>(this.getStoredProfile());

  public readonly mustChangePassword = computed(
    () => !!this.profile()?.mustChangePassword,
  );

  /** An INSPECTOR whose account has no signature yet is locked out of every report
   *  action (the API answers 403 SIGNATURE_REQUIRED); the shell blurs the UI. An
   *  undefined flag (stale cache) is not treated as missing — it gets resolved first. */
  public readonly signatureRequired = computed(() => {
    const p = this.profile();
    return p?.role === 'INSPECTOR' && p.hasSignature === false;
  });

  public readonly canWorkOffline = computed(
    () => !this.connectivity.isOnline() && this.isAuthenticated(),
  );

  constructor() {
    const profile = this.getStoredProfile();
    if (this.hasValidToken() && profile) {
      this.dbService
        .openForTenant(profile.tenantId)
        .catch((e) => console.error('Failed to open Db on init', e));
    }
  }

  public isTokenExpired(token: string): boolean {
    if (!token) return true;

    try {
      const parts = token.split('.');
      if (parts.length !== 3) return true;

      const payload = JSON.parse(atob(parts[1] ?? ''));
      if (!payload.exp) return false;

      return payload.exp * 1000 < Date.now();
    } catch (e) {
      console.error('Failed to parse JWT token', e);
      return true;
    }
  }

  private hasValidToken(): boolean {
    const token = localStorage.getItem(this.TOKEN_KEY);
    if (!token) return false;
    return !this.isTokenExpired(token);
  }

  private getStoredProfile(): UserProfile | null {
    const stored = localStorage.getItem(this.PROFILE_KEY);
    if (!stored) return null;
    try {
      return JSON.parse(stored);
    } catch {
      return null;
    }
  }

  public setSession(
    accessToken: string,
    refreshToken: string,
    profile: UserProfile,
  ): void {
    localStorage.setItem(this.TOKEN_KEY, accessToken);
    localStorage.setItem(this.REFRESH_TOKEN_KEY, refreshToken);
    localStorage.setItem(this.PROFILE_KEY, JSON.stringify(profile));

    this.dbService
      .openForTenant(profile.tenantId)
      .catch((e) => console.error('Failed to open Db on login', e));

    this.profile.set(profile);
    this.isAuthenticated.set(true);
  }

  /** Updates the signature flag in memory and in the persisted profile. */
  public setHasSignature(hasSignature: boolean): void {
    const current = this.profile();
    if (!current || current.hasSignature === hasSignature) return;
    const next = { ...current, hasSignature };
    localStorage.setItem(this.PROFILE_KEY, JSON.stringify(next));
    this.profile.set(next);
  }

  public getToken(): string | null {
    return localStorage.getItem(this.TOKEN_KEY);
  }

  public getRefreshToken(): string | null {
    return localStorage.getItem(this.REFRESH_TOKEN_KEY);
  }

  public logout(): void {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.REFRESH_TOKEN_KEY);
    localStorage.removeItem(this.PROFILE_KEY);

    this.dbService.close();

    this.profile.set(null);
    this.isAuthenticated.set(false);
  }
}
