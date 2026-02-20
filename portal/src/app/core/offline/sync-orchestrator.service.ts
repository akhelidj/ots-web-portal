import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, combineLatest, firstValueFrom } from 'rxjs';
import { filter } from 'rxjs/operators';
import { ConnectivityService } from './connectivity.service';
import { SessionService } from '../auth/session.service';
import { OutboxService } from './outbox.service';
import { AdminUsersService } from '../../admin/admin-users.service';
import { AdminCustomersService } from '../../admin/admin-customers.service';
import { InspectionReportsService } from '../../inspector/inspection-reports.service';

export type SyncStatus = 'Offline' | 'Syncing...' | 'Up to date' | 'Conflict';

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

  private syncStatusSubj = new BehaviorSubject<SyncStatus>('Offline');
  public readonly syncStatus$: Observable<SyncStatus> = this.syncStatusSubj.asObservable();

  private lastSyncedAtSubj = new BehaviorSubject<string | null>(null);
  public readonly lastSyncedAt$: Observable<string | null> = this.lastSyncedAtSubj.asObservable();

  private isSyncing = false;

  constructor() {
    this.initOrchestration();
  }

  private initOrchestration(): void {
    // 1. Sync on state change to Online + Authenticated
    combineLatest([
      this.connectivity.isOnline$,
      this.session.isAuthenticated$,
    ]).subscribe(async ([isOnline, isAuthenticated]) => {
      if (!isOnline) {
        this.syncStatusSubj.next('Offline');
        return;
      }
      
      if (isOnline && !isAuthenticated) {
        this.syncStatusSubj.next('Offline');
        return;
      }

      if (isOnline && isAuthenticated) {
        await this.runSyncSequence();
      }
    });

    // 2. Listen to Outbox conflicts to lock status
    this.outbox.hasConflict$.pipe(filter(hasConflict => hasConflict)).subscribe(() => {
      this.syncStatusSubj.next('Conflict');
    });
  }

  public async runSyncSequence(): Promise<void> {
    if (this.isSyncing) return;
    
    const initiallyHasConflict = await firstValueFrom(this.outbox.hasConflict$);
    if (initiallyHasConflict) {
      this.syncStatusSubj.next('Conflict');
      // Do not return here, continue to pull operations
    }
    
    this.isSyncing = true;
    this.syncStatusSubj.next('Syncing...');

    try {
      // Step 1: Flush pending writes
      await this.outbox.processQueue();

      // Check if conflict arose during processQueue
      const conflictDetected = await firstValueFrom(this.outbox.hasConflict$);
      if (conflictDetected) {
        this.syncStatusSubj.next('Conflict');
        // Do not return here, we still want to pull fresh items
      }

      // Step 2: Hydrate/refresh from server
      await Promise.all([
        this.adminUsers.pullAllAndCache(),
        this.adminCustomers.pullAllAndCache(),
        this.inspectionReports.pullAllAndCache()
      ]);

      const now = new Date().toLocaleTimeString();
      this.lastSyncedAtSubj.next(now);
      if (!conflictDetected) {
        this.syncStatusSubj.next('Up to date');
      }
    } catch (e) {
      console.error('Error during orchestrator sync sequence:', e);
      // Fallback state if server unreachable or errors out
      this.syncStatusSubj.next('Offline'); 
    } finally {
      this.isSyncing = false;
    }
  }
}
