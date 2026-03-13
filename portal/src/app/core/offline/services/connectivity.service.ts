import { Injectable, OnDestroy, computed, signal } from '@angular/core';
import { environment } from '@app-env/environment';

const REACHABILITY_CHECK_INTERVAL_MS = 30000;
const REACHABILITY_TIMEOUT_MS = 5000;

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

  private reachabilityIntervalId: number | null = null;

  constructor() {
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);

    if (this.browserOnline()) {
      void this.refreshReachability();
    }

    this.reachabilityIntervalId = window.setInterval(() => {
      if (this.browserOnline()) {
        void this.refreshReachability();
      }
    }, REACHABILITY_CHECK_INTERVAL_MS);
  }

  ngOnDestroy(): void {
    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('offline', this.handleOffline);
    document.removeEventListener(
      'visibilitychange',
      this.handleVisibilityChange,
    );

    if (this.reachabilityIntervalId !== null) {
      window.clearInterval(this.reachabilityIntervalId);
      this.reachabilityIntervalId = null;
    }
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
    if (!document.hidden && this.browserOnline()) {
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

    try {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(
        () => controller.abort(),
        REACHABILITY_TIMEOUT_MS,
      );

      try {
        await fetch(environment.apiUrl, {
          method: 'GET',
          mode: 'no-cors',
          cache: 'no-store',
          signal: controller.signal,
        });

        this.apiReachable.set(true);
        return true;
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
