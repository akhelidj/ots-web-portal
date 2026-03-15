import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { OutboxLocalRepo } from '@portal/core/offline/repos/outbox-local.repo';
import { SyncDispatcherService } from './sync-dispatcher.service';
import { SessionService } from '@portal/core/auth/services/session.service';
import { OutboxItem } from '@portal/core/offline/models/types';

@Injectable({
  providedIn: 'root',
})
export class OutboxService {
  private repo = inject(OutboxLocalRepo);
  private dispatcher = inject(SyncDispatcherService);
  private session = inject(SessionService);

  public readonly pendingCount = signal<number>(0);
  public readonly hasConflict = signal<boolean>(false);

  private isProcessing = false;

  constructor() {
    effect(() => {
      const isAuthenticated = this.session.isAuthenticated();

      untracked(() => {
        if (isAuthenticated) {
          void this.rehydrateCount();
          return;
        }

        this.pendingCount.set(0);
        this.hasConflict.set(false);
      });
    });
  }

  private async rehydrateCount(): Promise<void> {
    if (!this.session.isAuthenticated()) {
      this.pendingCount.set(0);
      this.hasConflict.set(false);
      return;
    }

    try {
      const count = await this.repo.countPendingItems();
      this.pendingCount.set(count);

      const hasConflict = await this.repo.hasConflictItems();
      this.hasConflict.set(hasConflict);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message.includes('Database is not opened for any tenant')) {
        return;
      }

      console.error('Failed to rehydrate pending/conflict count:', e);
    }
  }

  public async clearConflicts(): Promise<void> {
    await this.repo.clearConflicts();
    await this.rehydrateCount();
    // After clearing conflicts, there are no conflict items, but we should reset the signal immediately
    this.hasConflict.set(false);
  }

  public async enqueue(item: OutboxItem): Promise<void> {
    item.status = 'PENDING';
    item.attemptCount = 0;

    await this.repo.upsert(item);

    // Update count immediately after successful DB write
    this.pendingCount.update((c) => c + 1);
  }

  public async processQueue(): Promise<void> {
    if (this.isProcessing) return;

    if (!this.session.isAuthenticated()) {
      console.warn(
        'Sync aborted: User is not authenticated or token is expired.',
      );
      return;
    }

    try {
      this.isProcessing = true;
      const conflicts = await this.repo.getConflictItems();
      const pendingItems = await this.repo.getPendingItems();

      const skipEntities = new Set<string>();
      for (const c of conflicts) {
        skipEntities.add(c.entityId);
      }

      for (const initialItem of pendingItems) {
        // Re-fetch from DB to ensure we have the latest remapped entityId/payload
        const item = await this.repo.getById(initialItem.id);
        if (!item || item.status !== 'PENDING') continue;

        const dependsOnConflicted =
          skipEntities.has(item.entityId) ||
          (item.payload &&
            item.payload['inspectionReportId'] &&
            skipEntities.has(item.payload['inspectionReportId'] as string));

        if (dependsOnConflicted) {
          item.status = 'CONFLICT';
          item.lastError = 'Dependency is in CONFLICT';
          await this.repo.upsert(item);
          await this.rehydrateCount();
          continue;
        }

        item.attemptCount += 1;
        try {
          const success = await this.dispatcher.dispatch(item);
          if (success) {
            item.status = 'SYNCED';
            item.lastError = null;
          } else {
            item.status = 'PENDING';
            item.lastError =
              'Dispatcher returned false without throwing conflict.';
          }
        } catch (e: unknown) {
          const err = e as { name?: string; status?: number; message?: string };
          if (err?.name === 'ConflictError' || err?.status === 409) {
            item.status = 'CONFLICT';
            item.lastError = err?.message || 'Conflict detected during sync.';
            skipEntities.add(item.entityId);
          } else {
            if (err?.status && err.status >= 400 && err.status < 500) {
              item.status = 'FAILED';
            } else {
              item.status = 'PENDING';
            }
            item.lastError = err?.message || 'Unknown error during dispatch.';
            skipEntities.add(item.entityId);
          }
        }

        await this.repo.upsert(item);
        await this.rehydrateCount();
      }
    } finally {
      this.isProcessing = false;
    }
  }
}
