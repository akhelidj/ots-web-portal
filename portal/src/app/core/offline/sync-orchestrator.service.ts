import { Injectable, inject } from '@angular/core';
import { combineLatest } from 'rxjs';
import { ConnectivityService } from './connectivity.service';
import { OutboxService } from './outbox.service';
import { SessionService } from '../auth/session.service';

@Injectable({
  providedIn: 'root',
})
export class SyncOrchestratorService {
  private connectivity = inject(ConnectivityService);
  private outbox = inject(OutboxService);
  private session = inject(SessionService);

  constructor() {
    combineLatest([
      this.connectivity.isOnline$,
      this.session.isAuthenticated$,
    ]).subscribe(([isOnline, isAuthenticated]) => {
      if (isOnline && isAuthenticated) {
        console.log('[SyncOrchestrator] Online state and valid session detected. Triggering queue processing.');
        this.outbox.processQueue();
      }
    });
  }
}
