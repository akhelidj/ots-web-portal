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
  }

  public async processQueue(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    if (!this.session.isAuthenticated) {
      console.warn('Sync aborted: User is not authenticated or token is expired.');
      return;
    }

    try {
      this.isProcessing = true;

      const hasConflict = await this.repo.hasConflictItems();
      if (hasConflict) {
        console.warn('Queue processing halted: A CONFLICT item requires manual resolution.');
        return;
      }

      const pendingItems = await this.repo.getPendingItems();

      for (const item of pendingItems) {
        item.attemptCount += 1;
        try {
          const success = await this.dispatcher.dispatch(item);
          
          if (success) {
            item.status = 'SYNCED';
            item.lastError = null;
          } else {
            // Standard failure (like server 500 or offline network hit)
            // Leave it as PENDING so it counts towards pending, or mark FAILED based on rules.
            // The constraint states count(PENDING) = pendingCount.
            // By keeping it PENDING, we know it still needs sync. We just add an error.
            item.status = 'PENDING';
            item.lastError = 'Dispatcher returned false without throwing conflict.';
          }
        } catch (e: unknown) {
          const err = e as { name?: string; status?: number; message?: string };
          // If the dispatcher throws a specific conflict error (e.g. 409 API response), mark it CONFLICT.
          if (err?.name === 'ConflictError' || err?.status === 409) {
            item.status = 'CONFLICT';
            item.lastError = err?.message || 'Conflict detected during sync.';
          } else {
            item.status = 'PENDING';
            item.lastError = err?.message || 'Unknown error during dispatch.';
          }
        }

        await this.repo.upsert(item);
        await this.rehydrateCount();

        // Halt sequential processing if we hit a conflict
        if (item.status === 'CONFLICT') {
          break;
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }
}
