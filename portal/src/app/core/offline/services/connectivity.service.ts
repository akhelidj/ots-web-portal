import { Injectable, OnDestroy, signal } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class ConnectivityService implements OnDestroy {
  public readonly isOnline = signal<boolean>(navigator.onLine);

  constructor() {
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);
  }

  ngOnDestroy(): void {
    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('offline', this.handleOffline);
  }

  private handleOnline = () => {
    this.isOnline.set(true);
  };

  private handleOffline = () => {
    this.isOnline.set(false);
  };
}
