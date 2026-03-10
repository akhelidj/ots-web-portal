import { Injectable, inject, signal, effect, untracked } from '@angular/core';

import { ConnectivityService } from './connectivity.service';
import { SessionService } from '../auth/session.service';
import { OutboxService } from './outbox.service';
import { AdminUsersService } from '../../features/users/services/admin-users.service';
import { AdminCustomersService } from '../../features/customers/services/admin-customers.service';
import { InspectionReportsService } from '../../features/inspections/services/inspection-reports.service';

export type SyncStatus = 'Offline' | 'Syncing...' | 'Up to date' | 'Sync Error';

@Injectable({
  providedIn: 'root',
})
export class SyncOrchestratorService {
  private connectivity = inject(ConnectivityService);
  private session = inject(SessionService);
  private outbox = inject(OutboxService);
  private adminUsers = inject(AdminUsersService);
  private adminCustomers = inject(AdminCustomersService);
  private inspectionReports = inject(InspectionReportsService);

  public readonly syncStatus = signal<SyncStatus>('Offline');
  public readonly lastSyncedAt = signal<string | null>(null);

  private isSyncing = false;

  constructor() {
    this.initOrchestration();
  }

  private initOrchestration(): void {
    // 1. Sync on state change to Online + Authenticated
    effect(() => {
      const isOnline = this.connectivity.isOnline();
      const isAuthenticated = this.session.isAuthenticated();
      
      untracked(() => {
        if (!isOnline) {
          this.syncStatus.set('Offline');
          return;
        }
        
        if (isOnline && !isAuthenticated) {
          this.syncStatus.set('Offline');
          return;
        }

        if (isOnline && isAuthenticated) {
          this.runSyncSequence();
        }
      });
    });

    // 2. Listen to Outbox conflicts to lock status
    effect(() => {
      if (this.outbox.hasConflict()) {
        untracked(() => {
          this.syncStatus.set('Sync Error');
        });
      }
    });
  }

  public async runSyncSequence(): Promise<void> {
    if (this.isSyncing) return;
    
    const initiallyHasConflict = this.outbox.hasConflict();
    if (initiallyHasConflict) {
      this.syncStatus.set('Sync Error');
      // Do not return here, continue to pull operations
    }
    
    this.isSyncing = true;
    this.syncStatus.set('Syncing...');

    try {
      // Step 1: Flush pending writes
      await this.outbox.processQueue();

      // Check if conflict arose during processQueue
      const conflictDetected = this.outbox.hasConflict();
      if (conflictDetected) {
        this.syncStatus.set('Sync Error');
        // Do not return here, we still want to pull fresh items
      }

      // Step 2: Hydrate/refresh from server
      const profile = this.session.profile();
      const isTenantAdmin = profile?.role === 'ADMIN';

      const syncTasks: Promise<void>[] = [
        this.inspectionReports.pullAllAndCache()
      ];

      if (isTenantAdmin) {
        syncTasks.push(this.adminUsers.pullAllAndCache());
        syncTasks.push(this.adminCustomers.pullAllAndCache());
      }

      await Promise.all(syncTasks);

      const now = new Date().toISOString();
      this.lastSyncedAt.set(now);
      if (!conflictDetected) {
        this.syncStatus.set('Up to date');
      }
    } catch (e) {
      console.error('Error during orchestrator sync sequence:', e);
      // Fallback state if server unreachable or errors out
      this.syncStatus.set('Offline'); 
    } finally {
      this.isSyncing = false;
    }
  }
}
