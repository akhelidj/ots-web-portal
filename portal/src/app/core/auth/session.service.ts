import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, combineLatest, map } from 'rxjs';
import { ConnectivityService } from '../offline/connectivity.service';

import { DbService } from '../offline/db.service';

export interface UserProfile {
  id: string;
  email: string;
  role: string;
  tenantId: string;
  customerId?: string;
  mustChangePassword?: boolean;
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

  private authStatusSubject = new BehaviorSubject<boolean>(this.hasValidToken());
  public isAuthenticated$: Observable<boolean> = this.authStatusSubject.asObservable();

  private profileSubject = new BehaviorSubject<UserProfile | null>(this.getStoredProfile());
  public profile$: Observable<UserProfile | null> = this.profileSubject.asObservable();
  
  public mustChangePassword$: Observable<boolean> = this.profile$.pipe(
    map(profile => !!profile?.mustChangePassword)
  );

  public get isAuthenticated(): boolean {
    return this.hasValidToken();
  }
  
  public get mustChangePassword(): boolean {
    const profile = this.getStoredProfile();
    return !!profile?.mustChangePassword;
  }

  public canWorkOffline$: Observable<boolean> = combineLatest([
    this.connectivity.isOnline$,
    this.isAuthenticated$,
  ]).pipe(
    map(([isOnline, isAuthenticated]) => !isOnline && isAuthenticated)
  );

  constructor() {
    const profile = this.getStoredProfile();
    if (this.hasValidToken() && profile) {
      this.dbService.openForTenant(profile.tenantId).catch(e => console.error('Failed to open Db on init', e));
    }
  }

  public isTokenExpired(token: string): boolean {
    if (!token) return true;

    try {
      const parts = token.split('.');
      if (parts.length !== 3) return true;

      const payload = JSON.parse(atob(parts[1]));
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

  public setSession(accessToken: string, refreshToken: string, profile: UserProfile): void {
    localStorage.setItem(this.TOKEN_KEY, accessToken);
    localStorage.setItem(this.REFRESH_TOKEN_KEY, refreshToken);
    localStorage.setItem(this.PROFILE_KEY, JSON.stringify(profile));
    
    this.dbService.openForTenant(profile.tenantId).catch(e => console.error('Failed to open Db on login', e));

    this.profileSubject.next(profile);
    this.authStatusSubject.next(true);
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

    this.profileSubject.next(null);
    this.authStatusSubject.next(false);
  }
}
