import { Injectable } from '@angular/core';
import { OutboxItem } from './types';

@Injectable({
  providedIn: 'root',
})
export class SyncDispatcherService {
  /**
   * Dispatches an outbox item to the remote API.
   * Currently stubs operations and simulates success for dev-only "ping" operations.
   * Returns a boolean indicating if the dispatch was cleanly handled (true for SYNCED, false for fail/retry).
   * Throws an error on conflict so the orchestrator can halt.
   */
  public async dispatch(item: OutboxItem): Promise<boolean> {
    const operationKey = `${item.entityType}:${item.operation}`;

    switch (operationKey) {
      case 'System:ping':
        // Dev-only simulation to verify the outbox pipeline end-to-end
        console.log(`[SyncDispatcher] Simulated success for ping idempotencyKey: ${item.idempotencyKey}`);
        return true;

      default:
        // By default, no dispatchers are implemented yet in F0.1.2.
        // F0.1.4+ will build these out. For now, mark as failed so it stays pending/failed.
        console.error(`[SyncDispatcher] No dispatcher implemented yet for operation pattern: ${operationKey}`);
        return false;
    }
  }
}
