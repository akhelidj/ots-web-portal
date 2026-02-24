import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { OutboxLocalRepo } from './outbox-local.repo';
import { SyncDispatcherService } from './sync-dispatcher.service';
import { SessionService } from '../auth/session.service';
import { OutboxItem } from './types';

@Injectable({
  providedIn: 'root',
})
export class OutboxService {
  private repo = inject(OutboxLocalRepo);
  private dispatcher = inject(SyncDispatcherService);
  private session = inject(SessionService);

  private pendingCountSubj = new BehaviorSubject<number>(0);
  public readonly pendingCount$: Observable<number> = this.pendingCountSubj.asObservable();

  private hasConflictSubj = new BehaviorSubject<boolean>(false);
  public readonly hasConflict$: Observable<boolean> = this.hasConflictSubj.asObservable();

  private isProcessing = false;

  constructor() {
    this.rehydrateCount();
  }

  private async rehydrateCount(): Promise<void> {
    try {
      const count = await this.repo.countPendingItems();
      this.pendingCountSubj.next(count);

      const hasConflict = await this.repo.hasConflictItems();
      this.hasConflictSubj.next(hasConflict);
    } catch (e) {
      console.error('Failed to rehydrate pending/conflict count:', e);
    }
  }

  public async enqueue(item: OutboxItem): Promise<void> {
    item.status = 'PENDING';
    item.attemptCount = 0;
    
    await this.repo.upsert(item);
    
    // Update count immediately after successful DB write
    const currentCount = this.pendingCountSubj.value;
    this.pendingCountSubj.next(currentCount + 1);

    if (navigator.onLine) {
      // Trigger sync immediately if online
      this.processQueue().catch(err => console.error('Immediate sync failed:', err));
    }
  }

  public async processQueue(): Promise<void> {
    if (this.isProcessing) return;

    if (!this.session.isAuthenticated) {
      console.warn('Sync aborted: User is not authenticated or token is expired.');
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

      for (const item of pendingItems) {
        const dependsOnConflicted = skipEntities.has(item.entityId) || 
                                   (item.payload && item.payload['inspectionReportId'] && skipEntities.has(item.payload['inspectionReportId'] as string));
        
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
            item.lastError = 'Dispatcher returned false without throwing conflict.';
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
