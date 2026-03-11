import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { DbService } from '@portal/core/offline/services/db.service';
import { LocalInspectionApprovalBatch } from '@portal/core/offline/models/types';

@Injectable({
  providedIn: 'root',
})
export class ApprovalBatchLocalRepo {
  private dbService = inject(DbService);
  private changesSubject = new BehaviorSubject<void>(undefined);

  public readonly changes$: Observable<void> = this.changesSubject.asObservable();
  private readonly STORE_NAME = 'inspection_approval_batches';

  async getById(id: string): Promise<LocalInspectionApprovalBatch | undefined> {
    const db = await this.dbService.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readonly');
      const store = tx.objectStore(this.STORE_NAME);
      const req = store.get(id);

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async listByReportId(reportId: string): Promise<LocalInspectionApprovalBatch[]> {
    const db = await this.dbService.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readonly');
      const index = tx.objectStore(this.STORE_NAME).index('inspectionReportId');
      const req = index.getAll(reportId);

      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async upsert(batch: LocalInspectionApprovalBatch): Promise<void> {
    const db = await this.dbService.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readwrite');
      const store = tx.objectStore(this.STORE_NAME);
      const req = store.put(batch);

      req.onsuccess = () => {
        this.changesSubject.next();
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  }

  async bulkUpsert(batches: LocalInspectionApprovalBatch[]): Promise<void> {
    if (batches.length === 0) return;
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

      for (const item of batches) {
        store.put(item);
      }
    });
  }

  async delete(id: string): Promise<void> {
    const db = await this.dbService.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readwrite');
      const store = tx.objectStore(this.STORE_NAME);
      const req = store.delete(id);

      req.onsuccess = () => {
        this.changesSubject.next();
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  }

  public async remapId(oldId: string, newBatch: LocalInspectionApprovalBatch): Promise<void> {
    const db = await this.dbService.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readwrite');
      const store = tx.objectStore(this.STORE_NAME);

      const delReq = store.delete(oldId);
      delReq.onsuccess = () => {
        store.put(newBatch);
      };

      tx.oncomplete = () => {
        this.changesSubject.next();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  }
}
