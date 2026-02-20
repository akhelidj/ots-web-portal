import { Injectable, inject } from '@angular/core';
import { ConnectivityService } from './connectivity.service';
import { OutboxService } from './outbox.service';

@Injectable({
  providedIn: 'root',
})
export class SyncOrchestratorService {
  private connectivity = inject(ConnectivityService);
  private outbox = inject(OutboxService);

  constructor() {
    this.connectivity.isOnline$.subscribe((isOnline) => {
      if (isOnline) {
        console.log('[SyncOrchestrator] Online state detected. Triggering queue processing.');
        this.outbox.processQueue();
      }
    });
  }
}
