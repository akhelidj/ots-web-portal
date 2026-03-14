import { Injectable, OnDestroy, computed, signal } from '@angular/core';
import { environment } from '@app-env/environment';

const REACHABILITY_RECHECK_AFTER_MS = 60000;
const REACHABILITY_TIMEOUT_MS = 5000;
const HEALTH_PATH = '/health';

@Injectable({
  providedIn: 'root',
})
export class ConnectivityService implements OnDestroy {
  public readonly browserOnline = signal<boolean>(navigator.onLine);
  public readonly apiReachable = signal<boolean>(navigator.onLine);
  public readonly isCheckingReachability = signal<boolean>(false);
  public readonly isOnline = computed<boolean>(
    () => this.browserOnline() && this.apiReachable(),
  );

  private lastReachabilityCheckAt = 0;

  constructor() {
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);

    if (this.browserOnline()) {
      void this.refreshReachability();
    }
  }

  ngOnDestroy(): void {
    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('offline', this.handleOffline);
    document.removeEventListener(
      'visibilitychange',
      this.handleVisibilityChange,
    );
  }

  private handleOnline = () => {
    this.browserOnline.set(true);
    void this.refreshReachability();
  };

  private handleOffline = () => {
    this.browserOnline.set(false);
    this.apiReachable.set(false);
  };

  private handleVisibilityChange = () => {
    const staleCheck =
      Date.now() - this.lastReachabilityCheckAt > REACHABILITY_RECHECK_AFTER_MS;

    if (!document.hidden && this.browserOnline() && staleCheck) {
      void this.refreshReachability();
    }
  };

  public markApiReachable(): void {
    if (this.browserOnline()) {
      this.apiReachable.set(true);
    }
  }

  public markApiUnreachable(): void {
    this.apiReachable.set(false);
  }

  public async refreshReachability(): Promise<boolean> {
    if (!this.browserOnline()) {
      this.apiReachable.set(false);
      return false;
    }

    this.isCheckingReachability.set(true);
    this.lastReachabilityCheckAt = Date.now();

    try {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(
        () => controller.abort(),
        REACHABILITY_TIMEOUT_MS,
      );

      try {
        const response = await fetch(`${environment.apiUrl}${HEALTH_PATH}`, {
          method: 'GET',
          cache: 'no-store',
          headers: {
            Accept: 'application/json',
          },
          signal: controller.signal,
        });

        const reachable = response.ok;
        this.apiReachable.set(reachable);
        return reachable;
      } catch {
        this.apiReachable.set(false);
        return false;
      } finally {
        window.clearTimeout(timeoutId);
      }
    } finally {
      this.isCheckingReachability.set(false);
    }
  }
}
