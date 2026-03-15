import {
  Injectable,
  inject,
  signal,
  effect,
  untracked,
  computed,
} from '@angular/core';

import { ConnectivityService } from './connectivity.service';
import { SessionService } from '@portal/core/auth/services/session.service';
import { OutboxService } from './outbox.service';
import { DataHydrationService } from '@portal/core/offline/services/data-hydration.service';

export type AppSyncState = 'online' | 'offline' | 'syncing' | 'sync-error';

@Injectable({
  providedIn: 'root',
})
export class SyncOrchestratorService {
  private connectivity = inject(ConnectivityService);
  private session = inject(SessionService);
  private outbox = inject(OutboxService);
  private hydration = inject(DataHydrationService);

  public readonly syncState = signal<AppSyncState>('offline');
  public readonly lastSyncedAt = signal<string | null>(null);
  public readonly lastSyncError = signal<string | null>(null);
  public readonly syncStatus = computed(() => {
    switch (this.syncState()) {
      case 'syncing':
        return 'Syncing';
      case 'sync-error':
        return 'Sync error';
      case 'online':
        return 'Online';
      default:
        return 'Offline';
    }
  });

  private isSyncing = false;
  private autoSyncScheduled = false;
  private lastAutoSyncAt = 0;

  private static readonly AUTO_SYNC_COOLDOWN_MS = 2500;

  constructor() {
    this.initOrchestration();
  }

  private initOrchestration(): void {
    effect(() => {
      const isOnline = this.connectivity.isOnline();
      const isAuthenticated = this.session.isAuthenticated();
      const hasConflict = this.outbox.hasConflict();
      const pendingCount = this.outbox.pendingCount();

      untracked(() => {
        if (this.isSyncing) {
          return;
        }

        if (!isOnline) {
          this.syncState.set('offline');
          return;
        }

        if (isOnline && !isAuthenticated) {
          this.syncState.set('offline');
          return;
        }

        if (hasConflict) {
          this.syncState.set('sync-error');
          return;
        }

        if (this.lastSyncError()) {
          this.syncState.set('sync-error');
          if (pendingCount > 0) {
            this.scheduleAutoSync();
          }
          return;
        }

        this.syncState.set('online');

        if (pendingCount > 0) {
          this.scheduleAutoSync();
        }
      });
    });
  }

  private scheduleAutoSync(): void {
    if (this.autoSyncScheduled || this.isSyncing) {
      return;
    }

    const now = Date.now();
    if (
      now - this.lastAutoSyncAt <
      SyncOrchestratorService.AUTO_SYNC_COOLDOWN_MS
    ) {
      return;
    }

    this.autoSyncScheduled = true;
    window.setTimeout(() => {
      this.autoSyncScheduled = false;

      if (this.isSyncing) {
        return;
      }

      if (!this.connectivity.isOnline() || !this.session.isAuthenticated()) {
        return;
      }

      if (this.outbox.hasConflict() || this.outbox.pendingCount() === 0) {
        return;
      }

      this.lastAutoSyncAt = Date.now();
      void this.runSyncSequence();
    }, 150);
  }

  public async runSyncSequence(): Promise<void> {
    if (this.isSyncing) return;

    await this.connectivity.refreshReachability();

    if (!this.connectivity.isOnline() || !this.session.isAuthenticated()) {
      this.syncState.set('offline');
      return;
    }

    this.isSyncing = true;
    this.syncState.set('syncing');
    this.lastSyncError.set(null);

    try {
      await this.outbox.processQueue();

      await this.hydration.hydrateAll({
        includeRemote: true,
        throwOnError: true,
      });

      const now = new Date().toISOString();
      this.lastSyncedAt.set(now);
      if (this.outbox.hasConflict()) {
        this.lastSyncError.set('One or more queued changes need attention.');
        this.syncState.set('sync-error');
      } else {
        this.syncState.set('online');
      }
    } catch (e: unknown) {
      const error = e as Error;
      console.error('Error during orchestrator sync sequence:', e);
      this.lastSyncError.set(
        error.message || 'Failed to synchronize local changes.',
      );

      const reachable = await this.connectivity.refreshReachability();
      this.syncState.set(reachable ? 'sync-error' : 'offline');
    } finally {
      this.isSyncing = false;
    }
  }

  public async syncNow(): Promise<void> {
    await this.runSyncSequence();
  }
}
