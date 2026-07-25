import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { DbService } from '@portal/core/offline/services/db.service';
import { LocalBatchSerialNumber } from '@portal/core/offline/models/types';

@Injectable({
  providedIn: 'root',
})
export class BatchSerialNumberLocalRepo {
  private dbService = inject(DbService);
  private changesSubject = new BehaviorSubject<void>(undefined);

  public readonly changes$: Observable<void> =
    this.changesSubject.asObservable();
  private readonly STORE_NAME = 'inspection_approval_batch_members';

  async listByBatchId(batchId: string): Promise<LocalBatchSerialNumber[]> {
    const db = await this.dbService.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readonly');
      const index = tx
        .objectStore(this.STORE_NAME)
        .index('inspectionApprovalBatchId');
      const req = index.getAll(batchId);

      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async bulkUpsert(members: LocalBatchSerialNumber[]): Promise<void> {
    if (members.length === 0) return;
    const db = await this.dbService.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readwrite');
      const store = tx.objectStore(this.STORE_NAME);

      tx.oncomplete = () => {
        this.changesSubject.next();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);

      for (const item of members) {
        store.put(item);
      }
    });
  }

  async deleteByBatchId(batchId: string): Promise<void> {
    const members = await this.listByBatchId(batchId);
    if (members.length === 0) return;

    const db = await this.dbService.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readwrite');
      const store = tx.objectStore(this.STORE_NAME);

      tx.oncomplete = () => {
        this.changesSubject.next();
        resolve();
      };
      tx.onerror = () => reject(tx.error);

      for (const m of members) {
        store.delete(m.id);
      }
    });
  }
}
