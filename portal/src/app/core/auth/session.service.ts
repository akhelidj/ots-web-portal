import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, combineLatest, map } from 'rxjs';
import { ConnectivityService } from '../offline/connectivity.service';

@Injectable({
  providedIn: 'root',
})
export class SessionService {
  private readonly TOKEN_KEY = 'auth_token';
  private connectivity = inject(ConnectivityService);

  private authStatusSubject = new BehaviorSubject<boolean>(this.hasValidToken());
  public isAuthenticated$: Observable<boolean> = this.authStatusSubject.asObservable();

  public get isAuthenticated(): boolean {
    return this.hasValidToken();
  }

  public canWorkOffline$: Observable<boolean> = combineLatest([
    this.connectivity.isOnline$,
    this.isAuthenticated$,
  ]).pipe(
    map(([isOnline, isAuthenticated]) => !isOnline && isAuthenticated)
  );

  constructor() {
    // Optional: listen to storage events to sync across tabs, but evaluating on init is fine for v1
  }

  public isTokenExpired(token: string): boolean {
    if (!token) return true;

    try {
      const parts = token.split('.');
      if (parts.length !== 3) return true;

      const payload = JSON.parse(atob(parts[1]));
      if (!payload.exp) return false; // If no exp claim, assume valid

      // exp is typically in seconds
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

  /**
   * Log the user out by clearing the token and broadcasting state.
   * Note: This strictly leaves IndexedDB offline data untouched as per v1 requirements.
   */
  public logout(): void {
    localStorage.removeItem(this.TOKEN_KEY);
    this.authStatusSubject.next(false);
  }
}
