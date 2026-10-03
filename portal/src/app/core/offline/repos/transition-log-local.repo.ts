import { Injectable, inject } from '@angular/core';
import { DbService } from '@portal/core/offline/services/db.service';
import { LocalTransitionLog } from '@portal/core/offline/models/types';
import { BehaviorSubject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class TransitionLogLocalRepo {
  private db = inject(DbService);
  private STORE_NAME = 'transitionLogs';

  private changesSubj = new BehaviorSubject<void>(undefined);
  public readonly changes$ = this.changesSubj.asObservable();

  public async getById(id: string): Promise<LocalTransitionLog | undefined> {
    const db = await this.db.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readonly');
      const store = tx.objectStore(this.STORE_NAME);
      const req = store.get(id);

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  public async list(): Promise<LocalTransitionLog[]> {
    const db = await this.db.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readonly');
      const store = tx.objectStore(this.STORE_NAME);
      const req = store.getAll();

      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  public async listByReportId(reportId: string): Promise<LocalTransitionLog[]> {
    const logs = await this.list();
    return logs
      .filter((l) => l.inspectionReportId === reportId)
      .sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );
  }

  public async upsert(log: LocalTransitionLog): Promise<void> {
    const db = await this.db.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readwrite');
      const store = tx.objectStore(this.STORE_NAME);
      const req = store.put(log);

      req.onsuccess = () => {
        this.changesSubj.next();
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  }

  public async bulkUpsert(logs: LocalTransitionLog[]): Promise<void> {
    const db = await this.db.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readwrite');
      const store = tx.objectStore(this.STORE_NAME);

      tx.oncomplete = () => {
        this.changesSubj.next();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);

      for (const log of logs) {
        store.put(log);
      }
    });
  }

  public async delete(id: string): Promise<void> {
    const db = await this.db.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE_NAME, 'readwrite');
      const store = tx.objectStore(this.STORE_NAME);
      const req = store.delete(id);

      req.onsuccess = () => {
        this.changesSubj.next();
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  }
}
