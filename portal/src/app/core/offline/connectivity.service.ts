import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class ConnectivityService implements OnDestroy {
  private onlineStatus = new BehaviorSubject<boolean>(navigator.onLine);

  /** Observable stream of online/offline status */
  public readonly isOnline$: Observable<boolean> = this.onlineStatus.asObservable();

  constructor() {
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);
  }

  ngOnDestroy(): void {
    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('offline', this.handleOffline);
  }

  /** Synchronous getter for current connectivity state */
  public isOnline(): boolean {
    return this.onlineStatus.value;
  }

  private handleOnline = () => {
    this.onlineStatus.next(true);
  };

  private handleOffline = () => {
    this.onlineStatus.next(false);
  };
}
